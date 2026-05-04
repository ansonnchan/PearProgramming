package com.pearprogram.realtime;

import java.time.OffsetDateTime;
import java.util.UUID;

public record ChatOutboundMessage(
        UUID id,
        String userId,
        String displayName,
        String content,
        boolean ai,
        OffsetDateTime createdAt
) {
}
