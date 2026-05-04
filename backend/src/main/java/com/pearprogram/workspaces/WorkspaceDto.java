package com.pearprogram.workspaces;

import java.time.OffsetDateTime;
import java.util.UUID;

public record WorkspaceDto(UUID id, String name, OffsetDateTime createdAt) {
    public static WorkspaceDto from(Workspace workspace) {
        return new WorkspaceDto(workspace.getId(), workspace.getName(), workspace.getCreatedAt());
    }
}
