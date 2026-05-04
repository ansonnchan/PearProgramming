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
    public static FileDto from(WorkspaceFile file) {
        return new FileDto(
                file.getId(),
                file.getWorkspace().getId(),
                file.getPath(),
                file.getLanguage(),
                file.getContent(),
                file.getCreatedAt(),
                file.getUpdatedAt()
        );
    }
}
