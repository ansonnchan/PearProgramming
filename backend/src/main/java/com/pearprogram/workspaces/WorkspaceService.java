package com.pearprogram.workspaces;

import org.springframework.stereotype.Service;

import java.time.OffsetDateTime;
import java.util.UUID;

@Service
public class WorkspaceService {

    public WorkspaceDto createWorkspace(String name) {
        // Workspaces are no longer persisted; return a placeholder DTO.
        return new WorkspaceDto(UUID.randomUUID(), name, OffsetDateTime.now());
    }

    public WorkspaceDto getWorkspace(UUID id) {
        // Workspaces are no longer persisted; return a placeholder DTO.
        return new WorkspaceDto(id, "workspace", OffsetDateTime.now());
    }
}
