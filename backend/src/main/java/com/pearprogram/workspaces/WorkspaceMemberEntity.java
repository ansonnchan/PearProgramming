package com.pearprogram.workspaces;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;

import java.time.OffsetDateTime;
import java.util.UUID;

@Entity
@Table(name = "workspace_members", uniqueConstraints = @UniqueConstraint(
        name = "uk_workspace_member", columnNames = {"workspace_id", "user_id"}
))
public class WorkspaceMemberEntity {
    @Id
    private UUID id;

    @Column(name = "workspace_id", nullable = false)
    private UUID workspaceId;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private WorkspaceMemberRole role;

    @Column(name = "created_at", nullable = false)
    private OffsetDateTime createdAt;

    protected WorkspaceMemberEntity() {
    }

    public WorkspaceMemberEntity(UUID workspaceId, UUID userId, WorkspaceMemberRole role) {
        this.id = UUID.randomUUID();
        this.workspaceId = workspaceId;
        this.userId = userId;
        this.role = role;
        this.createdAt = OffsetDateTime.now();
    }

    public UUID getId() { return id; }
    public UUID getWorkspaceId() { return workspaceId; }
    public UUID getUserId() { return userId; }
    public WorkspaceMemberRole getRole() { return role; }
}
