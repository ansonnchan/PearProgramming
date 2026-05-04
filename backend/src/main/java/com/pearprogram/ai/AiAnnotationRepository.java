package com.pearprogram.ai;

import org.springframework.data.jpa.repository.JpaRepository;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

public interface AiAnnotationRepository extends JpaRepository<AiAnnotation, UUID> {
    boolean existsByFile_IdAndLineAndCreatedAtAfterAndDismissedAtIsNull(UUID fileId, int line, OffsetDateTime since);

    List<AiAnnotation> findTop5ByFile_IdAndRoom_CodeAndDismissedAtIsNullOrderByCreatedAtDesc(UUID fileId, String roomCode);
}
