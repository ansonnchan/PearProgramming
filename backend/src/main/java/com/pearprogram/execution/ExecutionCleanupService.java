package com.pearprogram.execution;

import org.springframework.stereotype.Service;

@Service
public class ExecutionCleanupService {
    private final ExecutionCoordinator coordinator;

    ExecutionCleanupService(ExecutionCoordinator coordinator) {
        this.coordinator = coordinator;
    }

    public void cleanupRoom(String roomCode) {
        coordinator.cleanupRoom(roomCode);
    }
}
