package com.pearprogram.rooms;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class RoomProjectStateService {
    private static final Logger log = LoggerFactory.getLogger(RoomProjectStateService.class);
    private static final TypeReference<List<Map<String, Object>>> FILE_LIST_TYPE = new TypeReference<>() {
    };

    private final StringRedisTemplate redisTemplate;
    private final ObjectMapper objectMapper;
    private final String keyPrefix;
    private final Duration ttl = Duration.ofHours(24);
    private final Map<String, List<Map<String, Object>>> localFiles = new ConcurrentHashMap<>();

    public RoomProjectStateService(
            StringRedisTemplate redisTemplate,
            ObjectMapper objectMapper,
            @Value("${pearprogram.redis.key-prefix:pearprogram}") String keyPrefix
    ) {
        this.redisTemplate = redisTemplate;
        this.objectMapper = objectMapper;
        this.keyPrefix = normalizeKeyPrefix(keyPrefix);
    }

    public List<Map<String, Object>> getFiles(String roomCode) {
        try {
            String raw = redisTemplate.opsForValue().get(roomFilesKey(roomCode));
            if (raw == null || raw.isBlank()) {
                return List.of();
            }
            return objectMapper.readValue(raw, FILE_LIST_TYPE);
        } catch (RuntimeException | JsonProcessingException ex) {
            log.warn("Unable to load Redis-backed room file snapshot for {}; using local fallback. reason={}",
                    roomCode, rootCauseMessage(ex));
            return localFiles.getOrDefault(roomCode, List.of());
        }
    }

    public List<Map<String, Object>> saveFiles(String roomCode, List<Map<String, Object>> files) {
        List<Map<String, Object>> safeFiles = files == null ? List.of() : List.copyOf(files);
        localFiles.put(roomCode, safeFiles);
        try {
            redisTemplate.opsForValue().set(roomFilesKey(roomCode), objectMapper.writeValueAsString(safeFiles), ttl);
            log.info("Saved room file snapshot for {} with {} file(s)", roomCode, safeFiles.size());
        } catch (RuntimeException | JsonProcessingException ex) {
            log.warn("Unable to save Redis-backed room file snapshot for {}; local fallback only. reason={}",
                    roomCode, rootCauseMessage(ex));
        }
        return safeFiles;
    }

    public void deleteFiles(String roomCode) {
        localFiles.remove(roomCode);
        try {
            redisTemplate.delete(roomFilesKey(roomCode));
        } catch (RuntimeException ex) {
            log.warn("Unable to delete Redis-backed room file snapshot for {}. reason={}", roomCode, rootCauseMessage(ex));
        }
    }

    private String roomFilesKey(String roomCode) {
        return keyPrefix + ":room:" + roomCode + ":files";
    }

    private String normalizeKeyPrefix(String raw) {
        String normalized = raw == null ? "" : raw.trim().replaceAll("^:+|:+$", "");
        return normalized.isBlank() ? "pearprogram" : normalized;
    }

    private String rootCauseMessage(Throwable ex) {
        Throwable current = ex;
        while (current.getCause() != null) {
            current = current.getCause();
        }
        return current.getMessage() == null || current.getMessage().isBlank()
                ? current.getClass().getSimpleName()
                : current.getMessage();
    }
}
