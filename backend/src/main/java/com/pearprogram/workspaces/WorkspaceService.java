package com.pearprogram.workspaces;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.UUID;
import org.springframework.transaction.annotation.Transactional;

@Service
public class WorkspaceService {
    private final WorkspaceRepository workspaces;
    private final WorkspaceMemberRepository members;

    public WorkspaceService(WorkspaceRepository workspaces, WorkspaceMemberRepository members) {
        this.workspaces = workspaces;
        this.members = members;
    }

    @Transactional
    public WorkspaceDto createWorkspace(String name, String ownerUserId) {
        UUID ownerId = UUID.fromString(ownerUserId);
        WorkspaceEntity workspace = workspaces.save(new WorkspaceEntity(UUID.randomUUID(), name.trim(), ownerId));
        members.save(new WorkspaceMemberEntity(workspace.getId(), ownerId, WorkspaceMemberRole.OWNER));
        return toDto(workspace);
    }

    @Transactional(readOnly = true)
    public WorkspaceDto getWorkspace(UUID id, String userId) {
        return requireAccess(id, userId);
    }

    @Transactional(readOnly = true)
    public WorkspaceDto requireAccess(UUID id, String userId) {
        WorkspaceEntity workspace = requireEntity(id);
        if (!members.existsByWorkspaceIdAndUserId(id, UUID.fromString(userId))) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Workspace access denied");
        }
        return toDto(workspace);
    }

    @Transactional(readOnly = true)
    public List<WorkspaceDto> listForUser(String userId) {
        return members.findAllByUserId(UUID.fromString(userId)).stream()
                .map(member -> workspaces.findById(member.getWorkspaceId()).orElse(null))
                .filter(java.util.Objects::nonNull)
                .map(this::toDto)
                .sorted(java.util.Comparator.comparing(WorkspaceDto::createdAt))
                .toList();
    }

    @Transactional
    public void addMember(UUID workspaceId, UUID userId) {
        requireEntity(workspaceId);
        if (!members.existsByWorkspaceIdAndUserId(workspaceId, userId)) {
            members.save(new WorkspaceMemberEntity(workspaceId, userId, WorkspaceMemberRole.MEMBER));
        }
    }

    @Transactional(readOnly = true)
    public WorkspaceEntity requireEntity(UUID id) {
        return workspaces.findById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Workspace not found"));
    }

    @Transactional
    public void deleteWorkspace(UUID id) {
        WorkspaceEntity workspace = requireEntity(id);
        workspaces.delete(workspace);
    }

    private WorkspaceDto toDto(WorkspaceEntity workspace) {
        return new WorkspaceDto(workspace.getId(), workspace.getName(), workspace.getCreatedAt());
    }
}
