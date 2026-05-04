package com.pearprogram.auth;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;

@Service
public class JwtService {
    private final SecretKey key;

    public JwtService(@Value("${pearprogram.jwt.secret}") String secret) {
        byte[] bytes = secret.getBytes(StandardCharsets.UTF_8);
        if (bytes.length < 32) {
            throw new IllegalArgumentException("JWT_SECRET must be at least 32 bytes for HS256");
        }
        this.key = Keys.hmacShaKeyFor(bytes);
    }

    public TokenValidationResponse validateBearerToken(String authorization) {
        if (authorization == null || !authorization.startsWith("Bearer ")) {
            return TokenValidationResponse.invalid();
        }

        try {
            String token = authorization.substring("Bearer ".length()).trim();
            Claims claims = Jwts.parser()
                    .verifyWith(key)
                    .build()
                    .parseSignedClaims(token)
                    .getPayload();
            return new TokenValidationResponse(true, claims.getSubject(), claims.get("name", String.class));
        } catch (RuntimeException ex) {
            return TokenValidationResponse.invalid();
        }
    }
}
