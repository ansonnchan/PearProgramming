package com.pearprogram.execution;

public class ExecutionProviderException extends RuntimeException {
    private final boolean transientFailure;

    public ExecutionProviderException(String message, boolean transientFailure) {
        super(message);
        this.transientFailure = transientFailure;
    }

    public ExecutionProviderException(String message, boolean transientFailure, Throwable cause) {
        super(message, cause);
        this.transientFailure = transientFailure;
    }

    public boolean isTransientFailure() {
        return transientFailure;
    }
}
