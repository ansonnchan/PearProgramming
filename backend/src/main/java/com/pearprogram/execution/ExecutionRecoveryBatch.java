package com.pearprogram.execution;

import java.time.Duration;
import java.util.List;
import java.util.UUID;

record ExecutionRecoveryBatch(List<RecoveredLease> leases) {
    ExecutionRecoveryBatch {
        leases = leases == null ? List.of() : List.copyOf(leases);
    }

    static ExecutionRecoveryBatch empty() {
        return new ExecutionRecoveryBatch(List.of());
    }

    int recoveredCount() {
        return leases.size();
    }

    record RecoveredLease(UUID executionId, Duration detectionDelay, Outcome outcome) {
        RecoveredLease {
            detectionDelay = detectionDelay == null || detectionDelay.isNegative() ? Duration.ZERO : detectionDelay;
        }
    }

    enum Outcome {
        REQUEUED,
        FINALIZED
    }
}
