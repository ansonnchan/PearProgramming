package com.pearprogram.execution;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.DataAccessException;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ZSetOperations;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

@Component
class RedisExecutionCoordinator implements ExecutionCoordinator {
    private static final Logger log = LoggerFactory.getLogger(RedisExecutionCoordinator.class);
    private static final Set<String> TERMINAL = Set.of("COMPLETED", "COMPILATION_ERROR", "RUNTIME_ERROR", "TIMED_OUT", "FAILED", "CANCELLED");

    private static final DefaultRedisScript<List> CREATE = script("""
            local existing = redis.call('GET', KEYS[1])
            if existing then return {existing, '0'} end
            redis.call('ZREMRANGEBYSCORE', KEYS[5], '-inf', ARGV[2])
            if redis.call('ZCARD', KEYS[5]) >= tonumber(ARGV[3]) then return {'RATE_LIMIT', '0'} end
            if not redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[4], 'NX') then
              return {redis.call('GET', KEYS[1]), '0'}
            end
            redis.call('HSET', KEYS[2], 'id', ARGV[1], 'status', 'QUEUED', 'roomCode', ARGV[5],
              'ownerUserId', ARGV[6], 'createdAt', ARGV[7], 'completedAt', '', 'stdout', '', 'stderr', '',
              'compileOutput', '', 'exitCode', '', 'durationMs', '', 'message', '')
            redis.call('PEXPIRE', KEYS[2], ARGV[4])
            redis.call('HSET', KEYS[3], 'executionId', ARGV[1], 'roomCode', ARGV[5], 'ownerUserId', ARGV[6],
              'languageId', ARGV[8], 'sourceCode', ARGV[9], 'stdin', ARGV[10], 'createdAt', ARGV[7],
              'deadline', ARGV[11], 'retryCount', '0', 'maxRetries', ARGV[12], 'providerToken', '', 'leaseOwner', '')
            redis.call('PEXPIRE', KEYS[3], ARGV[4])
            redis.call('ZADD', KEYS[4], ARGV[7], ARGV[1])
            redis.call('ZADD', KEYS[5], ARGV[7], ARGV[1])
            redis.call('PEXPIRE', KEYS[5], '61000')
            return {ARGV[1], '1'}
            """, List.class);

    private static final DefaultRedisScript<String> CLAIM = script("""
            if redis.call('ZSCORE', KEYS[1], ARGV[1]) == false then return nil end
            local score = tonumber(redis.call('ZSCORE', KEYS[1], ARGV[1]))
            if score > tonumber(ARGV[2]) then return nil end
            if redis.call('EXISTS', KEYS[3]) == 0 or redis.call('EXISTS', KEYS[4]) == 0 then
              redis.call('ZREM', KEYS[1], ARGV[1]); redis.call('DEL', KEYS[3]); return nil
            end
            if redis.call('ZREM', KEYS[1], ARGV[1]) == 0 then return nil end
            redis.call('HSET', KEYS[3], 'leaseOwner', ARGV[3])
            redis.call('ZADD', KEYS[2], ARGV[4], ARGV[1])
            local status = redis.call('HGET', KEYS[4], 'status')
            if status == 'QUEUED' then redis.call('HSET', KEYS[4], 'status', 'CLAIMED') end
            return ARGV[1]
            """, String.class);

    private static final DefaultRedisScript<Long> SAVE_TOKEN = script("""
            if redis.call('HGET', KEYS[1], 'leaseOwner') ~= ARGV[2] then return 0 end
            local status = redis.call('HGET', KEYS[2], 'status')
            if status == false or status == 'COMPLETED' or status == 'COMPILATION_ERROR' or status == 'RUNTIME_ERROR'
              or status == 'TIMED_OUT' or status == 'FAILED' or status == 'CANCELLED' then return 0 end
            redis.call('HSET', KEYS[1], 'providerToken', ARGV[1])
            redis.call('HSET', KEYS[2], 'status', 'SUBMITTED')
            redis.call('PEXPIRE', KEYS[1], ARGV[3]); redis.call('PEXPIRE', KEYS[2], ARGV[3])
            return 1
            """, Long.class);

    private static final DefaultRedisScript<Long> RENEW_LEASE = script("""
            if redis.call('HGET', KEYS[2], 'leaseOwner') ~= ARGV[2] then return 0 end
            if redis.call('ZSCORE', KEYS[1], ARGV[1]) == false then return 0 end
            redis.call('ZADD', KEYS[1], ARGV[3], ARGV[1]); return 1
            """, Long.class);

    private static final DefaultRedisScript<Long> APPLY = script("""
            local current = redis.call('HGET', KEYS[1], 'status')
            if current == false or current == 'COMPLETED' or current == 'COMPILATION_ERROR' or current == 'RUNTIME_ERROR'
              or current == 'TIMED_OUT' or current == 'FAILED' or current == 'CANCELLED' then return 0 end
            redis.call('HSET', KEYS[1], 'status', ARGV[1], 'stdout', ARGV[2], 'stderr', ARGV[3],
              'compileOutput', ARGV[4], 'exitCode', ARGV[5], 'durationMs', ARGV[6], 'message', ARGV[7])
            if ARGV[8] == '1' then redis.call('HSET', KEYS[1], 'completedAt', ARGV[9]) end
            redis.call('PEXPIRE', KEYS[1], ARGV[10])
            return 1
            """, Long.class);

    private static final DefaultRedisScript<Long> FAIL = script("""
            local current = redis.call('HGET', KEYS[1], 'status')
            if current == false or current == 'COMPLETED' or current == 'COMPILATION_ERROR' or current == 'RUNTIME_ERROR'
              or current == 'TIMED_OUT' or current == 'FAILED' or current == 'CANCELLED' then return 0 end
            redis.call('HSET', KEYS[1], 'status', ARGV[1], 'message', ARGV[2], 'durationMs', ARGV[3], 'completedAt', ARGV[4])
            redis.call('PEXPIRE', KEYS[1], ARGV[5])
            return 1
            """, Long.class);

    private static final DefaultRedisScript<Long> RESCHEDULE = script("""
            if redis.call('HGET', KEYS[3], 'leaseOwner') ~= ARGV[2] then return 0 end
            redis.call('ZREM', KEYS[2], ARGV[1])
            local retries = redis.call('HINCRBY', KEYS[3], 'retryCount', 1)
            local maxRetries = tonumber(redis.call('HGET', KEYS[3], 'maxRetries') or '0')
            if retries > maxRetries then
              local status = redis.call('HGET', KEYS[4], 'status')
              if status ~= 'COMPLETED' and status ~= 'COMPILATION_ERROR' and status ~= 'RUNTIME_ERROR'
                and status ~= 'TIMED_OUT' and status ~= 'FAILED' and status ~= 'CANCELLED' then
                redis.call('HSET', KEYS[4], 'status', 'FAILED', 'message', ARGV[4], 'completedAt', ARGV[5])
                redis.call('PEXPIRE', KEYS[4], ARGV[6])
              end
              redis.call('DEL', KEYS[3]); return 2
            end
            redis.call('HSET', KEYS[3], 'leaseOwner', '')
            local token = redis.call('HGET', KEYS[3], 'providerToken')
            redis.call('HSET', KEYS[4], 'status', token ~= false and token ~= '' and 'SUBMITTED' or 'QUEUED')
            redis.call('ZADD', KEYS[1], ARGV[3], ARGV[1])
            redis.call('PEXPIRE', KEYS[3], ARGV[6]); redis.call('PEXPIRE', KEYS[4], ARGV[6])
            return 1
            """, Long.class);

    private static final DefaultRedisScript<Long> ACKNOWLEDGE = script("""
            local owner = redis.call('HGET', KEYS[3], 'leaseOwner')
            if owner ~= false and owner ~= '' and owner ~= ARGV[2] then return 0 end
            redis.call('ZREM', KEYS[1], ARGV[1]); redis.call('ZREM', KEYS[2], ARGV[1]); redis.call('DEL', KEYS[3])
            return 1
            """, Long.class);

    private static final DefaultRedisScript<Long> RECOVER = script("""
            local score = redis.call('ZSCORE', KEYS[2], ARGV[1])
            if score == false or tonumber(score) > tonumber(ARGV[2]) then return 0 end
            redis.call('ZREM', KEYS[2], ARGV[1])
            if redis.call('EXISTS', KEYS[3]) == 0 then return 0 end
            local retries = redis.call('HINCRBY', KEYS[3], 'retryCount', 1)
            local maxRetries = tonumber(redis.call('HGET', KEYS[3], 'maxRetries') or '0')
            if retries > maxRetries then
              local status = redis.call('HGET', KEYS[4], 'status')
              if status ~= 'COMPLETED' and status ~= 'COMPILATION_ERROR' and status ~= 'RUNTIME_ERROR'
                and status ~= 'TIMED_OUT' and status ~= 'FAILED' and status ~= 'CANCELLED' then
                redis.call('HSET', KEYS[4], 'status', 'FAILED', 'message', ARGV[3], 'completedAt', ARGV[4])
                redis.call('PEXPIRE', KEYS[4], ARGV[5])
              end
              redis.call('DEL', KEYS[3]); return 2
            end
            redis.call('HSET', KEYS[3], 'leaseOwner', '')
            local token = redis.call('HGET', KEYS[3], 'providerToken')
            redis.call('HSET', KEYS[4], 'status', token ~= false and token ~= '' and 'SUBMITTED' or 'QUEUED')
            redis.call('ZADD', KEYS[1], ARGV[2], ARGV[1])
            redis.call('PEXPIRE', KEYS[3], ARGV[5]); redis.call('PEXPIRE', KEYS[4], ARGV[5])
            return 1
            """, Long.class);

    private final StringRedisTemplate redis;
    private final String prefix;

    RedisExecutionCoordinator(StringRedisTemplate redis, @Value("${pearprogram.redis.key-prefix:pearprogram}") String prefix) {
        this.redis = redis;
        this.prefix = normalizePrefix(prefix) + ":execution";
    }

    @Override
    public ExecutionCreateResult create(ExecutionJob job, String idempotencyKey, Duration ttl, int rateLimitPerMinute) {
        long now = job.createdAt().toEpochMilli();
        try {
            List<?> result = redis.execute(CREATE, List.of(
                            idempotencyKey(job.roomCode(), job.ownerUserId(), idempotencyKey), recordKey(job.executionId()),
                            jobKey(job.executionId()), queueKey(), rateKey(job.roomCode(), job.ownerUserId())),
                    job.executionId().toString(), Long.toString(now - 60_000), Integer.toString(Math.max(1, rateLimitPerMinute)),
                    Long.toString(ttl.toMillis()), job.roomCode(), job.ownerUserId(), Long.toString(now),
                    Integer.toString(job.languageId()), job.sourceCode(), job.stdin(), Long.toString(job.deadline().toEpochMilli()),
                    Integer.toString(job.maxRetries()));
            if (result == null || result.size() < 2) throw unavailable(null);
            String id = value(result.get(0));
            if ("RATE_LIMIT".equals(id)) {
                throw new ExecutionApiException(HttpStatus.TOO_MANY_REQUESTS, "execution_rate_limited", "Too many executions. Try again in a minute.");
            }
            return new ExecutionCreateResult(UUID.fromString(id), "1".equals(value(result.get(1))));
        } catch (ExecutionApiException exception) {
            throw exception;
        } catch (DataAccessException | IllegalArgumentException exception) {
            throw unavailable(exception);
        }
    }

    @Override
    public Optional<ExecutionRecordSnapshot> find(UUID executionId) {
        try {
            Map<Object, Object> values = redis.opsForHash().entries(recordKey(executionId));
            if (values.isEmpty()) return Optional.empty();
            return Optional.of(new ExecutionRecordSnapshot(get(values, "roomCode"), get(values, "ownerUserId"), toResponse(values)));
        } catch (DataAccessException | IllegalArgumentException exception) {
            throw unavailable(exception);
        }
    }

    @Override
    public Optional<ExecutionJob> claim(String workerId, Instant now, Duration leaseDuration) {
        try {
            Set<ZSetOperations.TypedTuple<String>> candidates = redis.opsForZSet().rangeWithScores(queueKey(), 0, 0);
            if (candidates == null || candidates.isEmpty()) return Optional.empty();
            ZSetOperations.TypedTuple<String> candidate = candidates.iterator().next();
            if (candidate.getScore() == null || candidate.getScore() > now.toEpochMilli()) return Optional.empty();
            String id = candidate.getValue();
            if (id == null) return Optional.empty();
            UUID executionId = UUID.fromString(id);
            String claimed = redis.execute(CLAIM, List.of(queueKey(), leasesKey(), jobKey(executionId), recordKey(executionId)),
                    id, Long.toString(now.toEpochMilli()), workerId, Long.toString(now.plus(leaseDuration).toEpochMilli()));
            if (claimed == null) return Optional.empty();
            Map<Object, Object> values = redis.opsForHash().entries(jobKey(executionId));
            return values.isEmpty() ? Optional.empty() : Optional.of(toJob(values));
        } catch (DataAccessException | IllegalArgumentException exception) {
            log.warn("Execution worker could not claim Redis work. reason={}", rootMessage(exception));
            return Optional.empty();
        }
    }

    @Override
    public boolean saveProviderToken(UUID id, String workerId, String token, Duration ttl) {
        return one(redis.execute(SAVE_TOKEN, List.of(jobKey(id), recordKey(id)), token, workerId, Long.toString(ttl.toMillis())));
    }

    @Override
    public boolean renewLease(UUID id, String workerId, Instant leaseUntil) {
        return one(redis.execute(RENEW_LEASE, List.of(leasesKey(), jobKey(id)), id.toString(), workerId, Long.toString(leaseUntil.toEpochMilli())));
    }

    @Override
    public boolean applyResult(UUID id, ProviderExecutionResult result, Duration ttl) {
        return one(redis.execute(APPLY, List.of(recordKey(id)), result.status().name(), empty(result.stdout()), empty(result.stderr()),
                empty(result.compileOutput()), number(result.exitCode()), number(result.durationMs()), empty(result.message()),
                result.status().isTerminal() ? "1" : "0", Long.toString(Instant.now().toEpochMilli()), Long.toString(ttl.toMillis())));
    }

    @Override
    public boolean fail(UUID id, ExecutionStatus status, String message, long durationMs, Duration ttl) {
        if (!status.isTerminal()) throw new IllegalArgumentException("Failure status must be terminal");
        return one(redis.execute(FAIL, List.of(recordKey(id)), status.name(), message, Long.toString(durationMs),
                Long.toString(Instant.now().toEpochMilli()), Long.toString(ttl.toMillis())));
    }

    @Override
    public ExecutionRescheduleResult reschedule(UUID id, String workerId, Instant availableAt, String message, Duration ttl) {
        Long result = redis.execute(RESCHEDULE, List.of(queueKey(), leasesKey(), jobKey(id), recordKey(id)), id.toString(), workerId,
                Long.toString(availableAt.toEpochMilli()), message, Long.toString(Instant.now().toEpochMilli()), Long.toString(ttl.toMillis()));
        return result == null || result == 0 ? ExecutionRescheduleResult.LEASE_LOST
                : result == 2 ? ExecutionRescheduleResult.RETRIES_EXHAUSTED : ExecutionRescheduleResult.RESCHEDULED;
    }

    @Override
    public void acknowledge(UUID id, String workerId) {
        redis.execute(ACKNOWLEDGE, List.of(queueKey(), leasesKey(), jobKey(id)), id.toString(), workerId);
    }

    @Override
    public int recoverExpiredLeases(Instant now, String message, Duration ttl) {
        Set<String> expired = redis.opsForZSet().rangeByScore(leasesKey(), 0, now.toEpochMilli(), 0, 100);
        if (expired == null) return 0;
        int recovered = 0;
        for (String id : new ArrayList<>(expired)) {
            UUID executionId;
            try { executionId = UUID.fromString(id); } catch (IllegalArgumentException ignored) { redis.opsForZSet().remove(leasesKey(), id); continue; }
            Long result = redis.execute(RECOVER, List.of(queueKey(), leasesKey(), jobKey(executionId), recordKey(executionId)), id,
                    Long.toString(now.toEpochMilli()), message, Long.toString(now.toEpochMilli()), Long.toString(ttl.toMillis()));
            if (result != null && result > 0) recovered++;
        }
        return recovered;
    }

    @Override
    public long queueDepth() {
        Long size = redis.opsForZSet().size(queueKey());
        return size == null ? 0 : size;
    }

    private ExecutionResponse toResponse(Map<Object, Object> map) {
        return new ExecutionResponse(UUID.fromString(get(map, "id")), ExecutionStatus.valueOf(get(map, "status")),
                nullable(map, "stdout"), nullable(map, "stderr"), nullable(map, "compileOutput"), integer(map, "exitCode"),
                longValue(map, "durationMs"), nullable(map, "message"), offset(map, "createdAt"), optionalOffset(map, "completedAt"));
    }

    private ExecutionJob toJob(Map<Object, Object> map) {
        return new ExecutionJob(UUID.fromString(get(map, "executionId")), get(map, "roomCode"), get(map, "ownerUserId"),
                Integer.parseInt(get(map, "languageId")), get(map, "sourceCode"), get(map, "stdin"), instant(map, "createdAt"),
                instant(map, "deadline"), Integer.parseInt(get(map, "retryCount")), Integer.parseInt(get(map, "maxRetries")),
                get(map, "providerToken"), get(map, "leaseOwner"));
    }

    private ExecutionApiException unavailable(Exception exception) {
        if (exception != null) log.warn("Redis execution coordination unavailable. reason={}", rootMessage(exception));
        return new ExecutionApiException(HttpStatus.SERVICE_UNAVAILABLE, "execution_service_unavailable", "Code execution is temporarily unavailable.");
    }

    private String recordKey(UUID id) { return prefix + ":record:" + id; }
    private String jobKey(UUID id) { return prefix + ":job:" + id; }
    private String queueKey() { return prefix + ":queue"; }
    private String leasesKey() { return prefix + ":leases"; }
    private String idempotencyKey(String room, String user, String key) { return prefix + ":idempotency:" + digest(room + ":" + user + ":" + key); }
    private String rateKey(String room, String user) { return prefix + ":rate:" + digest(room + ":" + user); }

    private static <T> DefaultRedisScript<T> script(String source, Class<T> type) { return new DefaultRedisScript<>(source, type); }
    private static boolean one(Long value) { return value != null && value == 1; }
    private static String value(Object value) { return value instanceof byte[] bytes ? new String(bytes, StandardCharsets.UTF_8) : String.valueOf(value); }
    private static String get(Map<Object, Object> map, String key) { return String.valueOf(map.getOrDefault(key, "")); }
    private static String nullable(Map<Object, Object> map, String key) { String value = get(map, key); return value.isEmpty() ? null : value; }
    private static Integer integer(Map<Object, Object> map, String key) { String value = get(map, key); return value.isEmpty() ? null : Integer.valueOf(value); }
    private static Long longValue(Map<Object, Object> map, String key) { String value = get(map, key); return value.isEmpty() ? null : Long.valueOf(value); }
    private static Instant instant(Map<Object, Object> map, String key) { return Instant.ofEpochMilli(Long.parseLong(get(map, key))); }
    private static OffsetDateTime offset(Map<Object, Object> map, String key) { return OffsetDateTime.ofInstant(instant(map, key), ZoneOffset.UTC); }
    private static OffsetDateTime optionalOffset(Map<Object, Object> map, String key) { String value = get(map, key); return value.isEmpty() ? null : OffsetDateTime.ofInstant(Instant.ofEpochMilli(Long.parseLong(value)), ZoneOffset.UTC); }
    private static String empty(Object value) { return value == null ? "" : String.valueOf(value); }
    private static String number(Number value) { return value == null ? "" : value.toString(); }
    private static String normalizePrefix(String value) { return value == null || value.isBlank() ? "pearprogram" : value.trim().replaceAll(":+$", ""); }
    private static String digest(String value) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8))); }
        catch (NoSuchAlgorithmException exception) { throw new IllegalStateException(exception); }
    }
    private static String rootMessage(Throwable error) { Throwable root = error; while (root.getCause() != null) root = root.getCause(); return root.getMessage() == null ? root.getClass().getSimpleName() : root.getMessage(); }
}
