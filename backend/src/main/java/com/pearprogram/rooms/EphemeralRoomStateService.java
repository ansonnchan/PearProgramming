package com.pearprogram.rooms;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.RedisConnectionFailureException;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class EphemeralRoomStateService {
    private static final Logger log = LoggerFactory.getLogger(EphemeralRoomStateService.class);

    private final StringRedisTemplate redisTemplate;
    private final Map<String, FallbackRoom> fallbackRooms = new ConcurrentHashMap<>();
    private volatile boolean redisAvailable = true;

    public EphemeralRoomStateService(StringRedisTemplate redisTemplate) {
        this.redisTemplate = redisTemplate;
    }

    public boolean codeExists(String code) {
        String key = roomCodeKey(code);
        try {
            Boolean exists = redisTemplate.hasKey(key);
            redisAvailable = true;
            return Boolean.TRUE.equals(exists) || fallbackContains(code);
        } catch (RedisConnectionFailureException ex) {
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
        } catch (RedisConnectionFailureException ex) {
            markRedisDown(ex);
            fallbackRooms.put(code, new FallbackRoom(workspaceId, Instant.now().plus(ttl)));
        }
    }

    public boolean isRedisAvailable() {
        return redisAvailable;
    }

    @Scheduled(fixedDelay = 60_000)
    void expireFallbackRooms() {
        Instant now = Instant.now();
        fallbackRooms.entrySet().removeIf(entry -> entry.getValue().expiresAt().isBefore(now));
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

    private record FallbackRoom(UUID workspaceId, Instant expiresAt) {
    }
}
