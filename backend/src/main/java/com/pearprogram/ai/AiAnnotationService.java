package com.pearprogram.ai;

import org.springframework.stereotype.Service;

import java.util.List;
import java.util.UUID;

@Service
public class AiAnnotationService {
    public List<AiAnnotationDto> listActive(String roomCode, UUID fileId) {
        return List.of();
    }

    public AiAnnotationDto create(String roomCode, CreateAnnotationRequest request) {
        return null;
    }

    public AiAnnotationDto createPlaceholderAnnotation(String roomCode, UUID fileId, int line, String displayName) {
        String user = displayName == null || displayName.isBlank() ? "A teammate" : displayName;
        String content = user + " is working near line " + line
                + ". Placeholder AI would compare this edit against recent diffs before making a concrete suggestion.";
        return null;
    }

    public void dismiss(UUID annotationId) {
        // No-op without a database; annotations are emitted as transient realtime events.
    }
}
