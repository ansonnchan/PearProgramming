package com.pearprogram.rooms;

import java.time.OffsetDateTime;

public record RoomCreateResponse(
        String code,
        String joinUrl,
        OffsetDateTime createdAt,
        int memberCount
) {
}