package com.pearprogram.execution;

import com.pearprogram.rooms.EphemeralRoomStateService;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.regex.Pattern;

@Service
public class ExecutionService {
    private static final Logger log = LoggerFactory.getLogger(ExecutionService.class);
    private static final Pattern JAVA_MAIN_CLASS = Pattern.compile("\\bclass\\s+Main\\b");

    private final ExecutionProvider provider;
    private final ExecutionLanguageRegistry languages;
    private final ExecutionProperties properties;
    private final EphemeralRoomStateService roomState;
    private final ThreadPoolExecutor executor;
    private final Map<UUID, ExecutionRecord> records = new ConcurrentHashMap<>();
    private final Map<String, IdempotencyEntry> idempotencyEntries = new ConcurrentHashMap<>();
    private final Map<String, Deque<Instant>> rateWindows = new ConcurrentHashMap<>();

    public ExecutionService(
            ExecutionProvider provider,
            ExecutionLanguageRegistry languages,
            ExecutionProperties properties,
            EphemeralRoomStateService roomState
    ) {
        this.provider = provider;
        this.languages = languages;
        this.properties = properties;
        this.roomState = roomState;
        int threads = Math.max(1, properties.getWorkerThreads());
        this.executor = new ThreadPoolExecutor(
                threads,
                threads,
                0L,
                TimeUnit.MILLISECONDS,
                new ArrayBlockingQueue<>(Math.max(8, threads * 8)),
                runnable -> {
                    Thread thread = new Thread(runnable, "pear-execution-worker");
                    thread.setDaemon(true);
                    return thread;
                },
                new ThreadPoolExecutor.AbortPolicy()
        );
    }

    public ExecutionResponse submit(String rawRoomCode, String rawUserId, String rawIdempotencyKey, ExecutionRequest request) {
        String roomCode = normalizeRoomCode(rawRoomCode);
        String userId = requireUserId(rawUserId);
        requireActiveMembership(roomCode, userId);
        ValidatedRequest validated = validate(request);

        String idempotencyKey = normalizeIdempotencyKey(rawIdempotencyKey);
        String idempotencyLookup = roomCode + ":" + userId + ":" + idempotencyKey;
        ExecutionRecord record;
        synchronized (idempotencyEntries) {
            IdempotencyEntry existingEntry = idempotencyEntries.get(idempotencyLookup);
            if (existingEntry != null && existingEntry.expiresAt().isAfter(Instant.now())) {
                ExecutionRecord existing = records.get(existingEntry.executionId());
                if (existing != null) {
                    return existing.response();
                }
            }

            enforceRateLimit(roomCode, userId);
            UUID executionId = UUID.randomUUID();
            record = new ExecutionRecord(executionId, roomCode, userId);
            records.put(executionId, record);
            idempotencyEntries.put(idempotencyLookup, new IdempotencyEntry(
                    executionId,
                    Instant.now().plus(properties.getRecordTtl())
            ));
        }

        try {
            executor.execute(() -> execute(record, validated));
        } catch (RejectedExecutionException exception) {
            record.fail(ExecutionStatus.FAILED, "The execution queue is full. Try again shortly.", 0);
        }
        return record.response();
    }

    public ExecutionResponse get(String rawRoomCode, UUID executionId, String rawUserId) {
        String roomCode = normalizeRoomCode(rawRoomCode);
        String userId = requireUserId(rawUserId);
        ExecutionRecord record = records.get(executionId);
        if (record == null || !record.roomCode().equals(roomCode)) {
            throw new ExecutionApiException(HttpStatus.NOT_FOUND, "execution_not_found", "Execution not found");
        }
        if (!record.ownerUserId().equals(userId)) {
            throw new ExecutionApiException(HttpStatus.FORBIDDEN, "execution_forbidden", "You do not own this execution");
        }
        return record.response();
    }

    private void execute(ExecutionRecord record, ValidatedRequest request) {
        long startedAt = System.nanoTime();
        Instant deadline = Instant.now().plus(properties.getDeadline());
        try {
            String token = provider.submit(new ProviderExecutionRequest(
                    request.languageId(),
                    request.sourceCode(),
                    request.stdin(),
                    properties.getJudge0().getExecutionTimeoutSeconds()
            ));
            record.transition(ExecutionStatus.SUBMITTED);

            for (int attempt = 0; attempt < Math.max(1, properties.getMaxPollAttempts()); attempt++) {
                if (Instant.now().isAfter(deadline)) {
                    record.fail(ExecutionStatus.TIMED_OUT, "Execution exceeded its deadline.", elapsedMs(startedAt));
                    return;
                }
                if (!roomState.roomExists(record.roomCode())) {
                    record.fail(ExecutionStatus.FAILED, "The room was closed before execution completed.", elapsedMs(startedAt));
                    return;
                }

                ProviderExecutionResult result = provider.getResult(token);
                record.apply(result);
                if (result.status().isTerminal()) {
                    return;
                }
                sleepUntilNextPoll(deadline);
            }
            record.fail(ExecutionStatus.TIMED_OUT, "Execution did not finish before the polling limit.", elapsedMs(startedAt));
        } catch (ExecutionProviderException exception) {
            log.warn("Execution provider failure executionId={} transient={} reason={}",
                    record.id(), exception.isTransientFailure(), exception.getMessage());
            record.fail(ExecutionStatus.FAILED,
                    exception.isTransientFailure()
                            ? "The execution provider is temporarily unavailable."
                            : "The execution provider returned an invalid response.",
                    elapsedMs(startedAt));
        } catch (RuntimeException exception) {
            log.error("Unexpected execution failure executionId={}", record.id(), exception);
            record.fail(ExecutionStatus.FAILED, "Execution failed because of an internal error.", elapsedMs(startedAt));
        }
    }

    private ValidatedRequest validate(ExecutionRequest request) {
        if (request == null) {
            throw new ExecutionApiException(HttpStatus.BAD_REQUEST, "invalid_request", "Execution request is required");
        }
        String language = languages.normalize(request.language());
        int languageId = languages.judge0Id(language).orElseThrow(() -> new ExecutionApiException(
                HttpStatus.BAD_REQUEST,
                "unsupported_language",
                "Supported languages are: " + String.join(", ", languages.supportedLanguages())
        ));
        String sourceCode = request.sourceCode() == null ? "" : request.sourceCode();
        String stdin = request.stdin() == null ? "" : request.stdin();
        if (sourceCode.isBlank()) {
            throw new ExecutionApiException(HttpStatus.BAD_REQUEST, "source_required", "Source code is required");
        }
        if (sourceCode.getBytes(StandardCharsets.UTF_8).length > properties.getMaxSourceBytes()) {
            throw new ExecutionApiException(HttpStatus.PAYLOAD_TOO_LARGE, "source_too_large", "Source code exceeds the configured size limit");
        }
        if (stdin.getBytes(StandardCharsets.UTF_8).length > properties.getMaxStdinBytes()) {
            throw new ExecutionApiException(HttpStatus.PAYLOAD_TOO_LARGE, "stdin_too_large", "Standard input exceeds the configured size limit");
        }
        if ("java".equals(language) && !JAVA_MAIN_CLASS.matcher(sourceCode).find()) {
            throw new ExecutionApiException(HttpStatus.BAD_REQUEST, "java_main_required", "Java source must define a class named Main");
        }
        return new ValidatedRequest(languageId, sourceCode, stdin);
    }

    private void requireActiveMembership(String roomCode, String userId) {
        if (!roomState.roomExists(roomCode)) {
            throw new ExecutionApiException(HttpStatus.NOT_FOUND, "room_not_found", "Room not found");
        }
        if (!roomState.isActiveMember(roomCode, userId)) {
            throw new ExecutionApiException(HttpStatus.FORBIDDEN, "room_forbidden", "You must be an active room member to run code");
        }
    }

    private void enforceRateLimit(String roomCode, String userId) {
        String key = roomCode + ":" + userId;
        Deque<Instant> window = rateWindows.computeIfAbsent(key, ignored -> new ArrayDeque<>());
        synchronized (window) {
            Instant cutoff = Instant.now().minusSeconds(60);
            while (!window.isEmpty() && window.peekFirst().isBefore(cutoff)) {
                window.removeFirst();
            }
            if (window.size() >= Math.max(1, properties.getRateLimitPerMinute())) {
                throw new ExecutionApiException(HttpStatus.TOO_MANY_REQUESTS, "execution_rate_limited", "Too many executions. Try again in a minute.");
            }
            window.addLast(Instant.now());
        }
    }

    private String normalizeIdempotencyKey(String raw) {
        String key = raw == null ? "" : raw.trim();
        if (key.isBlank()) {
            throw new ExecutionApiException(HttpStatus.BAD_REQUEST, "idempotency_key_required", "Idempotency-Key header is required");
        }
        if (key.length() > 128) {
            throw new ExecutionApiException(HttpStatus.BAD_REQUEST, "invalid_idempotency_key", "Idempotency-Key must be 128 characters or fewer");
        }
        return key;
    }

    private String requireUserId(String raw) {
        String userId = raw == null ? "" : raw.trim();
        if (userId.isBlank() || userId.length() > 128) {
            throw new ExecutionApiException(HttpStatus.UNAUTHORIZED, "session_required", "A valid room session is required");
        }
        return userId;
    }

    private String normalizeRoomCode(String raw) {
        return raw == null ? "" : raw.trim().replaceAll("[\\s-]+", "").toUpperCase();
    }

    private void sleepUntilNextPoll(Instant deadline) {
        long remaining = Math.max(0, java.time.Duration.between(Instant.now(), deadline).toMillis());
        long delay = Math.min(Math.max(1, properties.getPollInterval().toMillis()), remaining);
        try {
            Thread.sleep(delay);
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new ExecutionProviderException("Execution polling was interrupted", false, exception);
        }
    }

    private long elapsedMs(long startedAt) {
        return TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - startedAt);
    }

    @Scheduled(fixedDelay = 60_000)
    void expireRecords() {
        OffsetDateTime cutoff = OffsetDateTime.now().minus(properties.getRecordTtl());
        records.entrySet().removeIf(entry -> entry.getValue().createdAt().isBefore(cutoff));
        Instant now = Instant.now();
        idempotencyEntries.entrySet().removeIf(entry -> entry.getValue().expiresAt().isBefore(now));
        rateWindows.entrySet().removeIf(entry -> {
            Deque<Instant> window = entry.getValue();
            synchronized (window) {
                return window.isEmpty() || window.peekLast().isBefore(now.minusSeconds(60));
            }
        });
    }

    @PreDestroy
    void shutdown() {
        executor.shutdownNow();
    }

    private record ValidatedRequest(int languageId, String sourceCode, String stdin) {}
    private record IdempotencyEntry(UUID executionId, Instant expiresAt) {}
}
