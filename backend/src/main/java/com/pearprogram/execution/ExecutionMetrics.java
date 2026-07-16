package com.pearprogram.execution;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.time.Instant;
import java.util.Locale;

@Component
final class ExecutionMetrics {
    static final String QUEUE_WAIT = "execution.queue.wait";
    static final String END_TO_END = "execution.end.to.end";
    static final String ORCHESTRATION_OVERHEAD = "execution.orchestration.overhead";
    static final String RECOVERY_DETECTION_DELAY = "execution.recovery.detection.delay";
    static final String RECOVERIES = "execution.recoveries";
    static final String QUEUE_DEPTH = "execution.queue.depth";

    private final MeterRegistry registry;

    @Autowired
    ExecutionMetrics(ObjectProvider<MeterRegistry> registries, ExecutionCoordinator coordinator) {
        this(registries.getIfAvailable(SimpleMeterRegistry::new), coordinator);
    }

    ExecutionMetrics(MeterRegistry registry, ExecutionCoordinator coordinator) {
        this.registry = registry;
        Gauge.builder(QUEUE_DEPTH, coordinator, ExecutionCoordinator::queueDepth)
                .description("Execution jobs currently available for workers to claim")
                .register(registry);
    }

    void recordQueueWait(ExecutionJob job, Instant claimedAt) {
        if (job.retryCount() != 0) {
            return;
        }
        timer(QUEUE_WAIT, "Time from execution acceptance to the initial worker claim")
                .record(nonNegative(Duration.between(job.createdAt(), claimedAt)));
    }

    void recordCompletion(ExecutionJob job, ExecutionStatus status, Long providerRuntimeMs, Instant completedAt) {
        Duration endToEnd = nonNegative(Duration.between(job.createdAt(), completedAt));
        String statusTag = status.name().toLowerCase(Locale.ROOT);
        timer(END_TO_END, "Time from execution acceptance to a terminal result", "status", statusTag)
                .record(endToEnd);

        if (providerRuntimeMs == null || providerRuntimeMs < 0) {
            return;
        }
        long overheadMs = Math.max(0, endToEnd.toMillis() - providerRuntimeMs);
        timer(ORCHESTRATION_OVERHEAD,
                "End-to-end execution time excluding Judge0-reported program runtime", "status", statusTag)
                .record(Duration.ofMillis(overheadMs));
    }

    void recordRecovery(ExecutionRecoveryBatch batch) {
        for (ExecutionRecoveryBatch.RecoveredLease lease : batch.leases()) {
            String outcome = lease.outcome().name().toLowerCase(Locale.ROOT);
            timer(RECOVERY_DETECTION_DELAY,
                    "Delay between worker lease expiration and recovery processing", "outcome", outcome)
                    .record(lease.detectionDelay());
            Counter.builder(RECOVERIES)
                    .description("Expired execution leases processed by recovery")
                    .tag("outcome", outcome)
                    .register(registry)
                    .increment();
        }
    }

    private Timer timer(String name, String description, String... tags) {
        return Timer.builder(name)
                .description(description)
                .tags(tags)
                .publishPercentileHistogram()
                .publishPercentiles(0.5, 0.95, 0.99)
                .register(registry);
    }

    private Duration nonNegative(Duration duration) {
        return duration.isNegative() ? Duration.ZERO : duration;
    }
}
