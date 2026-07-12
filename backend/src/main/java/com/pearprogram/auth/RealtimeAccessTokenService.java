package com.pearprogram.auth;

import com.pearprogram.rooms.EphemeralRoomStateService;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Base64;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class RealtimeAccessTokenService {
    private final Map<String, TokenRecord> tokens = new ConcurrentHashMap<>();
    private final SecureRandom secureRandom = new SecureRandom();
    private final Duration ttl;
    private final EphemeralRoomStateService roomStateService;

    public RealtimeAccessTokenService(
            EphemeralRoomStateService roomStateService,
            @Value("${pearprogram.auth.realtime-token-ttl:10m}") Duration ttl
    ) {
        this.roomStateService = roomStateService;
        this.ttl = ttl.isNegative() || ttl.isZero() ? Duration.ofMinutes(10) : ttl;
    }

    public IssuedToken issue(GuestPrincipal principal) {
        byte[] bytes = new byte[32];
        secureRandom.nextBytes(bytes);
        String value = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        Instant expiresAt = Instant.now().plus(ttl);
        tokens.put(value, new TokenRecord(principal.id(), expiresAt));
        return new IssuedToken(value, OffsetDateTime.ofInstant(expiresAt, ZoneOffset.UTC));
    }

    public RealtimeTokenValidationResponse validate(String token, String roomCode) {
        if (token == null || token.isBlank() || roomCode == null || roomCode.isBlank()) {
            return new RealtimeTokenValidationResponse(false, null);
        }
        TokenRecord record = tokens.get(token);
        if (record == null || record.expiresAt().isBefore(Instant.now())) {
            if (record != null) {
                tokens.remove(token, record);
            }
            return new RealtimeTokenValidationResponse(false, null);
        }
        boolean member = roomStateService.isActiveMember(normalizeRoomCode(roomCode), record.userId());
        return new RealtimeTokenValidationResponse(member, member ? record.userId() : null);
    }

    public void revokeUser(String userId) {
        tokens.entrySet().removeIf(entry -> entry.getValue().userId().equals(userId));
    }

    @Scheduled(fixedDelay = 60_000)
    void removeExpiredTokens() {
        Instant now = Instant.now();
        tokens.entrySet().removeIf(entry -> entry.getValue().expiresAt().isBefore(now));
    }

    private String normalizeRoomCode(String raw) {
        return raw.trim().replaceAll("[\\s-]+", "").toUpperCase();
    }

    public record IssuedToken(String value, OffsetDateTime expiresAt) {}
    private record TokenRecord(String userId, Instant expiresAt) {}
}
