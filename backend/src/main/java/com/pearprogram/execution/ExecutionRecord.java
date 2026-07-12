package com.pearprogram.execution;

import java.time.OffsetDateTime;
import java.util.UUID;

final class ExecutionRecord {
    private final UUID id;
    private final String roomCode;
    private final String ownerUserId;
    private final OffsetDateTime createdAt = OffsetDateTime.now();
    private ExecutionStatus status = ExecutionStatus.QUEUED;
    private String stdout;
    private String stderr;
    private String compileOutput;
    private Integer exitCode;
    private Long durationMs;
    private String message;
    private OffsetDateTime completedAt;

    ExecutionRecord(UUID id, String roomCode, String ownerUserId) {
        this.id = id;
        this.roomCode = roomCode;
        this.ownerUserId = ownerUserId;
    }

    synchronized boolean transition(ExecutionStatus next) {
        if (status.isTerminal() || !validTransition(status, next)) {
            return false;
        }
        status = next;
        if (next.isTerminal()) {
            completedAt = OffsetDateTime.now();
        }
        return true;
    }

    synchronized void apply(ProviderExecutionResult result) {
        if (!transition(result.status())) {
            return;
        }
        stdout = result.stdout();
        stderr = result.stderr();
        compileOutput = result.compileOutput();
        exitCode = result.exitCode();
        durationMs = result.durationMs();
        message = result.message();
    }

    synchronized void fail(ExecutionStatus terminalStatus, String safeMessage, long elapsedMs) {
        if (!terminalStatus.isTerminal() || !transition(terminalStatus)) {
            return;
        }
        message = safeMessage;
        durationMs = elapsedMs;
    }

    synchronized ExecutionResponse response() {
        return new ExecutionResponse(id, status, stdout, stderr, compileOutput, exitCode, durationMs,
                message, createdAt, completedAt);
    }

    UUID id() { return id; }
    String roomCode() { return roomCode; }
    String ownerUserId() { return ownerUserId; }
    OffsetDateTime createdAt() { return createdAt; }

    private boolean validTransition(ExecutionStatus current, ExecutionStatus next) {
        if (current == next) {
            return true;
        }
        return switch (current) {
            case QUEUED -> next == ExecutionStatus.SUBMITTED || next.isTerminal();
            case SUBMITTED -> next == ExecutionStatus.RUNNING || next.isTerminal();
            case RUNNING -> next.isTerminal();
            default -> false;
        };
    }
}
