package com.pearprogram.auth;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record GuestSignInRequest(
        @NotBlank @Size(max = 60) String displayName,
        @Size(max = 500_000) String avatarUrl
) {
}
