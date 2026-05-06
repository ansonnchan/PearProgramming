package com.pearprogram.files;

import java.time.OffsetDateTime;
import java.util.UUID;

public record FileDto(
        UUID id,
        UUID workspaceId,
        String path,
        String language,
        String content,
        OffsetDateTime createdAt,
        OffsetDateTime updatedAt
) {
}
