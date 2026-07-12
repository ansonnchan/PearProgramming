package com.pearprogram.execution;

public enum ExecutionStatus {
    QUEUED(false),
    SUBMITTED(false),
    RUNNING(false),
    COMPLETED(true),
    COMPILATION_ERROR(true),
    RUNTIME_ERROR(true),
    TIMED_OUT(true),
    FAILED(true);

    private final boolean terminal;

    ExecutionStatus(boolean terminal) {
        this.terminal = terminal;
    }

    public boolean isTerminal() {
        return terminal;
    }
}
