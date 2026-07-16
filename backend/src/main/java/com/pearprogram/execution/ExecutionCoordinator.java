package com.pearprogram.execution;

import java.time.Duration;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

interface ExecutionCoordinator {
    ExecutionCreateResult create(
            ExecutionJob job,
            String idempotencyKey,
            Duration ttl,
            int rateLimitPerMinute
    );

    Optional<ExecutionRecordSnapshot> find(UUID executionId);

    Optional<ExecutionJob> claim(String workerId, Instant now, Duration leaseDuration);

    boolean saveProviderToken(UUID executionId, String workerId, String providerToken, Duration ttl);

    boolean renewLease(UUID executionId, String workerId, Instant leaseUntil);

    boolean applyResult(UUID executionId, ProviderExecutionResult result, Duration ttl);

    boolean fail(UUID executionId, ExecutionStatus status, String safeMessage, long durationMs, Duration ttl);

    ExecutionRescheduleResult reschedule(UUID executionId, String workerId, Instant availableAt, String safeFailureMessage, Duration ttl);

    void acknowledge(UUID executionId, String workerId);

    ExecutionRecoveryBatch recoverExpiredLeases(Instant now, String safeFailureMessage, Duration ttl);

    long queueDepth();

    default void cleanupRoom(String roomCode) {
    }
}
