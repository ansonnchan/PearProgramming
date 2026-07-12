package com.pearprogram.rooms;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.OffsetDateTime;
import java.util.UUID;

@Entity
@Table(name = "rooms")
public class RoomEntity {
    @Id
    private UUID id;

    @Column(nullable = false, unique = true, length = 12)
    private String code;

    @Column(name = "workspace_id", nullable = false, unique = true)
    private UUID workspaceId;

    @Column(name = "owner_user_id", nullable = false)
    private UUID ownerUserId;

    @Column(nullable = false)
    private boolean active;

    @Column(name = "created_at", nullable = false)
    private OffsetDateTime createdAt;

    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;

    @Column(name = "closed_at")
    private OffsetDateTime closedAt;

    protected RoomEntity() {
    }

    public RoomEntity(String code, UUID workspaceId, UUID ownerUserId) {
        OffsetDateTime now = OffsetDateTime.now();
        this.id = UUID.randomUUID();
        this.code = code;
        this.workspaceId = workspaceId;
        this.ownerUserId = ownerUserId;
        this.active = true;
        this.createdAt = now;
        this.updatedAt = now;
    }

    public void close() {
        this.active = false;
        this.closedAt = OffsetDateTime.now();
        this.updatedAt = this.closedAt;
    }

    public UUID getId() { return id; }
    public String getCode() { return code; }
    public UUID getWorkspaceId() { return workspaceId; }
    public UUID getOwnerUserId() { return ownerUserId; }
    public boolean isActive() { return active; }
    public OffsetDateTime getCreatedAt() { return createdAt; }
    public OffsetDateTime getUpdatedAt() { return updatedAt; }
    public OffsetDateTime getClosedAt() { return closedAt; }
}
