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
    public static AiAnnotationDto from(AiAnnotation annotation) {
        String triggeredBy = annotation.getTriggeredBy() == null ? null : annotation.getTriggeredBy().getDisplayName();
        return new AiAnnotationDto(
                annotation.getId(),
                annotation.getFile().getId(),
                annotation.getRoom().getCode(),
                triggeredBy,
                annotation.getLine(),
                annotation.getContent(),
                annotation.getCreatedAt()
        );
    }
}
