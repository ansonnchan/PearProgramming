package com.pearprogram.chat;

import java.time.OffsetDateTime;
import java.util.UUID;

public record ChatMessageDto(
        UUID id,
        UUID userId,
        String displayName,
        String content,
        boolean ai,
        OffsetDateTime createdAt
) {
}
