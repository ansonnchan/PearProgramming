package com.pearprogram.execution;

public interface ExecutionProvider {
    String submit(ProviderExecutionRequest request);

    ProviderExecutionResult getResult(String submissionToken);
}
