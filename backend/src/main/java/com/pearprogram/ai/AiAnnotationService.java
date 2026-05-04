package com.pearprogram.ai;

import com.pearprogram.files.WorkspaceFile;
import com.pearprogram.files.WorkspaceFileRepository;
import com.pearprogram.rooms.Room;
import com.pearprogram.rooms.RoomRepository;
import jakarta.transaction.Transactional;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

@Service
public class AiAnnotationService {
    private final AiAnnotationRepository annotationRepository;
    private final WorkspaceFileRepository fileRepository;
    private final RoomRepository roomRepository;

    public AiAnnotationService(
            AiAnnotationRepository annotationRepository,
            WorkspaceFileRepository fileRepository,
            RoomRepository roomRepository
    ) {
        this.annotationRepository = annotationRepository;
        this.fileRepository = fileRepository;
        this.roomRepository = roomRepository;
    }

    public List<AiAnnotationDto> listActive(String roomCode, UUID fileId) {
        return annotationRepository.findTop5ByFile_IdAndRoom_CodeAndDismissedAtIsNullOrderByCreatedAtDesc(fileId, roomCode)
                .stream()
                .map(AiAnnotationDto::from)
                .toList();
    }

    @Transactional
    public AiAnnotationDto create(String roomCode, CreateAnnotationRequest request) {
        Room room = roomRepository.findByCode(roomCode)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Room not found"));
        return createAnnotation(room, request.fileId(), request.line(), request.content());
    }

    @Transactional
    public AiAnnotationDto createPlaceholderAnnotation(Room room, UUID fileId, int line, String displayName) {
        String user = displayName == null || displayName.isBlank() ? "A teammate" : displayName;
        String content = user + " is working near line " + line
                + ". Placeholder AI would compare this edit against recent diffs before making a concrete suggestion.";
        return createAnnotation(room, fileId, line, content);
    }

    @Transactional
    public void dismiss(UUID annotationId) {
        AiAnnotation annotation = annotationRepository.findById(annotationId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Annotation not found"));
        annotation.setDismissedAt(OffsetDateTime.now());
    }

    private AiAnnotationDto createAnnotation(Room room, UUID fileId, int line, String content) {
        if (annotationRepository.existsByFile_IdAndLineAndCreatedAtAfterAndDismissedAtIsNull(
                fileId,
                line,
                OffsetDateTime.now().minusMinutes(10)
        )) {
            return null;
        }

        WorkspaceFile file = fileRepository.findById(fileId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "File not found"));
        AiAnnotation annotation = new AiAnnotation();
        annotation.setFile(file);
        annotation.setRoom(room);
        annotation.setLine(line);
        annotation.setContent(content);
        annotation.setCreatedAt(OffsetDateTime.now());
        return AiAnnotationDto.from(annotationRepository.save(annotation));
    }
}
