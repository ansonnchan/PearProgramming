package com.pearprogram.rooms;

import java.time.OffsetDateTime;
import java.util.UUID;

public record RoomDto(
        UUID id,
        String code,
        UUID workspaceId,
        boolean active,
        OffsetDateTime createdAt,
        OffsetDateTime expiresAt
) {
    public static RoomDto from(Room room) {
        return new RoomDto(
                room.getId(),
                room.getCode(),
                room.getWorkspace().getId(),
                room.isActive(),
                room.getCreatedAt(),
                room.getExpiresAt()
        );
    }
}
