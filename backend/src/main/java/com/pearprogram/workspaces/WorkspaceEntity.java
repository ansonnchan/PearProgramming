package com.pearprogram.workspaces;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.OffsetDateTime;
import java.util.UUID;

@Entity
@Table(name = "workspaces")
public class WorkspaceEntity {
    @Id
    private UUID id;

    @Column(nullable = false, length = 160)
    private String name;

    @Column(name = "owner_user_id", nullable = false)
    private UUID ownerUserId;

    @Column(name = "created_at", nullable = false)
    private OffsetDateTime createdAt;

    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;

    protected WorkspaceEntity() {
    }

    public WorkspaceEntity(UUID id, String name, UUID ownerUserId) {
        OffsetDateTime now = OffsetDateTime.now();
        this.id = id;
        this.name = name;
        this.ownerUserId = ownerUserId;
        this.createdAt = now;
        this.updatedAt = now;
    }

    public UUID getId() { return id; }
    public String getName() { return name; }
    public UUID getOwnerUserId() { return ownerUserId; }
    public OffsetDateTime getCreatedAt() { return createdAt; }
    public OffsetDateTime getUpdatedAt() { return updatedAt; }
}
