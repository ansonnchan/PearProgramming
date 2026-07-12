package com.pearprogram.auth;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/internal/auth/realtime")
public class InternalRealtimeAuthController {
    private final RealtimeAccessTokenService tokens;

    public InternalRealtimeAuthController(RealtimeAccessTokenService tokens) {
        this.tokens = tokens;
    }

    @GetMapping("/validate")
    public RealtimeTokenValidationResponse validate(
            @RequestParam String token,
            @RequestParam String roomCode
    ) {
        return tokens.validate(token, roomCode);
    }
}
