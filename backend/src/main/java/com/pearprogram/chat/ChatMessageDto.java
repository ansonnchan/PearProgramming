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
    public static ChatMessageDto from(ChatMessage message) {
        UUID userId = message.getUser() == null ? null : message.getUser().getId();
        String displayName = message.isAi()
                ? "AI"
                : message.getUser() == null ? "Guest" : message.getUser().getDisplayName();
        return new ChatMessageDto(
                message.getId(),
                userId,
                displayName,
                message.getContent(),
                message.isAi(),
                message.getCreatedAt()
        );
    }
}
