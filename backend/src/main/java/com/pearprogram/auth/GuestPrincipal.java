package com.pearprogram.auth;

import java.io.Serializable;
import java.util.UUID;

public record GuestPrincipal(UUID userId, String displayName, String avatarUrl) implements Serializable {
    public String id() {
        return userId.toString();
    }
}
