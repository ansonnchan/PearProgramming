package com.pearprogram.ai;

import com.pearprogram.files.WorkspaceFileRepository;
import com.pearprogram.rooms.RoomMemberRepository;
import com.pearprogram.rooms.RoomRepository;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.UUID;

@Service
public class AiAnnotationService {
    private final AiAnnotationRepository annotations;
    private final RoomRepository rooms;
    private final RoomMemberRepository roomMembers;
    private final WorkspaceFileRepository files;

    public AiAnnotationService(AiAnnotationRepository annotations, RoomRepository rooms,
                               RoomMemberRepository roomMembers, WorkspaceFileRepository files) {
        this.annotations = annotations;
        this.rooms = rooms;
        this.roomMembers = roomMembers;
        this.files = files;
    }

    @Transactional(readOnly = true)
    public List<AiAnnotationDto> listActive(String roomCode, UUID fileId) {
        var room = rooms.findByCodeAndActiveTrue(roomCode)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Room not found"));
        return annotations.findAllByRoomIdAndFileIdAndDismissedFalseOrderByCreatedAtAsc(room.getId(), fileId)
                .stream().map(entity -> toDto(entity, roomCode)).toList();
    }

    @Transactional
    public AiAnnotationDto create(String roomCode, CreateAnnotationRequest request, UUID userId) {
        var room = rooms.findByCodeAndActiveTrue(roomCode)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Room not found"));
        var file = files.findById(request.fileId())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "File not found"));
        if (!file.getWorkspaceId().equals(room.getWorkspaceId())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "File does not belong to this room");
        }
        AiAnnotationEntity entity = annotations.save(new AiAnnotationEntity(
                room.getId(), request.fileId(), userId, request.line(), request.content().trim()));
        return toDto(entity, roomCode);
    }

    @Transactional
    public void dismiss(UUID annotationId, UUID userId) {
        AiAnnotationEntity annotation = annotations.findById(annotationId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Annotation not found"));
        if (!roomMembers.existsByRoomIdAndUserId(annotation.getRoomId(), userId)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Room membership required");
        }
        annotation.dismiss();
    }

    private AiAnnotationDto toDto(AiAnnotationEntity entity, String roomCode) {
        return new AiAnnotationDto(
                entity.getId(),
                entity.getFileId(),
                roomCode,
                entity.getTriggeredByUserId() == null ? null : entity.getTriggeredByUserId().toString(),
                entity.getLineNumber(),
                entity.getContent(),
                entity.getCreatedAt()
        );
    }
}
