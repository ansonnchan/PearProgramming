package com.pearprogram.rooms;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;

import java.time.OffsetDateTime;
import java.util.UUID;

@Entity
@Table(name = "room_members", uniqueConstraints = @UniqueConstraint(
        name = "uk_room_member", columnNames = {"room_id", "user_id"}
))
public class RoomMemberEntity {
    @Id
    private UUID id;

    @Column(name = "room_id", nullable = false)
    private UUID roomId;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "joined_at", nullable = false)
    private OffsetDateTime joinedAt;

    @Column(name = "last_seen_at", nullable = false)
    private OffsetDateTime lastSeenAt;

    protected RoomMemberEntity() {
    }

    public RoomMemberEntity(UUID roomId, UUID userId) {
        OffsetDateTime now = OffsetDateTime.now();
        this.id = UUID.randomUUID();
        this.roomId = roomId;
        this.userId = userId;
        this.joinedAt = now;
        this.lastSeenAt = now;
    }

    public void touch() {
        this.lastSeenAt = OffsetDateTime.now();
    }

    public UUID getId() { return id; }
    public UUID getRoomId() { return roomId; }
    public UUID getUserId() { return userId; }
    public OffsetDateTime getJoinedAt() { return joinedAt; }
    public OffsetDateTime getLastSeenAt() { return lastSeenAt; }
}
