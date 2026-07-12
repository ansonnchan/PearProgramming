package com.pearprogram.rooms;

import java.time.OffsetDateTime;
import java.util.UUID;

public record RoomCreateResponse(
        String code,
        UUID workspaceId,
        String joinUrl,
        OffsetDateTime createdAt,
        int memberCount
) {
}
