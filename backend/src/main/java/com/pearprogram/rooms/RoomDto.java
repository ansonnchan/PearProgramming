package com.pearprogram.rooms;

import java.time.OffsetDateTime;
import java.util.UUID;

public record RoomDto(
        String id,
        String code,
        UUID workspaceId,
        String joinUrl,
        boolean active,
        OffsetDateTime createdAt,
        int memberCount,
        int maxUsers,
        boolean locked,
        String leadUserId
) {
}
