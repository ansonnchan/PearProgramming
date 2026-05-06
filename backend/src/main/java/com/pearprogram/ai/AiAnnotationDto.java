package com.pearprogram.ai;

import java.time.OffsetDateTime;
import java.util.UUID;

public record AiAnnotationDto(
        UUID id,
        UUID fileId,
        String roomCode,
        String triggeredBy,
        int line,
        String content,
        OffsetDateTime createdAt
) {
}
