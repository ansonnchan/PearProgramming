package com.pearprogram.ai;

import jakarta.validation.Valid;
import com.pearprogram.realtime.RealtimeBroadcastService;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

@RestController
public class AiAnnotationController {
    private final AiAnnotationService annotationService;
    private final RealtimeBroadcastService broadcastService;

    public AiAnnotationController(AiAnnotationService annotationService, RealtimeBroadcastService broadcastService) {
        this.annotationService = annotationService;
        this.broadcastService = broadcastService;
    }

    @GetMapping("/api/rooms/{code}/files/{fileId}/annotations")
    public List<AiAnnotationDto> list(@PathVariable String code, @PathVariable UUID fileId) {
        return annotationService.listActive(code, fileId);
    }

    @PostMapping("/api/rooms/{code}/annotations")
    public AiAnnotationDto create(@PathVariable String code, @Valid @RequestBody CreateAnnotationRequest request) {
        AiAnnotationDto annotation = annotationService.create(code, request);
        if (annotation != null) {
            broadcastService.broadcast("/topic/room/" + code + "/annotations", annotation);
        }
        return annotation;
    }

    @DeleteMapping("/api/annotations/{annotationId}")
    public void dismiss(@PathVariable UUID annotationId) {
        annotationService.dismiss(annotationId);
    }
}
