package com.pearprogram.rooms;

import java.time.OffsetDateTime;

public record RoomDto(
        String id,
        String code,
        String joinUrl,
        boolean active,
        OffsetDateTime createdAt,
        int memberCount,
        int maxUsers,
        boolean locked,
        String leadUserId
) {
}
