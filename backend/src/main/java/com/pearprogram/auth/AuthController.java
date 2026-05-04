package com.pearprogram.auth;

import org.springframework.http.HttpHeaders;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/auth")
public class AuthController {
    private final JwtService jwtService;

    public AuthController(JwtService jwtService) {
        this.jwtService = jwtService;
    }

    @GetMapping("/validate")
    public TokenValidationResponse validate(@RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization) {
        return jwtService.validateBearerToken(authorization);
    }

    @PostMapping("/dev-token")
    public DevTokenResponse devToken(@RequestBody DevTokenRequest request) {
        return new DevTokenResponse(jwtService.issueDevToken(request.userId(), request.displayName()), "Bearer");
    }
}
