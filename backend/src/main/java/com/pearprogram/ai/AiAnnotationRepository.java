package com.pearprogram.ai;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface AiAnnotationRepository extends JpaRepository<AiAnnotationEntity, UUID> {
    List<AiAnnotationEntity> findAllByRoomIdAndFileIdAndDismissedFalseOrderByCreatedAtAsc(UUID roomId, UUID fileId);
}
