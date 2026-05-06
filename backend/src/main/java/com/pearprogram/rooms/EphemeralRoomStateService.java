package com.pearprogram.rooms;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.List;

@Service
public class EphemeralRoomStateService {
    private static final Logger log = LoggerFactory.getLogger(EphemeralRoomStateService.class);
    private static final int MAX_ROOM_USERS = 5;
    private static final List<String> COLORS = List.of(
            "#378ADD",
            "#1D9E75",
            "#F59E0B",
            "#D946EF",
            "#EF4444",
            "#0EA5E9"
    );

    private final StringRedisTemplate redisTemplate;
    private final Duration roomStateTtl;

    public EphemeralRoomStateService(StringRedisTemplate redisTemplate) {
        this.redisTemplate = redisTemplate;
        this.roomStateTtl = Duration.ofHours(24);
    }

    public boolean reserveRoomCode(String code) {
        return Boolean.TRUE.equals(redisTemplate.opsForValue().setIfAbsent(roomCountKey(code), "0"));
    }

    public void initializeRoom(String code, OffsetDateTime createdAt) {
        redisTemplate.opsForHash().put(roomMetaKey(code), "createdAt", createdAt.toString());
        redisTemplate.opsForHash().put(roomMetaKey(code), "active", "true");
        redisTemplate.delete(roomMembersKey(code));
        redisTemplate.delete(roomAnnotationsKey(code));
        redisTemplate.opsForValue().setIfAbsent(roomCountKey(code), "0");
        redisTemplate.opsForValue().setIfAbsent(roomColorCursorKey(code), "0");
    }

    public boolean roomExists(String code) {
        return Boolean.TRUE.equals(redisTemplate.hasKey(roomCountKey(code)))
                || Boolean.TRUE.equals(redisTemplate.hasKey(roomMetaKey(code)));
    }

    public int activeMemberCount(String code) {
        String raw = redisTemplate.opsForValue().get(roomCountKey(code));
        if (raw == null || raw.isBlank()) {
            return 0;
        }
        try {
            return Integer.parseInt(raw);
        } catch (NumberFormatException ex) {
            return 0;
        }
    }

    public RoomDto getRoomSummary(String code, String joinUrl) {
        return new RoomDto(
                code,
                code,
                joinUrl,
                roomExists(code),
                roomCreatedAt(code),
                activeMemberCount(code),
                MAX_ROOM_USERS,
                isLocked(code),
                getLeadDisplayName(code)
        );
    }

    public RoomAccessDto roomAccess(String code, String ignoredUserId) {
        boolean locked = isLocked(code);
        int memberCount = activeMemberCount(code);
        boolean canJoin = roomExists(code) && !locked && memberCount < MAX_ROOM_USERS;
        return new RoomAccessDto(canJoin, canJoin ? null : locked ? "locked" : "full", locked, memberCount, MAX_ROOM_USERS, getLeadDisplayName(code));
    }

    public RoomJoinResponse joinRoom(String code) {
        if (!roomExists(code)) {
            throw new IllegalArgumentException("Room not found");
        }

        RoomAccessDto access = roomAccess(code, null);
        if (!access.canJoin()) {
            throw new IllegalStateException(access.reason() == null ? "Room unavailable" : access.reason());
        }

        String displayName = allocateDisplayName(code);
        String cursorColor = nextCursorColor(code);
        redisTemplate.opsForHash().put(roomMembersKey(code), displayName, cursorColor);
        redisTemplate.opsForValue().increment(roomCountKey(code));
        redisTemplate.expire(roomCountKey(code), roomStateTtl);
        redisTemplate.expire(roomMembersKey(code), roomStateTtl);
        redisTemplate.expire(roomAnnotationsKey(code), roomStateTtl);
        log.info("Joined room {} as {} ({})", code, displayName, cursorColor);
        return new RoomJoinResponse(code, displayName, cursorColor, activeMemberCount(code), MAX_ROOM_USERS);
    }

    public RoomJoinResponse joinRoom(String code, String displayName, String cursorColor) {
        String normalized = normalizeIdentity(displayName, code);
        String color = cursorColor == null || cursorColor.isBlank() ? nextCursorColor(code) : cursorColor;
        if (!roomExists(code)) {
            throw new IllegalArgumentException("Room not found");
        }

        Object existing = redisTemplate.opsForHash().get(roomMembersKey(code), normalized);
        if (existing == null) {
            redisTemplate.opsForHash().put(roomMembersKey(code), normalized, color);
            redisTemplate.opsForValue().increment(roomCountKey(code));
        }
        redisTemplate.expire(roomCountKey(code), roomStateTtl);
        redisTemplate.expire(roomMembersKey(code), roomStateTtl);
        redisTemplate.expire(roomAnnotationsKey(code), roomStateTtl);
        return new RoomJoinResponse(code, normalized, color, activeMemberCount(code), MAX_ROOM_USERS);
    }

    public RoomAccessDto leaveRoom(String code, String displayName) {
        if (!roomExists(code)) {
            return new RoomAccessDto(false, "not_found", false, 0, MAX_ROOM_USERS, null);
        }

        if (displayName != null && !displayName.isBlank()) {
            redisTemplate.opsForHash().delete(roomMembersKey(code), displayName);
            redisTemplate.opsForValue().decrement(roomCountKey(code));
        }

        int memberCount = Math.max(activeMemberCount(code), 0);
        if (memberCount <= 0) {
            deleteRoom(code);
            return new RoomAccessDto(false, "closed", false, 0, MAX_ROOM_USERS, null);
        }

        return new RoomAccessDto(true, null, isLocked(code), memberCount, MAX_ROOM_USERS, getLeadDisplayName(code));
    }

    public RoomAccessDto transferLead(String code, String leadDisplayName) {
        if (!roomExists(code)) {
            return new RoomAccessDto(false, "not_found", false, 0, MAX_ROOM_USERS, null);
        }

        if (leadDisplayName == null || leadDisplayName.isBlank()) {
            redisTemplate.opsForHash().delete(roomMetaKey(code), "leadDisplayName");
        } else {
            redisTemplate.opsForHash().put(roomMetaKey(code), "leadDisplayName", leadDisplayName);
        }
        return new RoomAccessDto(true, null, isLocked(code), activeMemberCount(code), MAX_ROOM_USERS, getLeadDisplayName(code));
    }

    public RoomAccessDto setLocked(String code, String ignoredUserId, boolean locked) {
        if (!roomExists(code)) {
            return new RoomAccessDto(false, "not_found", false, 0, MAX_ROOM_USERS, null);
        }

        redisTemplate.opsForHash().put(roomMetaKey(code), "locked", Boolean.toString(locked));
        return new RoomAccessDto(true, null, locked, activeMemberCount(code), MAX_ROOM_USERS, getLeadDisplayName(code));
    }

    public void clearRuntimeState(String code) {
        redisTemplate.delete(roomMembersKey(code));
        redisTemplate.delete(roomCountKey(code));
        redisTemplate.delete(roomMetaKey(code));
        redisTemplate.delete(roomAnnotationsKey(code));
        redisTemplate.delete(roomColorCursorKey(code));
    }

    public void deleteRoom(String code) {
        clearRuntimeState(code);
    }

    public boolean isLocked(String code) {
        Object locked = redisTemplate.opsForHash().get(roomMetaKey(code), "locked");
        return locked != null && Boolean.parseBoolean(locked.toString());
    }

    public String getLeadDisplayName(String code) {
        Object lead = redisTemplate.opsForHash().get(roomMetaKey(code), "leadDisplayName");
        return lead == null ? null : lead.toString();
    }

    @Scheduled(fixedDelay = 60_000)
    void expireFallbackRooms() {
        // No-op by design: room state is Redis-only and rooms live until explicitly emptied.
    }

    private String allocateDisplayName(String code) {
        for (int attempt = 0; attempt < 20; attempt++) {
            int number = 10 + randomIndex(90);
            String displayName = "Pear #" + String.format("%02d", number);
            if (!redisTemplate.opsForHash().hasKey(roomMembersKey(code), displayName)) {
                return displayName;
            }
        }

        return "Pear #" + String.format("%02d", 10 + randomIndex(90));
    }

    private String nextCursorColor(String code) {
        long raw = redisTemplate.opsForValue().increment(roomColorCursorKey(code));
        int index = (int) ((raw - 1) % COLORS.size());
        return COLORS.get(index);
    }

    private String normalizeIdentity(String displayName, String code) {
        if (displayName == null || displayName.isBlank()) {
            return allocateDisplayName(code);
        }
        return displayName.trim();
    }

    private OffsetDateTime roomCreatedAt(String code) {
        Object createdAt = redisTemplate.opsForHash().get(roomMetaKey(code), "createdAt");
        if (createdAt == null) {
            return OffsetDateTime.now();
        }
        try {
            return OffsetDateTime.parse(createdAt.toString());
        } catch (RuntimeException ex) {
            return OffsetDateTime.now();
        }
    }

    private int randomIndex(int upperBound) {
        return new java.security.SecureRandom().nextInt(upperBound);
    }

    private String roomMetaKey(String code) {
        return "room:" + code;
    }

    private String roomCountKey(String code) {
        return "room:" + code + ":count";
    }

    private String roomMembersKey(String code) {
        return "room:" + code + ":members";
    }

    private String roomAnnotationsKey(String code) {
        return "room:" + code + ":annotations";
    }

    private String roomColorCursorKey(String code) {
        return "room:" + code + ":color-cursor";
    }
}
