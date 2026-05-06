package com.pearprogram.rooms;

import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Supplier;

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
    private final Map<String, LocalRoomState> localRooms = new ConcurrentHashMap<>();
    private volatile boolean redisAvailable = true;

    public EphemeralRoomStateService(StringRedisTemplate redisTemplate) {
        this.redisTemplate = redisTemplate;
        this.roomStateTtl = Duration.ofHours(24);
    }

    public boolean reserveRoomCode(String code) {
        return executeWithFallback(
                () -> Boolean.TRUE.equals(redisTemplate.opsForValue().setIfAbsent(roomCountKey(code), "0")),
                () -> localRooms.putIfAbsent(code, new LocalRoomState()) == null
        );
    }

    public void initializeRoom(String code, OffsetDateTime createdAt) {
        executeWithFallback(
                () -> {
                    redisTemplate.opsForHash().put(roomMetaKey(code), "createdAt", createdAt.toString());
                    redisTemplate.opsForHash().put(roomMetaKey(code), "active", "true");
                    redisTemplate.delete(roomMembersKey(code));
                    redisTemplate.delete(roomAnnotationsKey(code));
                    redisTemplate.opsForValue().setIfAbsent(roomCountKey(code), "0");
                    redisTemplate.opsForValue().setIfAbsent(roomColorCursorKey(code), "0");
                    return null;
                },
                () -> {
                    LocalRoomState state = localState(code);
                    state.createdAt = createdAt;
                    state.active = true;
                    state.locked = false;
                    state.leadDisplayName = null;
                    state.members.clear();
                    state.annotations.clear();
                    state.memberCount.set(0);
                    state.colorCursor.set(0);
                    return null;
                }
        );
    }

    public boolean roomExists(String code) {
        return executeWithFallback(
                () -> Boolean.TRUE.equals(redisTemplate.hasKey(roomCountKey(code)))
                        || Boolean.TRUE.equals(redisTemplate.hasKey(roomMetaKey(code))),
                () -> localRooms.containsKey(code)
        );
    }

    public int activeMemberCount(String code) {
        return executeWithFallback(
                () -> {
                    String raw = redisTemplate.opsForValue().get(roomCountKey(code));
                    if (raw == null || raw.isBlank()) {
                        return 0;
                    }
                    try {
                        return Integer.parseInt(raw);
                    } catch (NumberFormatException ex) {
                        return 0;
                    }
                },
                () -> {
                    LocalRoomState state = localRooms.get(code);
                    return state == null ? 0 : state.memberCount.get();
                }
        );
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

    public RoomAccessDto roomAccess(String code, String displayName) {
        boolean locked = isLocked(code);
        int memberCount = activeMemberCount(code);
        boolean isMember = displayName != null && !displayName.isBlank() && memberExists(code, normalizeIdentity(displayName, code));
        boolean canJoin = roomExists(code) && !locked && (isMember || memberCount < MAX_ROOM_USERS);
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
        executeWithFallback(
                () -> {
                    redisTemplate.opsForHash().put(roomMembersKey(code), displayName, cursorColor);
                    redisTemplate.opsForValue().increment(roomCountKey(code));
                    redisTemplate.expire(roomCountKey(code), roomStateTtl);
                    redisTemplate.expire(roomMembersKey(code), roomStateTtl);
                    redisTemplate.expire(roomAnnotationsKey(code), roomStateTtl);
                    return null;
                },
                () -> {
                    LocalRoomState state = localState(code);
                    state.members.put(displayName, cursorColor);
                    state.memberCount.incrementAndGet();
                    return null;
                }
        );
        log.info("Joined room {} as {} ({})", code, displayName, cursorColor);
        return new RoomJoinResponse(code, displayName, cursorColor, activeMemberCount(code), MAX_ROOM_USERS);
    }

    public RoomJoinResponse joinRoom(String code, String displayName, String cursorColor) {
        String normalized = normalizeIdentity(displayName, code);
        String color = cursorColor == null || cursorColor.isBlank() ? nextCursorColor(code) : cursorColor;
        if (!roomExists(code)) {
            throw new IllegalArgumentException("Room not found");
        }

        executeWithFallback(
                () -> {
                    Object existing = redisTemplate.opsForHash().get(roomMembersKey(code), normalized);
                    if (existing == null) {
                        redisTemplate.opsForHash().put(roomMembersKey(code), normalized, color);
                        redisTemplate.opsForValue().increment(roomCountKey(code));
                    }
                    redisTemplate.expire(roomCountKey(code), roomStateTtl);
                    redisTemplate.expire(roomMembersKey(code), roomStateTtl);
                    redisTemplate.expire(roomAnnotationsKey(code), roomStateTtl);
                    return null;
                },
                () -> {
                    LocalRoomState state = localState(code);
                    if (state.members.putIfAbsent(normalized, color) == null) {
                        state.memberCount.incrementAndGet();
                    }
                    return null;
                }
        );
        return new RoomJoinResponse(code, normalized, color, activeMemberCount(code), MAX_ROOM_USERS);
    }

    public RoomAccessDto leaveRoom(String code, String displayName) {
        if (!roomExists(code)) {
            return new RoomAccessDto(false, "not_found", false, 0, MAX_ROOM_USERS, null);
        }

        if (displayName != null && !displayName.isBlank()) {
            executeWithFallback(
                    () -> {
                        redisTemplate.opsForHash().delete(roomMembersKey(code), displayName);
                        redisTemplate.opsForValue().decrement(roomCountKey(code));
                        return null;
                    },
                    () -> {
                        LocalRoomState state = localRooms.get(code);
                        if (state != null && state.members.remove(displayName) != null) {
                            state.memberCount.updateAndGet(value -> Math.max(value - 1, 0));
                        }
                        return null;
                    }
            );
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

        executeWithFallback(
                () -> {
                    if (leadDisplayName == null || leadDisplayName.isBlank()) {
                        redisTemplate.opsForHash().delete(roomMetaKey(code), "leadDisplayName");
                    } else {
                        redisTemplate.opsForHash().put(roomMetaKey(code), "leadDisplayName", leadDisplayName);
                    }
                    return null;
                },
                () -> {
                    LocalRoomState state = localState(code);
                    state.leadDisplayName = leadDisplayName == null || leadDisplayName.isBlank() ? null : leadDisplayName;
                    return null;
                }
        );
        return new RoomAccessDto(true, null, isLocked(code), activeMemberCount(code), MAX_ROOM_USERS, getLeadDisplayName(code));
    }

    public RoomAccessDto setLocked(String code, String ignoredUserId, boolean locked) {
        if (!roomExists(code)) {
            return new RoomAccessDto(false, "not_found", false, 0, MAX_ROOM_USERS, null);
        }

        executeWithFallback(
                () -> {
                    redisTemplate.opsForHash().put(roomMetaKey(code), "locked", Boolean.toString(locked));
                    return null;
                },
                () -> {
                    localState(code).locked = locked;
                    return null;
                }
        );
        return new RoomAccessDto(true, null, locked, activeMemberCount(code), MAX_ROOM_USERS, getLeadDisplayName(code));
    }

    public void clearRuntimeState(String code) {
        executeWithFallback(
                () -> {
                    redisTemplate.delete(roomMembersKey(code));
                    redisTemplate.delete(roomCountKey(code));
                    redisTemplate.delete(roomMetaKey(code));
                    redisTemplate.delete(roomAnnotationsKey(code));
                    redisTemplate.delete(roomColorCursorKey(code));
                    return null;
                },
                () -> {
                    localRooms.remove(code);
                    return null;
                }
        );
    }

    public void deleteRoom(String code) {
        clearRuntimeState(code);
    }

    public boolean isLocked(String code) {
        return executeWithFallback(
                () -> {
                    Object locked = redisTemplate.opsForHash().get(roomMetaKey(code), "locked");
                    return locked != null && Boolean.parseBoolean(locked.toString());
                },
                () -> {
                    LocalRoomState state = localRooms.get(code);
                    return state != null && state.locked;
                }
        );
    }

    public String getLeadDisplayName(String code) {
        return executeWithFallback(
                () -> {
                    Object lead = redisTemplate.opsForHash().get(roomMetaKey(code), "leadDisplayName");
                    return lead == null ? null : lead.toString();
                },
                () -> {
                    LocalRoomState state = localRooms.get(code);
                    return state == null ? null : state.leadDisplayName;
                }
        );
    }

    @Scheduled(fixedDelay = 60_000)
    void expireFallbackRooms() {
        // No-op by design: the in-memory fallback is for local development only.
    }

    @PreDestroy
    void clearPendingCleanup() {
        localRooms.clear();
    }

    private String allocateDisplayName(String code) {
        for (int attempt = 0; attempt < 20; attempt++) {
            int number = 10 + randomIndex(90);
            String displayName = "Pear #" + String.format("%02d", number);
            if (!memberExists(code, displayName)) {
                return displayName;
            }
        }

        return "Pear #" + String.format("%02d", 10 + randomIndex(90));
    }

    private String nextCursorColor(String code) {
        return executeWithFallback(
                () -> {
                    long raw = redisTemplate.opsForValue().increment(roomColorCursorKey(code));
                    int index = (int) ((raw - 1) % COLORS.size());
                    return COLORS.get(index);
                },
                () -> {
                    LocalRoomState state = localState(code);
                    long raw = state.colorCursor.incrementAndGet();
                    int index = (int) ((raw - 1) % COLORS.size());
                    return COLORS.get(index);
                }
        );
    }

    private String normalizeIdentity(String displayName, String code) {
        if (displayName == null || displayName.isBlank()) {
            return allocateDisplayName(code);
        }
        return displayName.trim();
    }

    private OffsetDateTime roomCreatedAt(String code) {
        return executeWithFallback(
                () -> {
                    Object createdAt = redisTemplate.opsForHash().get(roomMetaKey(code), "createdAt");
                    if (createdAt == null) {
                        return OffsetDateTime.now();
                    }
                    try {
                        return OffsetDateTime.parse(createdAt.toString());
                    } catch (RuntimeException ex) {
                        return OffsetDateTime.now();
                    }
                },
                () -> {
                    LocalRoomState state = localRooms.get(code);
                    return state == null || state.createdAt == null ? OffsetDateTime.now() : state.createdAt;
                }
        );
    }

    private boolean memberExists(String code, String displayName) {
        return executeWithFallback(
                () -> Boolean.TRUE.equals(redisTemplate.opsForHash().hasKey(roomMembersKey(code), displayName)),
                () -> {
                    LocalRoomState state = localRooms.get(code);
                    return state != null && state.members.containsKey(displayName);
                }
        );
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

    private LocalRoomState localState(String code) {
        return localRooms.computeIfAbsent(code, ignored -> new LocalRoomState());
    }

    private <T> T executeWithFallback(Supplier<T> redisAction, Supplier<T> localAction) {
        if (redisAvailable) {
            try {
                return redisAction.get();
            } catch (RuntimeException ex) {
                redisAvailable = false;
                log.warn("Redis unavailable; falling back to in-memory room state. {}", ex.getMessage());
            }
        }

        return localAction.get();
    }

    private static final class LocalRoomState {
        private final Map<String, String> members = new ConcurrentHashMap<>();
        private final Map<String, String> annotations = new ConcurrentHashMap<>();
        private final AtomicInteger memberCount = new AtomicInteger(0);
        private final AtomicInteger colorCursor = new AtomicInteger(0);
        private volatile OffsetDateTime createdAt;
        private volatile boolean active;
        private volatile boolean locked;
        private volatile String leadDisplayName;
    }
}