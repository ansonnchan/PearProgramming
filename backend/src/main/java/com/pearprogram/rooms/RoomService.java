package com.pearprogram.rooms;

import com.pearprogram.workspaces.WorkspaceDto;
import com.pearprogram.workspaces.WorkspaceService;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class RoomService {
    private static final Logger log = LoggerFactory.getLogger(RoomService.class);
    private final RoomCodeGenerator roomCodeGenerator;
    private final EphemeralRoomStateService roomStateService;
    private final RoomProjectStateService projectStateService;
    private final RoomRepository rooms;
    private final RoomMemberRepository roomMembers;
    private final WorkspaceService workspaces;
    private final Duration cleanupGrace;
    private final Map<String, Instant> pendingCleanup = new ConcurrentHashMap<>();

    public RoomService(
            RoomCodeGenerator roomCodeGenerator,
            EphemeralRoomStateService roomStateService,
            RoomProjectStateService projectStateService,
            RoomRepository rooms,
            RoomMemberRepository roomMembers,
            WorkspaceService workspaces,
            @Value("${pearprogram.rooms.cleanup-grace-seconds:120}") long cleanupGraceSeconds
    ) {
        this.roomCodeGenerator = roomCodeGenerator;
        this.roomStateService = roomStateService;
        this.projectStateService = projectStateService;
        this.rooms = rooms;
        this.roomMembers = roomMembers;
        this.workspaces = workspaces;
        this.cleanupGrace = Duration.ofSeconds(Math.max(30, cleanupGraceSeconds));
    }

    @Transactional
    public RoomCreateResponse createRoom(String sessionId, String displayName) {
        UUID ownerId = UUID.fromString(sessionId);
        String code = allocateCode();
        WorkspaceDto workspace = workspaces.createWorkspace("room-" + code.toLowerCase(Locale.ROOT), sessionId);
        RoomEntity room = rooms.save(new RoomEntity(code, workspace.id(), ownerId));
        roomMembers.save(new RoomMemberEntity(room.getId(), ownerId));
        roomStateService.initializeRoom(code, room.getCreatedAt());
        RoomJoinResponse join = roomStateService.joinRoom(code, sessionId, sessionId, displayName, null);
        roomStateService.transferLead(code, sessionId);
        log.info("Created room {}", code);
        return new RoomCreateResponse(code, workspace.id(), buildJoinUrl(code), room.getCreatedAt(), join.memberCount());
    }

    @Transactional(readOnly = true)
    public RoomDto getRoom(String code) {
        String normalized = normalizeRoomCode(code);
        RoomEntity room = ensureRoomExists(normalized);
        RoomDto ephemeral = roomStateService.getRoomSummary(normalized, buildJoinUrl(normalized));
        return new RoomDto(
                room.getId().toString(),
                room.getCode(),
                room.getWorkspaceId(),
                ephemeral.joinUrl(),
                room.isActive(),
                room.getCreatedAt(),
                ephemeral.memberCount(),
                ephemeral.maxUsers(),
                ephemeral.locked(),
                ephemeral.leadUserId()
        );
    }

    @Transactional(readOnly = true)
    public RoomAccessDto getRoomAccess(String code, String sessionId, String displayName) {
        String normalized = normalizeRoomCode(code);
        ensureRoomExists(normalized);
        return roomStateService.roomAccess(normalized, sessionId, displayName);
    }

    @Transactional(readOnly = true)
    public void requireActiveMember(String code, String userId) {
        String normalized = normalizeRoomCode(code);
        ensureRoomExists(normalized);
        if (!roomStateService.isActiveMember(normalized, userId)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Room membership required");
        }
    }

    @Transactional(readOnly = true)
    public void requireDurableMember(String code, String userId) {
        RoomEntity room = ensureRoomExists(normalizeRoomCode(code));
        if (!roomMembers.existsByRoomIdAndUserId(room.getId(), UUID.fromString(userId))) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Room membership required");
        }
    }

    @Transactional(readOnly = true)
    public UUID workspaceIdForCode(String code) {
        return ensureRoomExists(normalizeRoomCode(code)).getWorkspaceId();
    }

    public List<Map<String, Object>> getRoomFiles(String code) {
        String normalized = normalizeRoomCode(code);
        ensureRoomExists(normalized);
        return projectStateService.getFiles(normalized);
    }

    public List<Map<String, Object>> saveRoomFiles(String code, List<Map<String, Object>> files) {
        String normalized = normalizeRoomCode(code);
        ensureRoomExists(normalized);
        return projectStateService.saveFiles(normalized, files);
    }

    public List<Map<String, Object>> upsertRoomFiles(String code, List<Map<String, Object>> files) {
        String normalized = normalizeRoomCode(code);
        ensureRoomExists(normalized);
        return projectStateService.upsertFiles(normalized, files);
    }

    @Transactional
    public RoomJoinResponse joinRoom(String code, String sessionId, String displayName) {
        String normalized = normalizeRoomCode(code);
        RoomEntity room = ensureRoomExists(normalized);
        UUID userId = UUID.fromString(sessionId);
        RoomMemberEntity membership = roomMembers.findByRoomIdAndUserId(room.getId(), userId)
                .orElseGet(() -> roomMembers.save(new RoomMemberEntity(room.getId(), userId)));
        membership.touch();
        workspaces.addMember(room.getWorkspaceId(), userId);
        return roomStateService.joinRoom(normalized, sessionId, displayName, null);
    }

    public void cancelCleanup(String code) {
        String normalized = normalizeRoomCode(code);
        if (pendingCleanup.remove(normalized) != null) {
            roomStateService.markRoomActive(normalized);
            log.info("Cancelled pending room cleanup for {}", normalized);
        }
    }

    public void scheduleCleanupIfEmpty(String code) {
        String normalized = normalizeRoomCode(code);
        if (normalized.isBlank() || roomStateService.activeMemberCount(normalized) > 0) {
            return;
        }

        roomStateService.markRoomInactive(normalized);
        pendingCleanup.computeIfAbsent(normalized, ignored -> {
            Instant cleanupAt = Instant.now().plus(cleanupGrace);
            log.info("Scheduled room cleanup for {} at {}", normalized, cleanupAt);
            return cleanupAt;
        });
    }

    public RoomCleanupDto cleanupIfEmpty(String code) {
        String normalized = normalizeRoomCode(code);
        if (!roomStateService.roomExists(normalized)) {
            pendingCleanup.remove(normalized);
            return new RoomCleanupDto(normalized, false, "not_found_or_inactive");
        }

        if (roomStateService.activeMemberCount(normalized) > 0) {
            pendingCleanup.remove(normalized);
            roomStateService.markRoomActive(normalized);
            return new RoomCleanupDto(normalized, false, "active_members");
        }

        Instant cleanupAt = pendingCleanup.computeIfAbsent(normalized, ignored -> Instant.now().plus(cleanupGrace));
        roomStateService.markRoomInactive(normalized);
        if (Instant.now().isBefore(cleanupAt)) {
            return new RoomCleanupDto(normalized, false, "pending");
        }

        roomStateService.deleteRoom(normalized);
        pendingCleanup.remove(normalized);
        log.info("Cleaned ephemeral state for inactive room {}; durable room remains available", normalized);
        return new RoomCleanupDto(normalized, true, "inactive");
    }

    @Transactional
    public RoomCleanupDto closeRoom(String code) {
        String normalized = normalizeRoomCode(code);
        RoomEntity room = rooms.findByCodeAndActiveTrue(normalized).orElse(null);
        if (room == null) {
            pendingCleanup.remove(normalized);
            return new RoomCleanupDto(normalized, false, "not_found_or_inactive");
        }

        room.close();
        roomStateService.deleteRoom(normalized);
        workspaces.deleteWorkspace(room.getWorkspaceId());
        pendingCleanup.remove(normalized);
        log.info("Deleted room {} via close-room event", normalized);
        return new RoomCleanupDto(normalized, true, "closed");
    }

    @Scheduled(fixedDelayString = "${pearprogram.rooms.cleanup-scan-ms:5000}")
    void runPendingCleanup() {
        Instant now = Instant.now();
        for (Map.Entry<String, Instant> entry : Map.copyOf(pendingCleanup).entrySet()) {
            if (now.isBefore(entry.getValue())) {
                continue;
            }
            cleanupIfEmpty(entry.getKey());
        }
    }

    @PreDestroy
    void clearPendingCleanup() {
        pendingCleanup.clear();
    }

    private String allocateCode() {
        for (int attempt = 0; attempt < 20; attempt++) {
            String code = roomCodeGenerator.generateDefault();
            if (!rooms.existsByCode(code)) {
                return code;
            }
        }

        log.warn("Room code collision retry budget exhausted; using expanded room code alphabet.");
        String expandedCode = roomCodeGenerator.generateExpanded();
        if (!rooms.existsByCode(expandedCode)) {
            return expandedCode;
        }
        throw new ResponseStatusException(HttpStatus.CONFLICT, "Unable to allocate room code");
    }

    private RoomEntity ensureRoomExists(String code) {
        RoomEntity room = rooms.findByCodeAndActiveTrue(code)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Room not found"));
        if (!roomStateService.roomExists(code)) {
            roomStateService.initializeRoom(code, room.getCreatedAt());
        }
        return room;
    }

    private String normalizeRoomCode(String rawCode) {
        if (rawCode == null) {
            return "";
        }
        return rawCode.trim()
                .replaceAll("[\\s-]+", "")
                .toUpperCase(Locale.ROOT);
    }

    private String buildJoinUrl(String code) {
        return "/join/" + formatRoomCode(code);
    }

    private String formatRoomCode(String normalizedCode) {
        if (normalizedCode.length() != 6) {
            return normalizedCode;
        }
        return normalizedCode.substring(0, 3) + "-" + normalizedCode.substring(3);
    }
}
