package com.pearprogram.execution;

public record ProviderExecutionRequest(
        int languageId,
        String sourceCode,
        String stdin,
        int executionTimeoutSeconds
) {
}
