package com.pearprogram.rooms;

import org.springframework.beans.factory.annotation.Value;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.Instant;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class EphemeralRoomStateService {
    private static final Logger log = LoggerFactory.getLogger(EphemeralRoomStateService.class);
    private static final int MAX_ROOM_USERS = 5;

    private final StringRedisTemplate redisTemplate;
    private final Duration roomStateTtl;
    private final Map<String, FallbackRoom> fallbackRooms = new ConcurrentHashMap<>();
    private final Map<String, FallbackRuntimeState> fallbackRuntimeStates = new ConcurrentHashMap<>();
    private volatile boolean redisAvailable = true;

    public EphemeralRoomStateService(
            StringRedisTemplate redisTemplate,
            @Value("${pearprogram.rooms.ttl-hours}") long ttlHours
    ) {
        this.redisTemplate = redisTemplate;
        this.roomStateTtl = Duration.ofHours(ttlHours);
    }

    public boolean codeExists(String code) {
        String key = roomCodeKey(code);
        try {
            Boolean exists = redisTemplate.hasKey(key);
            redisAvailable = true;
            return Boolean.TRUE.equals(exists) || fallbackContains(code);
        } catch (RuntimeException ex) {
            markRedisDown(ex);
            return fallbackContains(code);
        }
    }

    public void saveRoomMapping(String code, UUID workspaceId, Duration ttl) {
        try {
            redisTemplate.opsForValue().set(roomCodeKey(code), workspaceId.toString(), ttl);
            redisTemplate.opsForHash().put(roomKey(code), "workspaceId", workspaceId.toString());
            redisTemplate.expire(roomKey(code), ttl);
            redisAvailable = true;
        } catch (RuntimeException ex) {
            markRedisDown(ex);
            fallbackRooms.put(code, new FallbackRoom(workspaceId, Instant.now().plus(ttl)));
        }
    }

    public boolean isRedisAvailable() {
        return redisAvailable;
    }

    public int activeMemberCount(String code) {
        try {
            redisAvailable = true;
            return redisMembers(code).size();
        } catch (RuntimeException ex) {
            markRedisDown(ex);
            return fallbackRuntimeState(code).members.size();
        }
    }

    public RoomAccessDto roomAccess(String code, String userId) {
        try {
            Set<String> members = redisMembers(code);
            boolean locked = redisLocked(code);
            String leadUserId = redisLeadUserId(code);
            redisAvailable = true;
            return accessFrom(code, userId, members, locked, leadUserId);
        } catch (RuntimeException ex) {
            markRedisDown(ex);
            FallbackRuntimeState state = fallbackRuntimeState(code);
            return accessFrom(code, userId, new HashSet<>(state.members), state.locked, state.leadUserId);
        }
    }

    public RoomAccessDto joinRoom(String code, String userId) {
        if (userId == null || userId.isBlank()) {
            return roomAccess(code, userId);
        }

        RoomAccessDto accessBeforeJoin = roomAccess(code, userId);
        if (!accessBeforeJoin.canJoin()) {
            return accessBeforeJoin;
        }

        try {
            redisTemplate.opsForSet().add(roomMembersKey(code), userId);
            if (isBlank(redisLeadUserId(code))) {
                redisTemplate.opsForHash().put(roomKey(code), "leadUserId", userId);
            }
            expireRuntimeKeys(code);
            redisAvailable = true;
            return roomAccess(code, userId);
        } catch (RuntimeException ex) {
            markRedisDown(ex);
            FallbackRuntimeState state = fallbackRuntimeState(code);
            state.members.add(userId);
            if (isBlank(state.leadUserId)) {
                state.leadUserId = userId;
            }
            state.expiresAt = Instant.now().plus(roomStateTtl);
            return accessFrom(code, userId, new HashSet<>(state.members), state.locked, state.leadUserId);
        }
    }

    public RoomAccessDto leaveRoom(String code, String userId) {
        if (userId == null || userId.isBlank()) {
            return roomAccess(code, userId);
        }

        try {
            redisTemplate.opsForSet().remove(roomMembersKey(code), userId);
            Set<String> members = redisMembers(code);
            String leadUserId = redisLeadUserId(code);
            if (userId.equals(leadUserId)) {
                String nextLead = members.stream().findFirst().orElse(null);
                setRedisLeadUserId(code, nextLead);
                leadUserId = nextLead;
            }
            expireRuntimeKeys(code);
            redisAvailable = true;
            return accessFrom(code, userId, members, redisLocked(code), leadUserId);
        } catch (RuntimeException ex) {
            markRedisDown(ex);
            FallbackRuntimeState state = fallbackRuntimeState(code);
            state.members.remove(userId);
            if (userId.equals(state.leadUserId)) {
                state.leadUserId = state.members.stream().findFirst().orElse(null);
            }
            state.expiresAt = Instant.now().plus(roomStateTtl);
            return accessFrom(code, userId, new HashSet<>(state.members), state.locked, state.leadUserId);
        }
    }

    public RoomAccessDto transferLead(String code, String leadUserId) {
        if (leadUserId == null || leadUserId.isBlank()) {
            return roomAccess(code, leadUserId);
        }

        try {
            redisTemplate.opsForHash().put(roomKey(code), "leadUserId", leadUserId);
            expireRuntimeKeys(code);
            redisAvailable = true;
            return roomAccess(code, leadUserId);
        } catch (RuntimeException ex) {
            markRedisDown(ex);
            FallbackRuntimeState state = fallbackRuntimeState(code);
            state.leadUserId = leadUserId;
            state.expiresAt = Instant.now().plus(roomStateTtl);
            return accessFrom(code, leadUserId, new HashSet<>(state.members), state.locked, state.leadUserId);
        }
    }

    public RoomAccessDto setLocked(String code, String userId, boolean locked) {
        try {
            String leadUserId = redisLeadUserId(code);
            if (!isBlank(leadUserId) && !leadUserId.equals(userId)) {
                return roomAccess(code, userId);
            }
            if (isBlank(leadUserId) && !isBlank(userId)) {
                redisTemplate.opsForHash().put(roomKey(code), "leadUserId", userId);
            }
            redisTemplate.opsForHash().put(roomKey(code), "locked", Boolean.toString(locked));
            expireRuntimeKeys(code);
            redisAvailable = true;
            return roomAccess(code, userId);
        } catch (RuntimeException ex) {
            markRedisDown(ex);
            FallbackRuntimeState state = fallbackRuntimeState(code);
            if (!isBlank(state.leadUserId) && !state.leadUserId.equals(userId)) {
                return accessFrom(code, userId, new HashSet<>(state.members), state.locked, state.leadUserId);
            }
            if (isBlank(state.leadUserId)) {
                state.leadUserId = userId;
            }
            state.locked = locked;
            state.expiresAt = Instant.now().plus(roomStateTtl);
            return accessFrom(code, userId, new HashSet<>(state.members), state.locked, state.leadUserId);
        }
    }

    public void clearRuntimeState(String code) {
        try {
            redisTemplate.delete(roomMembersKey(code));
            redisTemplate.opsForHash().delete(roomKey(code), "locked", "leadUserId");
            redisAvailable = true;
        } catch (RuntimeException ex) {
            markRedisDown(ex);
            fallbackRuntimeStates.remove(code);
        }
    }

    @Scheduled(fixedDelay = 60_000)
    void expireFallbackRooms() {
        Instant now = Instant.now();
        fallbackRooms.entrySet().removeIf(entry -> entry.getValue().expiresAt().isBefore(now));
        fallbackRuntimeStates.entrySet().removeIf(entry -> entry.getValue().expiresAt.isBefore(now));
    }

    private boolean fallbackContains(String code) {
        FallbackRoom room = fallbackRooms.get(code);
        return room != null && room.expiresAt().isAfter(Instant.now());
    }

    private void markRedisDown(RuntimeException ex) {
        if (redisAvailable) {
            log.warn("Redis unavailable; falling back to single-instance in-memory room state. {}", ex.getMessage());
        }
        redisAvailable = false;
    }

    private String roomCodeKey(String code) {
        return "room-code:" + code;
    }

    private String roomKey(String code) {
        return "room:" + code;
    }

    private String roomMembersKey(String code) {
        return "room:" + code + ":members";
    }

    private RoomAccessDto accessFrom(String code, String userId, Set<String> members, boolean locked, String leadUserId) {
        boolean alreadyInside = userId != null && members.contains(userId);
        String normalizedLeadUserId = isBlank(leadUserId) ? null : leadUserId;
        boolean full = members.size() >= MAX_ROOM_USERS;
        boolean canJoin = alreadyInside || (!locked && !full);
        String reason = canJoin ? null : locked ? "locked" : "full";
        return new RoomAccessDto(canJoin, reason, locked, members.size(), MAX_ROOM_USERS, normalizedLeadUserId);
    }

    private Set<String> redisMembers(String code) {
        Set<String> members = redisTemplate.opsForSet().members(roomMembersKey(code));
        return members == null ? Set.of() : members;
    }

    private boolean redisLocked(String code) {
        Object value = redisTemplate.opsForHash().get(roomKey(code), "locked");
        return Boolean.parseBoolean(value == null ? "false" : value.toString());
    }

    private String redisLeadUserId(String code) {
        Object value = redisTemplate.opsForHash().get(roomKey(code), "leadUserId");
        return value == null ? null : value.toString();
    }

    private void setRedisLeadUserId(String code, String leadUserId) {
        if (isBlank(leadUserId)) {
            redisTemplate.opsForHash().delete(roomKey(code), "leadUserId");
        } else {
            redisTemplate.opsForHash().put(roomKey(code), "leadUserId", leadUserId);
        }
    }

    private void expireRuntimeKeys(String code) {
        redisTemplate.expire(roomKey(code), roomStateTtl);
        redisTemplate.expire(roomMembersKey(code), roomStateTtl);
    }

    private FallbackRuntimeState fallbackRuntimeState(String code) {
        return fallbackRuntimeStates.computeIfAbsent(code, ignored -> new FallbackRuntimeState(Instant.now().plus(roomStateTtl)));
    }

    private boolean isBlank(String value) {
        return value == null || value.isBlank();
    }

    private record FallbackRoom(UUID workspaceId, Instant expiresAt) {
    }

    private static class FallbackRuntimeState {
        private final Set<String> members = ConcurrentHashMap.newKeySet();
        private volatile boolean locked;
        private volatile String leadUserId;
        private volatile Instant expiresAt;

        private FallbackRuntimeState(Instant expiresAt) {
            this.expiresAt = expiresAt;
        }
    }
}
