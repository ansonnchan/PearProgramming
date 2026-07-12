package com.pearprogram.auth;

import java.time.OffsetDateTime;
import java.util.UUID;

public record AuthSessionResponse(
        UUID userId,
        String displayName,
        String avatarUrl,
        String realtimeToken,
        OffsetDateTime realtimeTokenExpiresAt
) {
}
