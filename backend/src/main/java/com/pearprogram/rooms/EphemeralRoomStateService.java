package com.pearprogram.rooms;

import jakarta.annotation.PreDestroy;
import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.RedisCallback;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.net.URI;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Supplier;

@Service
public class EphemeralRoomStateService {
    private static final Logger log = LoggerFactory.getLogger(EphemeralRoomStateService.class);
    private static final int MAX_ROOM_USERS = 5;
    private static final String DEFAULT_COLOR = "#378ADD";
    private static final Duration MEMBER_STALE_TTL = Duration.ofMinutes(3);
    private static final Duration RECENT_MEMBER_TTL = Duration.ofMinutes(5);
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
    private final Duration emptyRoomGrace;
    private final String keyPrefix;
    private final String redisUrl;
    private final String redisHost;
    private final String redisPort;
    private final boolean redisSslEnabled;
    private final Map<String, LocalRoomState> localRooms = new ConcurrentHashMap<>();
    private volatile boolean redisAvailable = false;
    private volatile boolean redisFailureLogged = false;

    public EphemeralRoomStateService(
            StringRedisTemplate redisTemplate,
            @Value("${pearprogram.rooms.cleanup-grace-seconds:120}") long cleanupGraceSeconds,
            @Value("${pearprogram.redis.key-prefix:pearprogram}") String keyPrefix,
            @Value("${SPRING_REDIS_URL:${REDIS_URL:}}") String redisUrl,
            @Value("${spring.data.redis.host:}") String redisHost,
            @Value("${spring.data.redis.port:}") String redisPort,
            @Value("${spring.data.redis.ssl.enabled:false}") boolean redisSslEnabled
    ) {
        this.redisTemplate = redisTemplate;
        this.roomStateTtl = Duration.ofHours(24);
        this.emptyRoomGrace = Duration.ofSeconds(Math.max(30, cleanupGraceSeconds));
        this.keyPrefix = normalizeKeyPrefix(keyPrefix);
        this.redisUrl = redisUrl == null ? "" : redisUrl.trim();
        this.redisHost = redisHost == null ? "" : redisHost.trim();
        this.redisPort = redisPort == null ? "" : redisPort.trim();
        this.redisSslEnabled = redisSslEnabled;
    }

    @PostConstruct
    void diagnoseRedisStartup() {
        RedisEndpoint endpoint = redisEndpoint();
        log.info("Redis room state startup diagnostics: urlConfigured={}, hostPresent={}, portPresent={}, sslEnabled={}, keyPrefix={}. Connectivity will be checked in the background so Redis does not block deployment.",
                !redisUrl.isBlank(), endpoint.hostPresent(), endpoint.portPresent(), endpoint.sslEnabled(), keyPrefix);
    }

    @Scheduled(
            initialDelayString = "${pearprogram.redis.connection-initial-delay-ms:5000}",
            fixedDelayString = "${pearprogram.redis.connection-retry-ms:30000}"
    )
    void refreshRedisAvailability() {
        RedisEndpoint endpoint = redisEndpoint();
        try {
            String pong = redisTemplate.execute((RedisCallback<String>) (connection) -> connection.ping());
            boolean wasUnavailable = !redisAvailable;
            redisAvailable = true;
            redisFailureLogged = false;
            if (wasUnavailable) {
                log.info("Room state is Redis-backed. ping={}, host={}, port={}, sslEnabled={}, keyPrefix={}",
                        pong, endpoint.safeHost(), endpoint.safePort(), endpoint.sslEnabled(), keyPrefix);
            }
        } catch (RuntimeException ex) {
            boolean wasAvailable = redisAvailable;
            redisAvailable = false;
            if (wasAvailable || !redisFailureLogged) {
                redisFailureLogged = true;
                log.warn("Room state is using in-memory fallback. Redis connection failed: {} hostPresent={} portPresent={} sslEnabled={} keyPrefix={}. Production room joins may break across instances or after restarts until Redis is reachable.",
                        rootCauseMessage(ex), endpoint.hostPresent(), endpoint.portPresent(), endpoint.sslEnabled(), keyPrefix);
            }
        }
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
                    redisTemplate.opsForHash().put(roomMetaKey(code), "locked", "false");
                    redisTemplate.opsForHash().delete(roomMetaKey(code), "leadUserId", "leadDisplayName", "vacantSince");
                    redisTemplate.delete(roomMembersKey(code));
                    redisTemplate.delete(roomRecentMembersKey(code));
                    redisTemplate.delete(roomAnnotationsKey(code));
                    redisTemplate.opsForValue().set(roomCountKey(code), "0", roomStateTtl);
                    redisTemplate.opsForValue().set(roomColorCursorKey(code), "0", roomStateTtl);
                    expireRoomKeys(code);
                    return null;
                },
                () -> {
                    LocalRoomState state = localState(code);
                    state.createdAt = createdAt;
                    state.active = true;
                    state.locked = false;
                    state.leadUserId = null;
                    state.vacantSince = null;
                    state.members.clear();
                    state.recentMembers.clear();
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
                () -> pruneExpiredRedisMembers(code, false),
                () -> {
                    LocalRoomState state = localRooms.get(code);
                    if (state == null) {
                        return 0;
                    }
                    return pruneExpiredLocalMembers(code, state, false);
                }
        );
    }

    public boolean isActiveMember(String code, String userId) {
        String normalizedUserId = normalizeSessionId(userId);
        return !normalizedUserId.isBlank() && roomExists(code) && activeUserExists(code, normalizedUserId);
    }

    public RoomDto getRoomSummary(String code, String joinUrl) {
        return new RoomDto(
                code,
                code,
                null,
                joinUrl,
                roomExists(code) && isActive(code),
                roomCreatedAt(code),
                activeMemberCount(code),
                MAX_ROOM_USERS,
                isLocked(code),
                getLeadUserId(code)
        );
    }

    public RoomAccessDto roomAccess(String code, String displayName) {
        return roomAccess(code, displayName, displayName);
    }

    public RoomAccessDto roomAccess(String code, String sessionId, String displayName) {
        if (!roomExists(code)) {
            return new RoomAccessDto(false, "not_found", false, 0, MAX_ROOM_USERS, null);
        }

        String userId = normalizeSessionId(sessionId);
        boolean locked = isLocked(code);
        int memberCount = activeMemberCount(code);
        boolean isMember = !userId.isBlank() && activeUserExists(code, userId);
        boolean wasRecentMember = !userId.isBlank() && recentUserExists(code, userId);
        boolean hasCapacity = memberCount < MAX_ROOM_USERS;
        boolean canJoin = isMember || (wasRecentMember && hasCapacity) || (!locked && hasCapacity);
        String reason = canJoin ? null : locked ? "locked" : "full";
        return new RoomAccessDto(canJoin, reason, locked, memberCount, MAX_ROOM_USERS, getLeadUserId(code));
    }

    public RoomJoinResponse joinRoom(String code) {
        if (!roomExists(code)) {
            throw new IllegalArgumentException("Room not found");
        }

        RoomAccessDto access = roomAccess(code, null, null);
        if (!access.canJoin()) {
            throw new IllegalStateException(access.reason() == null ? "Room unavailable" : access.reason());
        }

        String sessionId = java.util.UUID.randomUUID().toString();
        String displayName = allocateDisplayName(code);
        String cursorColor = nextCursorColor(code);
        return joinRoom(code, sessionId, sessionId, displayName, cursorColor);
    }

    public RoomJoinResponse joinRoom(String code, String sessionId, String displayName, String cursorColor) {
        return joinRoom(code, sessionId, sessionId, displayName, cursorColor);
    }

    public RoomJoinResponse joinRoom(String code, String sessionId, String connectionId, String displayName, String cursorColor) {
        if (!roomExists(code)) {
            throw new IllegalArgumentException("Room not found");
        }

        String normalizedUserId = normalizeSessionId(sessionId);
        if (normalizedUserId.isBlank()) {
            normalizedUserId = java.util.UUID.randomUUID().toString();
        }

        RoomAccessDto access = roomAccess(code, normalizedUserId, displayName);
        if (!access.canJoin() && !activeUserExists(code, normalizedUserId)) {
            throw new IllegalStateException(access.reason() == null ? "Room unavailable" : access.reason());
        }

        String presenceId = normalizePresenceId(connectionId, normalizedUserId);
        String normalizedDisplayName = normalizeIdentity(displayName, code);
        String normalizedColor = cursorColor == null || cursorColor.isBlank() ? nextCursorColor(code) : cursorColor;
        upsertPresence(code, presenceId, normalizedUserId, normalizedDisplayName, normalizedColor);
        markRoomActive(code);
        log.info("Joined room {} as {} ({})", code, normalizedDisplayName, normalizedColor);
        return new RoomJoinResponse(code, normalizedDisplayName, normalizedColor, activeMemberCount(code), MAX_ROOM_USERS);
    }

    public RoomAccessDto leaveRoom(String code, String displayName) {
        return leaveRoom(code, displayName, displayName, displayName);
    }

    public RoomAccessDto leaveRoom(String code, String sessionId, String displayName) {
        return leaveRoom(code, sessionId, sessionId, displayName);
    }

    public RoomAccessDto leaveRoom(String code, String sessionId, String connectionId, String displayName) {
        if (!roomExists(code)) {
            return new RoomAccessDto(false, "not_found", false, 0, MAX_ROOM_USERS, null);
        }

        String userId = normalizeSessionId(sessionId);
        String presenceId = normalizePresenceId(connectionId, userId);
        if (!presenceId.isBlank()) {
            removePresence(code, presenceId);
        }

        int memberCount = Math.max(activeMemberCount(code), 0);
        if (memberCount <= 0) {
            markRoomInactive(code);
            return new RoomAccessDto(false, "closed", isLocked(code), 0, MAX_ROOM_USERS, getLeadUserId(code));
        }

        return new RoomAccessDto(true, null, isLocked(code), memberCount, MAX_ROOM_USERS, getLeadUserId(code));
    }

    public RoomAccessDto transferLead(String code, String leadUserId) {
        if (!roomExists(code)) {
            return new RoomAccessDto(false, "not_found", false, 0, MAX_ROOM_USERS, null);
        }

        String normalizedLeadUserId = leadUserId == null || leadUserId.isBlank() ? null : leadUserId.trim();
        executeWithFallback(
                () -> {
                    if (normalizedLeadUserId == null) {
                        redisTemplate.opsForHash().delete(roomMetaKey(code), "leadUserId");
                    } else {
                        redisTemplate.opsForHash().put(roomMetaKey(code), "leadUserId", normalizedLeadUserId);
                    }
                    expireRoomKeys(code);
                    return null;
                },
                () -> {
                    localState(code).leadUserId = normalizedLeadUserId;
                    return null;
                }
        );
        return new RoomAccessDto(true, null, isLocked(code), activeMemberCount(code), MAX_ROOM_USERS, getLeadUserId(code));
    }

    public RoomAccessDto setLocked(String code, String ignoredUserId, boolean locked) {
        if (!roomExists(code)) {
            return new RoomAccessDto(false, "not_found", false, 0, MAX_ROOM_USERS, null);
        }

        executeWithFallback(
                () -> {
                    redisTemplate.opsForHash().put(roomMetaKey(code), "locked", Boolean.toString(locked));
                    expireRoomKeys(code);
                    return null;
                },
                () -> {
                    localState(code).locked = locked;
                    return null;
                }
        );
        return new RoomAccessDto(true, null, locked, activeMemberCount(code), MAX_ROOM_USERS, getLeadUserId(code));
    }

    public void markRoomInactive(String code) {
        String now = OffsetDateTime.now().toString();
        executeWithFallback(
                () -> {
                    redisTemplate.opsForHash().put(roomMetaKey(code), "active", "false");
                    redisTemplate.opsForHash().putIfAbsent(roomMetaKey(code), "vacantSince", now);
                    expireRoomKeys(code);
                    return null;
                },
                () -> {
                    LocalRoomState state = localRooms.get(code);
                    if (state != null) {
                        state.active = false;
                        if (state.vacantSince == null) {
                            state.vacantSince = OffsetDateTime.parse(now);
                        }
                    }
                    return null;
                }
        );
    }

    public void markRoomActive(String code) {
        executeWithFallback(
                () -> {
                    redisTemplate.opsForHash().put(roomMetaKey(code), "active", "true");
                    redisTemplate.opsForHash().delete(roomMetaKey(code), "vacantSince");
                    expireRoomKeys(code);
                    return null;
                },
                () -> {
                    LocalRoomState state = localState(code);
                    state.active = true;
                    state.vacantSince = null;
                    return null;
                }
        );
    }

    public void clearRuntimeState(String code) {
        executeWithFallback(
                () -> {
                    redisTemplate.delete(roomMembersKey(code));
                    redisTemplate.delete(roomRecentMembersKey(code));
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

    public boolean isActive(String code) {
        return executeWithFallback(
                () -> {
                    Object active = redisTemplate.opsForHash().get(roomMetaKey(code), "active");
                    return active == null || Boolean.parseBoolean(active.toString());
                },
                () -> {
                    LocalRoomState state = localRooms.get(code);
                    return state != null && state.active;
                }
        );
    }

    public String getLeadDisplayName(String code) {
        return getLeadUserId(code);
    }

    public String getLeadUserId(String code) {
        return executeWithFallback(
                () -> {
                    Object lead = redisTemplate.opsForHash().get(roomMetaKey(code), "leadUserId");
                    if (lead == null) {
                        lead = redisTemplate.opsForHash().get(roomMetaKey(code), "leadDisplayName");
                    }
                    return lead == null ? null : lead.toString();
                },
                () -> {
                    LocalRoomState state = localRooms.get(code);
                    return state == null ? null : state.leadUserId;
                }
        );
    }

    public Optional<ActiveMember> firstActiveMemberExcept(String code, String excludedUserId) {
        String normalizedExcluded = normalizeSessionId(excludedUserId);
        return executeWithFallback(
                () -> activeRedisMembers(code).stream()
                        .filter((member) -> !member.userId().equals(normalizedExcluded))
                        .findFirst(),
                () -> {
                    LocalRoomState state = localRooms.get(code);
                    if (state == null) {
                        return Optional.empty();
                    }
                    pruneExpiredLocalMembers(code, state, false);
                    return state.members.values().stream()
                            .filter((member) -> !member.userId.equals(normalizedExcluded))
                            .map((member) -> new ActiveMember(member.userId, member.displayName, member.cursorColor))
                            .findFirst();
                }
        );
    }

    public Optional<ActiveMember> activeMember(String code, String userId) {
        String normalizedUserId = normalizeSessionId(userId);
        return executeWithFallback(
                () -> activeRedisMembers(code).stream()
                        .filter(member -> member.userId().equals(normalizedUserId))
                        .findFirst(),
                () -> {
                    LocalRoomState state = localRooms.get(code);
                    if (state == null) {
                        return Optional.empty();
                    }
                    pruneExpiredLocalMembers(code, state, false);
                    return state.members.values().stream()
                            .filter(member -> member.userId.equals(normalizedUserId))
                            .map(member -> new ActiveMember(member.userId, member.displayName, member.cursorColor))
                            .findFirst();
                }
        );
    }

    @Scheduled(fixedDelay = 60_000)
    void expireStaleRooms() {
        executeWithFallback(
                () -> {
                    for (String code : findKnownRoomCodes()) {
                        int count = pruneExpiredRedisMembers(code, false);
                        if (count <= 0) {
                            markRoomInactive(code);
                            if (vacancyExpired(code)) {
                                deleteRoom(code);
                            }
                        }
                    }
                    return null;
                },
                () -> {
                    for (Map.Entry<String, LocalRoomState> entry : new ArrayList<>(localRooms.entrySet())) {
                        int count = pruneExpiredLocalMembers(entry.getKey(), entry.getValue(), false);
                        if (count <= 0) {
                            markRoomInactive(entry.getKey());
                            if (localVacancyExpired(entry.getValue())) {
                                localRooms.remove(entry.getKey());
                            }
                        }
                    }
                    return null;
                }
        );
    }

    @PreDestroy
    void clearPendingCleanup() {
        localRooms.clear();
    }

    private void upsertPresence(String code, String presenceId, String userId, String displayName, String cursorColor) {
        executeWithFallback(
                () -> {
                    if (!presenceId.equals(userId)) {
                        redisTemplate.opsForHash().delete(roomMembersKey(code), userId);
                    }
                    long now = System.currentTimeMillis();
                    redisTemplate.opsForHash().put(roomMembersKey(code), presenceId, encodePresence(userId, displayName, cursorColor, now));
                    redisTemplate.opsForHash().put(roomRecentMembersKey(code), userId, Long.toString(now));
                    int activeCount = activeRedisMembers(code).size();
                    writeActiveCount(code, activeCount);
                    expireRoomKeys(code);
                    return null;
                },
                () -> {
                    LocalRoomState state = localState(code);
                    if (!presenceId.equals(userId)) {
                        state.members.remove(userId);
                    }
                    long now = System.currentTimeMillis();
                    state.members.put(presenceId, new LocalMemberState(userId, displayName, cursorColor, now));
                    state.recentMembers.put(userId, now);
                    state.memberCount.set(countUniqueLocalUsers(state));
                    return null;
                }
        );
    }

    private void removePresence(String code, String presenceId) {
        executeWithFallback(
                () -> {
                    redisTemplate.opsForHash().delete(roomMembersKey(code), presenceId);
                    writeActiveCount(code, activeRedisMembers(code).size());
                    expireRoomKeys(code);
                    return null;
                },
                () -> {
                    LocalRoomState state = localRooms.get(code);
                    if (state != null) {
                        state.members.remove(presenceId);
                        state.memberCount.set(countUniqueLocalUsers(state));
                    }
                    return null;
                }
        );
    }

    private String allocateDisplayName(String code) {
        for (int attempt = 0; attempt < 20; attempt++) {
            int number = 10 + randomIndex(90);
            String displayName = "Pear #" + String.format("%02d", number);
            if (!displayNameExists(code, displayName)) {
                return displayName;
            }
        }

        return "Pear #" + String.format("%02d", 10 + randomIndex(90));
    }

    private String nextCursorColor(String code) {
        return executeWithFallback(
                () -> {
                    Long raw = redisTemplate.opsForValue().increment(roomColorCursorKey(code));
                    int index = (int) (((raw == null ? 1 : raw) - 1) % COLORS.size());
                    expireRoomKeys(code);
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

    private String normalizeSessionId(String sessionId) {
        return sessionId == null ? "" : sessionId.trim();
    }

    private String normalizePresenceId(String connectionId, String userId) {
        String normalized = normalizeSessionId(connectionId);
        if (!normalized.isBlank()) {
            return normalized;
        }
        return normalizeSessionId(userId);
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

    private boolean activeUserExists(String code, String userId) {
        return executeWithFallback(
                () -> activeRedisMembers(code).stream().anyMatch((member) -> member.userId().equals(userId)),
                () -> {
                    LocalRoomState state = localRooms.get(code);
                    if (state == null) {
                        return false;
                    }
                    pruneExpiredLocalMembers(code, state, false);
                    return state.members.values().stream().anyMatch((member) -> member.userId.equals(userId));
                }
        );
    }

    private boolean recentUserExists(String code, String userId) {
        return executeWithFallback(
                () -> {
                    pruneExpiredRecentRedisMembers(code);
                    return Boolean.TRUE.equals(redisTemplate.opsForHash().hasKey(roomRecentMembersKey(code), userId));
                },
                () -> {
                    LocalRoomState state = localRooms.get(code);
                    if (state == null) {
                        return false;
                    }
                    pruneExpiredRecentLocalMembers(state);
                    return state.recentMembers.containsKey(userId);
                }
        );
    }

    private boolean displayNameExists(String code, String displayName) {
        return executeWithFallback(
                () -> activeRedisMembers(code).stream().anyMatch((member) -> member.displayName().equals(displayName)),
                () -> {
                    LocalRoomState state = localRooms.get(code);
                    if (state == null) {
                        return false;
                    }
                    pruneExpiredLocalMembers(code, state, false);
                    return state.members.values().stream().anyMatch((member) -> member.displayName.equals(displayName));
                }
        );
    }

    private int pruneExpiredRedisMembers(String code, boolean deleteIfEmpty) {
        List<ActiveMember> active = activeRedisMembers(code);
        int activeCount = active.size();
        writeActiveCount(code, activeCount);
        if (activeCount <= 0) {
            markRoomInactive(code);
            if (deleteIfEmpty && vacancyExpired(code)) {
                deleteRoom(code);
            }
        }
        return activeCount;
    }

    private List<ActiveMember> activeRedisMembers(String code) {
        Map<Object, Object> entries = redisTemplate.opsForHash().entries(roomMembersKey(code));
        if (entries.isEmpty()) {
            return List.of();
        }

        long now = System.currentTimeMillis();
        Map<String, ActiveMember> byUserId = new ConcurrentHashMap<>();
        for (Map.Entry<Object, Object> entry : entries.entrySet()) {
            String presenceId = String.valueOf(entry.getKey());
            MemberPresence presence = decodePresence(String.valueOf(entry.getValue()), presenceId);
            if (isExpired(now, presence.lastSeen())) {
                redisTemplate.opsForHash().delete(roomMembersKey(code), presenceId);
                continue;
            }
            byUserId.putIfAbsent(presence.userId(), new ActiveMember(presence.userId(), presence.displayName(), presence.cursorColor()));
        }
        return new ArrayList<>(byUserId.values());
    }

    private int pruneExpiredLocalMembers(String code, LocalRoomState state, boolean deleteIfEmpty) {
        long now = System.currentTimeMillis();
        for (Map.Entry<String, LocalMemberState> entry : new ArrayList<>(state.members.entrySet())) {
            if (isExpired(now, entry.getValue().lastSeen)) {
                state.members.remove(entry.getKey());
            }
        }

        int activeCount = countUniqueLocalUsers(state);
        state.memberCount.set(activeCount);
        if (activeCount <= 0) {
            state.active = false;
            if (state.vacantSince == null) {
                state.vacantSince = OffsetDateTime.now();
            }
            if (deleteIfEmpty && localVacancyExpired(state)) {
                localRooms.remove(code);
            }
        }
        return activeCount;
    }

    private void pruneExpiredRecentRedisMembers(String code) {
        Map<Object, Object> entries = redisTemplate.opsForHash().entries(roomRecentMembersKey(code));
        if (entries.isEmpty()) {
            return;
        }

        long now = System.currentTimeMillis();
        for (Map.Entry<Object, Object> entry : entries.entrySet()) {
            long lastSeen = parseLong(String.valueOf(entry.getValue()), 0);
            if (now - lastSeen > RECENT_MEMBER_TTL.toMillis()) {
                redisTemplate.opsForHash().delete(roomRecentMembersKey(code), String.valueOf(entry.getKey()));
            }
        }
    }

    private void pruneExpiredRecentLocalMembers(LocalRoomState state) {
        long now = System.currentTimeMillis();
        for (Map.Entry<String, Long> entry : new ArrayList<>(state.recentMembers.entrySet())) {
            if (now - entry.getValue() > RECENT_MEMBER_TTL.toMillis()) {
                state.recentMembers.remove(entry.getKey());
            }
        }
    }

    private int countUniqueLocalUsers(LocalRoomState state) {
        Set<String> ids = new HashSet<>();
        for (LocalMemberState member : state.members.values()) {
            ids.add(member.userId);
        }
        return ids.size();
    }

    private void writeActiveCount(String code, int activeCount) {
        redisTemplate.opsForValue().set(roomCountKey(code), Integer.toString(Math.max(0, activeCount)), roomStateTtl);
    }

    private boolean vacancyExpired(String code) {
        Object rawVacantSince = redisTemplate.opsForHash().get(roomMetaKey(code), "vacantSince");
        if (rawVacantSince == null) {
            return false;
        }
        try {
            return OffsetDateTime.parse(rawVacantSince.toString()).plus(emptyRoomGrace).isBefore(OffsetDateTime.now());
        } catch (RuntimeException ex) {
            return false;
        }
    }

    private boolean localVacancyExpired(LocalRoomState state) {
        return state.vacantSince != null && state.vacantSince.plus(emptyRoomGrace).isBefore(OffsetDateTime.now());
    }

    private boolean isExpired(long now, long lastSeen) {
        return now - lastSeen > MEMBER_STALE_TTL.toMillis();
    }

    private String encodePresence(String userId, String displayName, String color, long lastSeen) {
        return encodeField(userId) + "|" + encodeField(displayName) + "|" + encodeField(color) + "|" + lastSeen;
    }

    private MemberPresence decodePresence(String raw, String fallbackId) {
        String[] encodedParts = raw.split("\\|", 4);
        if (encodedParts.length == 4) {
            return new MemberPresence(
                    decodeField(encodedParts[0], fallbackId),
                    decodeField(encodedParts[1], fallbackId),
                    decodeField(encodedParts[2], DEFAULT_COLOR),
                    parseLong(encodedParts[3], System.currentTimeMillis())
            );
        }

        String[] legacyParts = raw.split("\\|", 2);
        if (legacyParts.length == 2) {
            return new MemberPresence(
                    fallbackId,
                    fallbackId,
                    legacyParts[0],
                    parseLong(legacyParts[1], System.currentTimeMillis())
            );
        }

        return new MemberPresence(fallbackId, fallbackId, raw, System.currentTimeMillis());
    }

    private String encodeField(String value) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString((value == null ? "" : value).getBytes(StandardCharsets.UTF_8));
    }

    private String decodeField(String value, String fallback) {
        try {
            return new String(Base64.getUrlDecoder().decode(value), StandardCharsets.UTF_8);
        } catch (RuntimeException ex) {
            return fallback;
        }
    }

    private long parseLong(String value, long fallback) {
        try {
            return Long.parseLong(value);
        } catch (NumberFormatException ex) {
            return fallback;
        }
    }

    private Set<String> findKnownRoomCodes() {
        Set<String> codes = new HashSet<>();
        Set<String> keys = redisTemplate.keys(prefixedKey("room:*:count"));
        if (keys == null) {
            return codes;
        }

        String prefix = prefixedKey("room:");
        for (String key : keys) {
            if (key != null && key.startsWith(prefix) && key.endsWith(":count")) {
                codes.add(key.substring(prefix.length(), key.length() - 6));
            }
        }
        return codes;
    }

    private void expireRoomKeys(String code) {
        redisTemplate.expire(roomMetaKey(code), roomStateTtl);
        redisTemplate.expire(roomMembersKey(code), roomStateTtl);
        redisTemplate.expire(roomRecentMembersKey(code), roomStateTtl);
        redisTemplate.expire(roomAnnotationsKey(code), roomStateTtl);
        redisTemplate.expire(roomColorCursorKey(code), roomStateTtl);
    }

    private int randomIndex(int upperBound) {
        return new java.security.SecureRandom().nextInt(upperBound);
    }

    private String roomMetaKey(String code) {
        return prefixedKey("room:" + code);
    }

    private String roomCountKey(String code) {
        return prefixedKey("room:" + code + ":count");
    }

    private String roomMembersKey(String code) {
        return prefixedKey("room:" + code + ":members");
    }

    private String roomRecentMembersKey(String code) {
        return prefixedKey("room:" + code + ":recent-members");
    }

    private String roomAnnotationsKey(String code) {
        return prefixedKey("room:" + code + ":annotations");
    }

    private String roomColorCursorKey(String code) {
        return prefixedKey("room:" + code + ":color-cursor");
    }

    private String prefixedKey(String key) {
        return keyPrefix + ":" + key;
    }

    private String normalizeKeyPrefix(String rawPrefix) {
        String normalized = rawPrefix == null ? "" : rawPrefix.trim().replaceAll("^:+|:+$", "");
        return normalized.isBlank() ? "pearprogram" : normalized;
    }

    private RedisEndpoint redisEndpoint() {
        if (!redisUrl.isBlank()) {
            try {
                URI uri = URI.create(redisUrl);
                String host = uri.getHost() == null ? "" : uri.getHost();
                String port = uri.getPort() > 0 ? Integer.toString(uri.getPort()) : "6379";
                boolean sslEnabled = "rediss".equalsIgnoreCase(uri.getScheme());
                return new RedisEndpoint(host, port, sslEnabled);
            } catch (RuntimeException ignored) {
                return new RedisEndpoint("", "", redisSslEnabled);
            }
        }
        return new RedisEndpoint(redisHost, redisPort, redisSslEnabled);
    }

    private String rootCauseMessage(RuntimeException ex) {
        Throwable current = ex;
        while (current.getCause() != null) {
            current = current.getCause();
        }
        String message = current.getMessage();
        return message == null || message.isBlank() ? current.getClass().getSimpleName() : message;
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
                log.warn("Redis unavailable; switching room state to in-memory fallback. Existing Redis-backed rooms may not be visible from this instance, and production room joins may break across instances or after restarts. {}",
                        rootCauseMessage(ex));
            }
        }

        return localAction.get();
    }

    public record ActiveMember(String userId, String displayName, String cursorColor) {
    }

    private record RedisEndpoint(String host, String port, boolean sslEnabled) {
        boolean hostPresent() {
            return host != null && !host.isBlank();
        }

        boolean portPresent() {
            return port != null && !port.isBlank();
        }

        String safeHost() {
            return hostPresent() ? host : "<missing>";
        }

        String safePort() {
            return portPresent() ? port : "<missing>";
        }
    }

    private static final class LocalRoomState {
        private final Map<String, LocalMemberState> members = new ConcurrentHashMap<>();
        private final Map<String, Long> recentMembers = new ConcurrentHashMap<>();
        private final Map<String, String> annotations = new ConcurrentHashMap<>();
        private final AtomicInteger memberCount = new AtomicInteger(0);
        private final AtomicInteger colorCursor = new AtomicInteger(0);
        private volatile OffsetDateTime createdAt;
        private volatile OffsetDateTime vacantSince;
        private volatile boolean active;
        private volatile boolean locked;
        private volatile String leadUserId;
    }

    private static final class LocalMemberState {
        private final String userId;
        private final String displayName;
        private final String cursorColor;
        private final long lastSeen;

        private LocalMemberState(String userId, String displayName, String cursorColor, long lastSeen) {
            this.userId = userId;
            this.displayName = displayName;
            this.cursorColor = cursorColor;
            this.lastSeen = lastSeen;
        }
    }

    private record MemberPresence(String userId, String displayName, String cursorColor, long lastSeen) {
    }
}
