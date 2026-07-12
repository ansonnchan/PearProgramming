package com.pearprogram.execution;

import java.time.OffsetDateTime;
import java.util.UUID;

public record ExecutionResponse(
        UUID executionId,
        ExecutionStatus status,
        String stdout,
        String stderr,
        String compileOutput,
        Integer exitCode,
        Long durationMs,
        String message,
        OffsetDateTime createdAt,
        OffsetDateTime completedAt
) {
}
