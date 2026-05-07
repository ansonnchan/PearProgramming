package com.pearprogram.rooms;

import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class RoomService {
    private static final Logger log = LoggerFactory.getLogger(RoomService.class);
    private final RoomCodeGenerator roomCodeGenerator;
    private final EphemeralRoomStateService roomStateService;
    private final RoomProjectStateService projectStateService;
    private final Duration cleanupGrace;
    private final Map<String, Instant> pendingCleanup = new ConcurrentHashMap<>();

    public RoomService(
            RoomCodeGenerator roomCodeGenerator,
            EphemeralRoomStateService roomStateService,
            RoomProjectStateService projectStateService,
            @Value("${pearprogram.rooms.cleanup-grace-seconds:120}") long cleanupGraceSeconds
    ) {
        this.roomCodeGenerator = roomCodeGenerator;
        this.roomStateService = roomStateService;
        this.projectStateService = projectStateService;
        this.cleanupGrace = Duration.ofSeconds(Math.max(30, cleanupGraceSeconds));
    }

    public RoomCreateResponse createRoom() {
        return createRoom(null, null);
    }

    public RoomCreateResponse createRoom(String sessionId, String displayName) {
        String code = allocateCode();
        var createdAt = java.time.OffsetDateTime.now();
        roomStateService.initializeRoom(code, createdAt);
        int memberCount = 0;
        String normalizedSessionId = sessionId == null ? "" : sessionId.trim();
        if (!normalizedSessionId.isBlank()) {
            RoomJoinResponse join = roomStateService.joinRoom(code, normalizedSessionId, normalizedSessionId, displayName, null);
            roomStateService.transferLead(code, normalizedSessionId);
            memberCount = join.memberCount();
        }
        log.info("Created room {}", code);
        return new RoomCreateResponse(code, buildJoinUrl(code), createdAt, memberCount);
    }

    public RoomCreateResponse createRoom(java.util.UUID ignoredWorkspaceId) {
        return createRoom();
    }

    public RoomDto getRoom(String code) {
        String normalized = normalizeRoomCode(code);
        ensureRoomExists(normalized);
        return roomStateService.getRoomSummary(normalized, buildJoinUrl(normalized));
    }

    public RoomAccessDto getRoomAccess(String code, String sessionId, String displayName) {
        String normalized = normalizeRoomCode(code);
        ensureRoomExists(normalized);
        return roomStateService.roomAccess(normalized, sessionId, displayName);
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

    public RoomJoinResponse joinRoom(String code) {
        String normalized = normalizeRoomCode(code);
        ensureRoomExists(normalized);
        return roomStateService.joinRoom(normalized);
    }

    public RoomJoinResponse joinRoom(String code, String sessionId) {
        String normalized = normalizeRoomCode(code);
        ensureRoomExists(normalized);
        return roomStateService.joinRoom(normalized, sessionId, null, null);
    }

    public RoomJoinResponse joinRoom(String code, String sessionId, String displayName) {
        String normalized = normalizeRoomCode(code);
        ensureRoomExists(normalized);
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
        projectStateService.deleteFiles(normalized);
        pendingCleanup.remove(normalized);
        log.info("Deleted room {} after last user left", normalized);
        return new RoomCleanupDto(normalized, true, "inactive");
    }

    public RoomCleanupDto closeRoom(String code) {
        String normalized = normalizeRoomCode(code);
        if (!roomStateService.roomExists(normalized)) {
            pendingCleanup.remove(normalized);
            return new RoomCleanupDto(normalized, false, "not_found_or_inactive");
        }

        roomStateService.deleteRoom(normalized);
        projectStateService.deleteFiles(normalized);
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
            if (roomStateService.reserveRoomCode(code)) {
                return code;
            }
        }

        log.warn("Room code collision retry budget exhausted; using expanded room code alphabet.");
        String expandedCode = roomCodeGenerator.generateExpanded();
        if (roomStateService.reserveRoomCode(expandedCode)) {
            return expandedCode;
        }
        throw new ResponseStatusException(HttpStatus.CONFLICT, "Unable to allocate room code");
    }

    private void ensureRoomExists(String code) {
        if (!roomStateService.roomExists(code)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Room not found");
        }
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
