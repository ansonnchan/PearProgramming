package com.pearprogram.ai;

import org.springframework.stereotype.Service;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.UUID;

@Service
public class AiAnnotationService {
    public List<AiAnnotationDto> listActive(String roomCode, UUID fileId) {
        return List.of();
    }

    public AiAnnotationDto create(String roomCode, CreateAnnotationRequest request) {
        throw unavailable();
    }

    public void dismiss(UUID annotationId) {
        throw unavailable();
    }

    private ResponseStatusException unavailable() {
        return new ResponseStatusException(
                HttpStatus.NOT_IMPLEMENTED,
                "Persistent annotations are unavailable until database persistence is configured"
        );
    }
}
