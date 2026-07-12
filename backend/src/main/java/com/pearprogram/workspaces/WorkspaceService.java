package com.pearprogram.workspaces;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.time.OffsetDateTime;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class WorkspaceService {
    private final Map<UUID, WorkspaceRecord> workspaces = new ConcurrentHashMap<>();

    public WorkspaceDto createWorkspace(String name, String ownerUserId) {
        WorkspaceDto workspace = new WorkspaceDto(UUID.randomUUID(), name.trim(), OffsetDateTime.now());
        workspaces.put(workspace.id(), new WorkspaceRecord(workspace, ownerUserId));
        return workspace;
    }

    public WorkspaceDto getWorkspace(UUID id, String userId) {
        return requireAccess(id, userId);
    }

    public WorkspaceDto requireAccess(UUID id, String userId) {
        WorkspaceRecord record = workspaces.get(id);
        if (record == null) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Workspace not found");
        }
        if (!record.ownerUserId().equals(userId)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Workspace access denied");
        }
        return record.workspace();
    }

    private record WorkspaceRecord(WorkspaceDto workspace, String ownerUserId) {}
}
