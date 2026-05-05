package com.pearprogram.rooms;

import com.pearprogram.workspaces.Workspace;
import com.pearprogram.workspaces.WorkspaceRepository;
import jakarta.transaction.Transactional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.UUID;

@Service
public class RoomService {
    private static final Logger log = LoggerFactory.getLogger(RoomService.class);

    private final RoomRepository roomRepository;
    private final WorkspaceRepository workspaceRepository;
    private final RoomCodeGenerator roomCodeGenerator;
    private final EphemeralRoomStateService roomStateService;
    private final Duration roomTtl;

    public RoomService(
            RoomRepository roomRepository,
            WorkspaceRepository workspaceRepository,
            RoomCodeGenerator roomCodeGenerator,
            EphemeralRoomStateService roomStateService,
            @Value("${pearprogram.rooms.ttl-hours}") long ttlHours
    ) {
        this.roomRepository = roomRepository;
        this.workspaceRepository = workspaceRepository;
        this.roomCodeGenerator = roomCodeGenerator;
        this.roomStateService = roomStateService;
        this.roomTtl = Duration.ofHours(ttlHours);
    }

    @Transactional
    public RoomDto createRoom(UUID workspaceId) {
        Workspace workspace = workspaceRepository.findById(workspaceId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Workspace not found"));

        String code = allocateCode();
        Room room = new Room();
        room.setCode(code);
        room.setWorkspace(workspace);
        room.setActive(true);
        room.setExpiresAt(OffsetDateTime.now().plus(roomTtl));

        Room saved = roomRepository.save(room);
        roomStateService.saveRoomMapping(saved.getCode(), workspace.getId(), roomTtl);
        return RoomDto.from(saved);
    }

    public RoomDto getRoom(String code) {
        return roomRepository.findByCode(code)
                .map(RoomDto::from)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Room not found"));
    }

    public RoomAccessDto getRoomAccess(String code, String userId) {
        roomRepository.findByCode(code)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Room not found"));
        return roomStateService.roomAccess(code, userId);
    }

    private String allocateCode() {
        for (int attempt = 0; attempt < 5; attempt++) {
            String code = roomCodeGenerator.generateDefault();
            if (!roomStateService.codeExists(code) && !roomRepository.existsByCode(code)) {
                return code;
            }
        }

        log.warn("Room code collision retry budget exhausted; using expanded room code alphabet.");
        String expandedCode = roomCodeGenerator.generateExpanded();
        if (!roomStateService.codeExists(expandedCode) && !roomRepository.existsByCode(expandedCode)) {
            return expandedCode;
        }
        throw new ResponseStatusException(HttpStatus.CONFLICT, "Unable to allocate room code");
    }
}
