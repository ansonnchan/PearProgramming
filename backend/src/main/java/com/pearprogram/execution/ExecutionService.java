package com.pearprogram.execution;

import com.pearprogram.rooms.EphemeralRoomStateService;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.regex.Pattern;

@Service
public class ExecutionService {
    private static final Logger log = LoggerFactory.getLogger(ExecutionService.class);
    private static final Pattern JAVA_MAIN_CLASS = Pattern.compile("\\bclass\\s+Main\\b");
    private static final String PROVIDER_UNAVAILABLE = "The execution provider is temporarily unavailable.";

    private final ExecutionProvider provider;
    private final ExecutionLanguageRegistry languages;
    private final ExecutionProperties properties;
    private final EphemeralRoomStateService roomState;
    private final ExecutionCoordinator coordinator;
    private final ExecutionMetrics metrics;
    private final ThreadPoolExecutor executor;
    private final AtomicInteger activeWorkers = new AtomicInteger();
    private final AtomicBoolean acceptingWork = new AtomicBoolean(true);
    private final String workerId = UUID.randomUUID().toString();

    public ExecutionService(
            ExecutionProvider provider,
            ExecutionLanguageRegistry languages,
            ExecutionProperties properties,
            EphemeralRoomStateService roomState,
            ExecutionCoordinator coordinator,
            ExecutionMetrics metrics
    ) {
        this.provider = provider;
        this.languages = languages;
        this.properties = properties;
        this.roomState = roomState;
        this.coordinator = coordinator;
        this.metrics = metrics;
        int threads = Math.max(1, properties.getWorkerThreads());
        this.executor = new ThreadPoolExecutor(threads, threads, 0L, TimeUnit.MILLISECONDS,
                new ArrayBlockingQueue<>(threads), runnable -> {
                    Thread thread = new Thread(runnable, "pear-execution-worker-" + workerId.substring(0, 8));
                    thread.setDaemon(true);
                    return thread;
                }, new ThreadPoolExecutor.AbortPolicy());
    }

    public ExecutionResponse submit(String rawRoomCode, String rawUserId, String rawIdempotencyKey, ExecutionRequest request) {
        String roomCode = normalizeRoomCode(rawRoomCode);
        String userId = requireUserId(rawUserId);
        requireActiveMembership(roomCode, userId);
        ValidatedRequest validated = validate(request);
        String idempotencyKey = normalizeIdempotencyKey(rawIdempotencyKey);
        Instant createdAt = Instant.now();
        UUID executionId = UUID.randomUUID();
        ExecutionJob job = new ExecutionJob(executionId, roomCode, userId, validated.languageId(), validated.sourceCode(),
                validated.stdin(), createdAt, createdAt.plus(properties.getDeadline()), 0,
                Math.max(0, properties.getWorkerMaxRetries()), "", "");
        ExecutionCreateResult result = coordinator.create(job, idempotencyKey, properties.getRecordTtl(), properties.getRateLimitPerMinute());
        dispatch();
        return coordinator.find(result.executionId()).orElseThrow(() -> unavailable()).response();
    }

    public ExecutionResponse get(String rawRoomCode, UUID executionId, String rawUserId) {
        String roomCode = normalizeRoomCode(rawRoomCode);
        String userId = requireUserId(rawUserId);
        ExecutionRecordSnapshot record = coordinator.find(executionId)
                .orElseThrow(() -> new ExecutionApiException(HttpStatus.NOT_FOUND, "execution_not_found", "Execution not found"));
        if (!record.roomCode().equals(roomCode)) {
            throw new ExecutionApiException(HttpStatus.NOT_FOUND, "execution_not_found", "Execution not found");
        }
        if (!record.ownerUserId().equals(userId)) {
            throw new ExecutionApiException(HttpStatus.FORBIDDEN, "execution_forbidden", "You do not own this execution");
        }
        return record.response();
    }

    @Scheduled(fixedDelayString = "${pearprogram.execution.worker-poll-interval:200ms}")
    synchronized void dispatch() {
        if (!acceptingWork.get()) return;
        int capacity = Math.max(1, properties.getWorkerThreads());
        while (activeWorkers.get() < capacity) {
            Instant claimedAt = Instant.now();
            Optional<ExecutionJob> claimed = coordinator.claim(workerId, claimedAt, properties.getWorkerLease());
            if (claimed.isEmpty()) return;
            metrics.recordQueueWait(claimed.get(), claimedAt);
            activeWorkers.incrementAndGet();
            try {
                executor.execute(() -> {
                    try { execute(claimed.get()); }
                    finally { activeWorkers.decrementAndGet(); }
                });
            } catch (RejectedExecutionException exception) {
                activeWorkers.decrementAndGet();
                coordinator.reschedule(claimed.get().executionId(), workerId, Instant.now(), "The execution queue is full. Try again shortly.", properties.getRecordTtl());
                return;
            }
        }
    }

    @Scheduled(fixedDelayString = "${pearprogram.execution.worker-recovery-interval:5s}")
    void recoverStaleWork() {
        if (!acceptingWork.get()) return;
        ExecutionRecoveryBatch recovered = coordinator.recoverExpiredLeases(
                Instant.now(),
                "Execution could not be recovered after repeated worker failures.",
                properties.getRecordTtl()
        );
        metrics.recordRecovery(recovered);
        if (recovered.recoveredCount() > 0) {
            log.warn("Recovered stale execution leases count={} workerId={}", recovered.recoveredCount(), workerId);
        }
    }

    private void execute(ExecutionJob claimed) {
        long startedAt = System.nanoTime();
        UUID executionId = claimed.executionId();
        boolean terminal = false;
        try {
            if (Instant.now().isAfter(claimed.deadline())) {
                fail(claimed, ExecutionStatus.TIMED_OUT, "Execution exceeded its deadline.", startedAt);
                terminal = true;
                return;
            }
            if (!roomState.roomExists(claimed.roomCode())) {
                fail(claimed, ExecutionStatus.CANCELLED, "The room was closed before execution completed.", startedAt);
                terminal = true;
                return;
            }

            String token = claimed.providerToken();
            if (token == null || token.isBlank()) {
                token = provider.submit(new ProviderExecutionRequest(claimed.languageId(), claimed.sourceCode(), claimed.stdin(),
                        properties.getJudge0().getExecutionTimeoutSeconds()));
                if (!coordinator.saveProviderToken(executionId, workerId, token, properties.getRecordTtl())) return;
            }

            for (int attempt = 0; attempt < Math.max(1, properties.getMaxPollAttempts()); attempt++) {
                if (Instant.now().isAfter(claimed.deadline())) {
                    fail(claimed, ExecutionStatus.TIMED_OUT, "Execution exceeded its deadline.", startedAt);
                    terminal = true;
                    return;
                }
                if (!roomState.roomExists(claimed.roomCode())) {
                    fail(claimed, ExecutionStatus.CANCELLED, "The room was closed before execution completed.", startedAt);
                    terminal = true;
                    return;
                }
                if (!coordinator.renewLease(executionId, workerId, Instant.now().plus(properties.getWorkerLease()))) return;
                ProviderExecutionResult result = provider.getResult(token);
                boolean applied = coordinator.applyResult(executionId, result, properties.getRecordTtl());
                if (result.status().isTerminal()) {
                    if (applied) {
                        metrics.recordCompletion(claimed, result.status(), result.durationMs(), Instant.now());
                    }
                    terminal = true;
                    return;
                }
                sleepUntilNextPoll(claimed.deadline(), attempt);
            }
            fail(claimed, ExecutionStatus.TIMED_OUT, "Execution did not finish before the polling limit.", startedAt);
            terminal = true;
        } catch (ExecutionProviderException exception) {
            log.warn("Execution provider failure executionId={} retry={} transient={} reason={}", executionId,
                    claimed.retryCount(), exception.isTransientFailure(), exception.getMessage());
            if (exception.isTransientFailure() && Instant.now().isBefore(claimed.deadline())) {
                Duration backoff = retryBackoff(claimed.retryCount());
                ExecutionRescheduleResult result = coordinator.reschedule(executionId, workerId, Instant.now().plus(backoff),
                        PROVIDER_UNAVAILABLE, properties.getRecordTtl());
                terminal = result == ExecutionRescheduleResult.RETRIES_EXHAUSTED;
            } else {
                fail(claimed, ExecutionStatus.FAILED,
                        exception.isTransientFailure() ? PROVIDER_UNAVAILABLE : "The execution provider returned an invalid response.",
                        startedAt);
                terminal = true;
            }
        } catch (RuntimeException exception) {
            log.error("Unexpected execution failure executionId={}", executionId, exception);
            fail(claimed, ExecutionStatus.FAILED, "Execution failed because of an internal error.", startedAt);
            terminal = true;
        } finally {
            if (terminal) coordinator.acknowledge(executionId, workerId);
        }
    }

    private ValidatedRequest validate(ExecutionRequest request) {
        if (request == null) throw new ExecutionApiException(HttpStatus.BAD_REQUEST, "invalid_request", "Execution request is required");
        String language = languages.normalize(request.language());
        int languageId = languages.judge0Id(language).orElseThrow(() -> new ExecutionApiException(HttpStatus.BAD_REQUEST,
                "unsupported_language", "Supported languages are: " + String.join(", ", languages.supportedLanguages())));
        String sourceCode = request.sourceCode() == null ? "" : request.sourceCode();
        String stdin = request.stdin() == null ? "" : request.stdin();
        if (sourceCode.isBlank()) throw new ExecutionApiException(HttpStatus.BAD_REQUEST, "source_required", "Source code is required");
        if (sourceCode.getBytes(StandardCharsets.UTF_8).length > properties.getMaxSourceBytes())
            throw new ExecutionApiException(HttpStatus.PAYLOAD_TOO_LARGE, "source_too_large", "Source code exceeds the configured size limit");
        if (stdin.getBytes(StandardCharsets.UTF_8).length > properties.getMaxStdinBytes())
            throw new ExecutionApiException(HttpStatus.PAYLOAD_TOO_LARGE, "stdin_too_large", "Standard input exceeds the configured size limit");
        if ("java".equals(language) && !JAVA_MAIN_CLASS.matcher(sourceCode).find())
            throw new ExecutionApiException(HttpStatus.BAD_REQUEST, "java_main_required", "Java source must define a class named Main");
        return new ValidatedRequest(languageId, sourceCode, stdin);
    }

    private void requireActiveMembership(String roomCode, String userId) {
        if (!roomState.roomExists(roomCode)) throw new ExecutionApiException(HttpStatus.NOT_FOUND, "room_not_found", "Room not found");
        if (!roomState.isActiveMember(roomCode, userId))
            throw new ExecutionApiException(HttpStatus.FORBIDDEN, "room_forbidden", "You must be an active room member to run code");
    }

    private String normalizeIdempotencyKey(String raw) {
        String key = raw == null ? "" : raw.trim();
        if (key.isBlank()) throw new ExecutionApiException(HttpStatus.BAD_REQUEST, "idempotency_key_required", "Idempotency-Key header is required");
        if (key.length() > 128) throw new ExecutionApiException(HttpStatus.BAD_REQUEST, "invalid_idempotency_key", "Idempotency-Key must be 128 characters or fewer");
        return key;
    }

    private String requireUserId(String raw) {
        String userId = raw == null ? "" : raw.trim();
        if (userId.isBlank() || userId.length() > 128)
            throw new ExecutionApiException(HttpStatus.UNAUTHORIZED, "session_required", "A valid room session is required");
        return userId;
    }

    private String normalizeRoomCode(String raw) { return raw == null ? "" : raw.trim().replaceAll("[\\s-]+", "").toUpperCase(); }

    private void sleepUntilNextPoll(Instant deadline, int attempt) {
        long remaining = Math.max(0, Duration.between(Instant.now(), deadline).toMillis());
        long delay = pollDelayMillis(attempt, remaining);
        try { Thread.sleep(delay); }
        catch (InterruptedException exception) { Thread.currentThread().interrupt(); throw new ExecutionProviderException("Execution polling was interrupted", true, exception); }
    }

    long pollDelayMillis(int attempt, long remainingMillis) {
        long initial = Math.max(1, properties.getInitialPollInterval().toMillis());
        long maximum = Math.max(initial, properties.getPollInterval().toMillis());
        long multiplier = 1L << Math.min(Math.max(0, attempt), 10);
        long adaptive = initial > Long.MAX_VALUE / multiplier ? maximum : initial * multiplier;
        return Math.min(Math.min(maximum, adaptive), Math.max(0, remainingMillis));
    }

    private Duration retryBackoff(int retryCount) {
        long multiplier = 1L << Math.min(Math.max(0, retryCount), 6);
        long millis = Math.min(properties.getWorkerRetryBackoff().toMillis() * multiplier, 30_000);
        return Duration.ofMillis(Math.max(1, millis));
    }

    private long elapsedMs(long startedAt) { return TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - startedAt); }

    private void fail(ExecutionJob job, ExecutionStatus status, String message, long startedAt) {
        if (coordinator.fail(job.executionId(), status, message, elapsedMs(startedAt), properties.getRecordTtl())) {
            metrics.recordCompletion(job, status, null, Instant.now());
        }
    }

    private ExecutionApiException unavailable() { return new ExecutionApiException(HttpStatus.SERVICE_UNAVAILABLE, "execution_service_unavailable", "Code execution is temporarily unavailable."); }

    @PreDestroy
    void shutdown() {
        acceptingWork.set(false);
        executor.shutdown();
        try {
            if (!executor.awaitTermination(5, TimeUnit.SECONDS)) executor.shutdownNow();
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            executor.shutdownNow();
        }
    }

    int activeWorkerCount() { return activeWorkers.get(); }
    boolean acceptingWork() { return acceptingWork.get(); }
    long queueDepth() { return coordinator.queueDepth(); }

    private record ValidatedRequest(int languageId, String sourceCode, String stdin) {}
}
