package com.pearprogram.auth;

public record TokenValidationResponse(boolean valid, String userId, String displayName) {
    public static TokenValidationResponse invalid() {
        return new TokenValidationResponse(false, null, null);
    }
}
