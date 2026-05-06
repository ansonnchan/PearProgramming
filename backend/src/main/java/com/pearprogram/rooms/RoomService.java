package com.pearprogram.rooms;

import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.security.SecureRandom;
import java.time.Duration;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class RoomService {
    private static final Logger log = LoggerFactory.getLogger(RoomService.class);
    private final RoomCodeGenerator roomCodeGenerator;
    private final EphemeralRoomStateService roomStateService;
    private final Duration roomTtl;
    private final Set<String> pendingCleanup = ConcurrentHashMap.newKeySet();

    public RoomService(
            RoomCodeGenerator roomCodeGenerator,
            EphemeralRoomStateService roomStateService,
            @Value("${pearprogram.rooms.ttl-hours:24}") long ttlHours
    ) {
        this.roomCodeGenerator = roomCodeGenerator;
        this.roomStateService = roomStateService;
        this.roomTtl = Duration.ofHours(ttlHours);
    }

    public RoomCreateResponse createRoom() {
        String code = allocateCode();
        var createdAt = java.time.OffsetDateTime.now();
        roomStateService.initializeRoom(code, createdAt);
        log.info("Created Redis room {}", code);
        return new RoomCreateResponse(code, buildJoinUrl(code), createdAt, 0);
    }

    public RoomCreateResponse createRoom(java.util.UUID ignoredWorkspaceId) {
        return createRoom();
    }

    public RoomDto getRoom(String code) {
        String normalized = normalizeRoomCode(code);
        ensureRoomExists(normalized);
        return roomStateService.getRoomSummary(normalized, buildJoinUrl(normalized));
    }

    public RoomAccessDto getRoomAccess(String code, String userId) {
        String normalized = normalizeRoomCode(code);
        ensureRoomExists(normalized);
        return roomStateService.roomAccess(normalized, userId);
    }

    public RoomJoinResponse joinRoom(String code) {
        String normalized = normalizeRoomCode(code);
        ensureRoomExists(normalized);
        return roomStateService.joinRoom(normalized);
    }

    public RoomJoinResponse joinRoom(String code, String displayName) {
        String normalized = normalizeRoomCode(code);
        ensureRoomExists(normalized);
        return roomStateService.joinRoom(normalized, displayName, null);
    }

    public void cancelCleanup(String code) {
        String normalized = normalizeRoomCode(code);
        if (pendingCleanup.remove(normalized)) {
            log.info("Cancelled pending room cleanup for {}", normalized);
        }
    }

    public void scheduleCleanupIfEmpty(String code) {
        String normalized = normalizeRoomCode(code);
        if (normalized.isBlank() || roomStateService.activeMemberCount(normalized) > 0) {
            return;
        }

        pendingCleanup.add(normalized);
        log.info("Scheduled room cleanup for {}", normalized);
    }

    public RoomCleanupDto cleanupIfEmpty(String code) {
        String normalized = normalizeRoomCode(code);
        if (!roomStateService.roomExists(normalized)) {
            pendingCleanup.remove(normalized);
            return new RoomCleanupDto(normalized, false, "not_found_or_inactive");
        }

        if (roomStateService.activeMemberCount(normalized) > 0) {
            pendingCleanup.remove(normalized);
            return new RoomCleanupDto(normalized, false, "active_members");
        }

        roomStateService.deleteRoom(normalized);
        pendingCleanup.remove(normalized);
        log.info("Deleted Redis room {} after last user left", normalized);
        return new RoomCleanupDto(normalized, true, "inactive");
    }

    public RoomCleanupDto closeRoom(String code) {
        String normalized = normalizeRoomCode(code);
        if (!roomStateService.roomExists(normalized)) {
            pendingCleanup.remove(normalized);
            return new RoomCleanupDto(normalized, false, "not_found_or_inactive");
        }

        roomStateService.deleteRoom(normalized);
        pendingCleanup.remove(normalized);
        log.info("Deleted Redis room {} via close-room event", normalized);
        return new RoomCleanupDto(normalized, true, "closed");
    }

    @Scheduled(fixedDelayString = "${pearprogram.rooms.cleanup-scan-ms:5000}")
    void runPendingCleanup() {
        for (String code : Set.copyOf(pendingCleanup)) {
            cleanupIfEmpty(code);
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
