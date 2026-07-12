package com.pearprogram.execution;

public record ProviderExecutionResult(
        ExecutionStatus status,
        String stdout,
        String stderr,
        String compileOutput,
        Integer exitCode,
        Long durationMs,
        String message
) {
    public ProviderExecutionResult {
        if (status == null) {
            throw new IllegalArgumentException("Provider status is required");
        }
    }
}
