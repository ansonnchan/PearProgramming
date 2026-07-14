package com.pearprogram.execution;

import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class ExecutionCoordinatorTests {
    private final Duration ttl = Duration.ofMinutes(5);

    @Test
    void concurrentClaimsHaveOneOwner() {
        TestExecutionCoordinator coordinator = new TestExecutionCoordinator();
        ExecutionJob job = job(2);
        coordinator.create(job, "key", ttl, 10);

        assertThat(coordinator.claim("worker-a", Instant.now().plusSeconds(1), Duration.ofSeconds(10))).isPresent();
        assertThat(coordinator.claim("worker-b", Instant.now().plusSeconds(1), Duration.ofSeconds(10))).isEmpty();
        assertThat(coordinator.queueDepth()).isZero();
    }

    @Test
    void expiredLeaseIsRecoveredWithoutLosingProviderToken() {
        TestExecutionCoordinator coordinator = new TestExecutionCoordinator();
        ExecutionJob job = job(2);
        coordinator.create(job, "key", ttl, 10);
        coordinator.claim("crashed", Instant.now(), Duration.ZERO);
        coordinator.saveProviderToken(job.executionId(), "crashed", "judge-token", ttl);

        assertThat(coordinator.recoverExpiredLeases(Instant.now().plusMillis(1), "failed", ttl)).isEqualTo(1);
        ExecutionJob recovered = coordinator.claim("replacement", Instant.now().plusMillis(2), Duration.ofSeconds(10)).orElseThrow();
        assertThat(recovered.providerToken()).isEqualTo("judge-token");
        assertThat(recovered.retryCount()).isEqualTo(1);
        assertThat(coordinator.find(job.executionId()).orElseThrow().response().status()).isEqualTo(ExecutionStatus.SUBMITTED);
    }

    @Test
    void repeatedWorkerCrashesReachTerminalFailure() {
        TestExecutionCoordinator coordinator = new TestExecutionCoordinator();
        ExecutionJob job = job(1);
        coordinator.create(job, "key", ttl, 10);
        coordinator.claim("worker-a", Instant.now(), Duration.ZERO);
        coordinator.recoverExpiredLeases(Instant.now().plusMillis(1), "recovery exhausted", ttl);
        coordinator.claim("worker-b", Instant.now().plusMillis(2), Duration.ZERO);
        coordinator.recoverExpiredLeases(Instant.now().plusMillis(3), "recovery exhausted", ttl);

        ExecutionResponse response = coordinator.find(job.executionId()).orElseThrow().response();
        assertThat(response.status()).isEqualTo(ExecutionStatus.FAILED);
        assertThat(response.message()).isEqualTo("recovery exhausted");
        assertThat(coordinator.hasJob(job.executionId())).isFalse();
    }

    @Test
    void activeWorkerCanRenewItsLease() {
        TestExecutionCoordinator coordinator = new TestExecutionCoordinator();
        ExecutionJob job = job(1);
        Instant now = Instant.now();
        coordinator.create(job, "key", ttl, 10);
        coordinator.claim("worker-a", now.plusSeconds(1), Duration.ofMillis(1));
        coordinator.renewLease(job.executionId(), "worker-a", now.plusSeconds(30));

        assertThat(coordinator.recoverExpiredLeases(now.plusSeconds(2), "failed", ttl)).isZero();
        assertThat(coordinator.claim("worker-b", now.plusSeconds(2), Duration.ofSeconds(1))).isEmpty();
    }

    @Test
    void terminalStateCannotBeOverwrittenAndRecordsExpire() {
        TestExecutionCoordinator coordinator = new TestExecutionCoordinator();
        ExecutionJob job = job(1);
        coordinator.create(job, "key", ttl, 10);
        coordinator.fail(job.executionId(), ExecutionStatus.TIMED_OUT, "deadline", 10, ttl);

        assertThat(coordinator.applyResult(job.executionId(), new ProviderExecutionResult(
                ExecutionStatus.COMPLETED, "late", null, null, 0, 1L, null), ttl)).isFalse();
        assertThat(coordinator.find(job.executionId()).orElseThrow().response().status()).isEqualTo(ExecutionStatus.TIMED_OUT);
        coordinator.expire(job.executionId());
        assertThat(coordinator.find(job.executionId())).isEmpty();
    }

    private ExecutionJob job(int retries) {
        Instant now = Instant.now();
        return new ExecutionJob(UUID.randomUUID(), "ABC123", "user-1", 71, "print(1)", "", now,
                now.plusSeconds(30), 0, retries, "", "");
    }
}
