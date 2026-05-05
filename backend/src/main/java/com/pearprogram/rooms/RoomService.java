package com.pearprogram.rooms;

import com.pearprogram.workspaces.Workspace;
import com.pearprogram.workspaces.WorkspaceRepository;
import jakarta.annotation.PreDestroy;
import jakarta.transaction.Transactional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;

import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class RoomService {
    private static final Logger log = LoggerFactory.getLogger(RoomService.class);

    private final RoomRepository roomRepository;
    private final WorkspaceRepository workspaceRepository;
    private final RoomCodeGenerator roomCodeGenerator;
    private final EphemeralRoomStateService roomStateService;
    private final TransactionTemplate transactionTemplate;
    private final Duration roomTtl;
    private final Duration cleanupGrace;
    private final Map<String, Instant> pendingCleanup = new ConcurrentHashMap<>();

    public RoomService(
            RoomRepository roomRepository,
            WorkspaceRepository workspaceRepository,
            RoomCodeGenerator roomCodeGenerator,
            EphemeralRoomStateService roomStateService,
            TransactionTemplate transactionTemplate,
            @Value("${pearprogram.rooms.ttl-hours}") long ttlHours,
            @Value("${pearprogram.rooms.cleanup-grace-seconds:20}") long cleanupGraceSeconds
    ) {
        this.roomRepository = roomRepository;
        this.workspaceRepository = workspaceRepository;
        this.roomCodeGenerator = roomCodeGenerator;
        this.roomStateService = roomStateService;
        this.transactionTemplate = transactionTemplate;
        this.roomTtl = Duration.ofHours(ttlHours);
        this.cleanupGrace = Duration.ofSeconds(cleanupGraceSeconds);
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

        try {
            Room saved = roomRepository.save(room);
            roomStateService.saveRoomMapping(saved.getCode(), workspace.getId(), roomTtl);
            return RoomDto.from(saved);
        } catch (Exception ex) {
            log.error("Failed to save room for workspace {}: {}", workspaceId, ex.getMessage(), ex);
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "Failed to create room", ex);
        }
    }

    public RoomDto getRoom(String code) {
        return findRoomByCode(code)
                .map(RoomDto::from)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Room not found"));
    }

    public RoomAccessDto getRoomAccess(String code, String userId) {
        Room room = findRoomByCode(code)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Room not found"));
        return roomStateService.roomAccess(room.getCode(), userId);
    }

    public void cancelCleanup(String code) {
        String normalized = normalizeRoomCode(code);
        if (pendingCleanup.remove(normalized) != null) {
            log.info("Cancelled pending room cleanup for {}", normalized);
        }
    }

    public void scheduleCleanupIfEmpty(String code) {
        String normalized = normalizeRoomCode(code);
        if (normalized.isBlank() || roomStateService.activeMemberCount(normalized) > 0) {
            return;
        }

        Instant cleanupAt = Instant.now().plus(cleanupGrace);
        pendingCleanup.put(normalized, cleanupAt);
        log.info("Scheduled room cleanup for {} in {} seconds", normalized, cleanupGrace.toSeconds());
    }

    public RoomCleanupDto cleanupIfEmpty(String code) {
        String normalized = normalizeRoomCode(code);
        return transactionTemplate.execute(status -> {
            Optional<Room> maybeRoom = findRoomByCode(normalized);
            if (maybeRoom.isEmpty()) {
                pendingCleanup.remove(normalized);
                return new RoomCleanupDto(normalized, false, "not_found_or_inactive");
            }

            Room room = maybeRoom.get();
            int memberCount = roomStateService.activeMemberCount(room.getCode());
            if (memberCount > 0) {
                pendingCleanup.remove(room.getCode());
                return new RoomCleanupDto(room.getCode(), false, "active_members");
            }

            room.setActive(false);
            roomRepository.save(room);
            roomStateService.clearRuntimeState(room.getCode());
            pendingCleanup.remove(room.getCode());
            log.info("Marked room {} inactive after last user left", room.getCode());
            return new RoomCleanupDto(room.getCode(), true, "inactive");
        });
    }

    public RoomCleanupDto closeRoom(String code) {
        String normalized = normalizeRoomCode(code);
        return transactionTemplate.execute(status -> {
            Optional<Room> maybeRoom = findRoomByCode(normalized);
            if (maybeRoom.isEmpty()) {
                pendingCleanup.remove(normalized);
                return new RoomCleanupDto(normalized, false, "not_found_or_inactive");
            }

            Room room = maybeRoom.get();
            room.setActive(false);
            roomRepository.save(room);
            roomStateService.clearRuntimeState(room.getCode());
            pendingCleanup.remove(room.getCode());
            log.info("Marked room {} inactive by close-room event", room.getCode());
            return new RoomCleanupDto(room.getCode(), true, "closed");
        });
    }

    @Scheduled(fixedDelayString = "${pearprogram.rooms.cleanup-scan-ms:5000}")
    void runPendingCleanup() {
        Instant now = Instant.now();
        pendingCleanup.forEach((code, cleanupAt) -> {
            if (!cleanupAt.isAfter(now)) {
                cleanupIfEmpty(code);
            }
        });
    }

    @PreDestroy
    void clearPendingCleanup() {
        pendingCleanup.clear();
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

    private Optional<Room> findRoomByCode(String rawCode) {
        String normalized = normalizeRoomCode(rawCode);
        Optional<Room> room = roomRepository.findActiveByCode(normalized);
        if (room.isPresent() || normalized.length() != 6) {
            return room;
        }

        return roomRepository.findActiveByCode(toLegacyDashedCode(normalized));
    }

    private String normalizeRoomCode(String rawCode) {
        if (rawCode == null) {
            return "";
        }
        return rawCode.trim()
                .replaceAll("[\\s-]+", "")
                .toUpperCase(Locale.ROOT);
    }

    private String toLegacyDashedCode(String normalizedCode) {
        return normalizedCode.substring(0, 3) + "-" + normalizedCode.substring(3);
    }
}
