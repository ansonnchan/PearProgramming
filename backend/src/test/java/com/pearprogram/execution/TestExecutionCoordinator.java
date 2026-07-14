package com.pearprogram.execution;

import org.springframework.http.HttpStatus;

import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

final class TestExecutionCoordinator implements ExecutionCoordinator {
    private final Map<UUID, Stored> records = new HashMap<>();
    private final Map<UUID, ExecutionJob> jobs = new HashMap<>();
    private final Map<String, UUID> idempotency = new HashMap<>();
    private final Map<String, List<Instant>> rates = new HashMap<>();
    private final Map<UUID, Instant> available = new HashMap<>();
    private final Map<UUID, Instant> leases = new HashMap<>();

    @Override
    public synchronized ExecutionCreateResult create(ExecutionJob job, String key, Duration ttl, int rateLimit) {
        String scope = job.roomCode() + ':' + job.ownerUserId() + ':' + key;
        UUID existing = idempotency.get(scope);
        if (existing != null && records.containsKey(existing)) return new ExecutionCreateResult(existing, false);
        String rateScope = job.roomCode() + ':' + job.ownerUserId();
        List<Instant> window = rates.computeIfAbsent(rateScope, ignored -> new ArrayList<>());
        window.removeIf(time -> time.isBefore(job.createdAt().minusSeconds(60)));
        if (window.size() >= rateLimit) throw new ExecutionApiException(HttpStatus.TOO_MANY_REQUESTS, "execution_rate_limited", "Too many executions. Try again in a minute.");
        window.add(job.createdAt());
        idempotency.put(scope, job.executionId());
        jobs.put(job.executionId(), job);
        records.put(job.executionId(), new Stored(job, ttl));
        available.put(job.executionId(), job.createdAt());
        return new ExecutionCreateResult(job.executionId(), true);
    }

    @Override
    public synchronized Optional<ExecutionRecordSnapshot> find(UUID id) {
        Stored stored = records.get(id);
        if (stored == null || stored.expiresAt.isBefore(Instant.now())) {
            records.remove(id); jobs.remove(id); available.remove(id); leases.remove(id);
            return Optional.empty();
        }
        return Optional.of(new ExecutionRecordSnapshot(stored.roomCode, stored.owner, stored.response()));
    }

    @Override
    public synchronized Optional<ExecutionJob> claim(String worker, Instant now, Duration lease) {
        Optional<UUID> next = available.entrySet().stream().filter(entry -> !entry.getValue().isAfter(now))
                .min(Comparator.comparing(Map.Entry::getValue)).map(Map.Entry::getKey);
        if (next.isEmpty()) return Optional.empty();
        UUID id = next.get();
        available.remove(id);
        ExecutionJob job = jobs.get(id);
        if (job == null) return Optional.empty();
        ExecutionJob claimed = copy(job, job.retryCount(), job.providerToken(), worker);
        jobs.put(id, claimed); leases.put(id, now.plus(lease));
        if (records.get(id).status == ExecutionStatus.QUEUED) records.get(id).transition(ExecutionStatus.CLAIMED);
        return Optional.of(claimed);
    }

    @Override
    public synchronized boolean saveProviderToken(UUID id, String worker, String token, Duration ttl) {
        ExecutionJob job = jobs.get(id);
        if (job == null || !worker.equals(job.leaseOwner()) || records.get(id).terminal()) return false;
        jobs.put(id, copy(job, job.retryCount(), token, worker));
        records.get(id).transition(ExecutionStatus.SUBMITTED); records.get(id).touch(ttl);
        return true;
    }

    @Override
    public synchronized boolean renewLease(UUID id, String worker, Instant leaseUntil) {
        ExecutionJob job = jobs.get(id);
        if (job == null || !worker.equals(job.leaseOwner()) || !leases.containsKey(id)) return false;
        leases.put(id, leaseUntil);
        return true;
    }

    @Override
    public synchronized boolean applyResult(UUID id, ProviderExecutionResult result, Duration ttl) {
        Stored stored = records.get(id);
        if (stored == null || stored.terminal()) return false;
        stored.apply(result); stored.touch(ttl); return true;
    }

    @Override
    public synchronized boolean fail(UUID id, ExecutionStatus status, String message, long duration, Duration ttl) {
        Stored stored = records.get(id);
        if (stored == null || stored.terminal()) return false;
        stored.fail(status, message, duration); stored.touch(ttl); return true;
    }

    @Override
    public synchronized ExecutionRescheduleResult reschedule(UUID id, String worker, Instant at, String message, Duration ttl) {
        ExecutionJob job = jobs.get(id);
        if (job == null || !worker.equals(job.leaseOwner())) return ExecutionRescheduleResult.LEASE_LOST;
        leases.remove(id);
        int retries = job.retryCount() + 1;
        if (retries > job.maxRetries()) {
            fail(id, ExecutionStatus.FAILED, message, 0, ttl); jobs.remove(id); return ExecutionRescheduleResult.RETRIES_EXHAUSTED;
        }
        jobs.put(id, copy(job, retries, job.providerToken(), ""));
        records.get(id).forceNonTerminal(job.providerToken().isBlank() ? ExecutionStatus.QUEUED : ExecutionStatus.SUBMITTED);
        available.put(id, at);
        return ExecutionRescheduleResult.RESCHEDULED;
    }

    @Override
    public synchronized void acknowledge(UUID id, String worker) {
        ExecutionJob job = jobs.get(id);
        if (job == null || job.leaseOwner().isBlank() || worker.equals(job.leaseOwner())) {
            jobs.remove(id); available.remove(id); leases.remove(id);
        }
    }

    @Override
    public synchronized int recoverExpiredLeases(Instant now, String message, Duration ttl) {
        List<UUID> expired = leases.entrySet().stream().filter(entry -> !entry.getValue().isAfter(now)).map(Map.Entry::getKey).toList();
        int recovered = 0;
        for (UUID id : expired) {
            ExecutionJob job = jobs.get(id);
            if (job == null) continue;
            ExecutionRescheduleResult result = reschedule(id, job.leaseOwner(), now, message, ttl);
            if (result != ExecutionRescheduleResult.LEASE_LOST) recovered++;
        }
        return recovered;
    }

    @Override
    public synchronized long queueDepth() { return available.size(); }

    synchronized boolean hasJob(UUID id) { return jobs.containsKey(id); }
    synchronized void expire(UUID id) { Stored stored = records.get(id); if (stored != null) stored.expiresAt = Instant.EPOCH; }

    private ExecutionJob copy(ExecutionJob job, int retry, String token, String owner) {
        return new ExecutionJob(job.executionId(), job.roomCode(), job.ownerUserId(), job.languageId(), job.sourceCode(), job.stdin(),
                job.createdAt(), job.deadline(), retry, job.maxRetries(), token, owner);
    }

    private static final class Stored {
        private final UUID id; private final String roomCode; private final String owner; private final OffsetDateTime createdAt;
        private ExecutionStatus status = ExecutionStatus.QUEUED; private String stdout; private String stderr; private String compile;
        private Integer exitCode; private Long duration; private String message; private OffsetDateTime completedAt; private Instant expiresAt;
        Stored(ExecutionJob job, Duration ttl) { id = job.executionId(); roomCode = job.roomCode(); owner = job.ownerUserId(); createdAt = OffsetDateTime.ofInstant(job.createdAt(), ZoneOffset.UTC); touch(ttl); }
        void touch(Duration ttl) { expiresAt = Instant.now().plus(ttl); }
        boolean terminal() { return status.isTerminal(); }
        void transition(ExecutionStatus next) { if (!terminal()) status = next; }
        void forceNonTerminal(ExecutionStatus next) { if (!terminal()) status = next; }
        void apply(ProviderExecutionResult result) { transition(result.status()); stdout=result.stdout(); stderr=result.stderr(); compile=result.compileOutput(); exitCode=result.exitCode(); duration=result.durationMs(); message=result.message(); if(result.status().isTerminal()) completedAt=OffsetDateTime.now(); }
        void fail(ExecutionStatus next, String safe, long elapsed) { transition(next); message=safe; duration=elapsed; completedAt=OffsetDateTime.now(); }
        ExecutionResponse response() { return new ExecutionResponse(id,status,stdout,stderr,compile,exitCode,duration,message,createdAt,completedAt); }
    }
}
