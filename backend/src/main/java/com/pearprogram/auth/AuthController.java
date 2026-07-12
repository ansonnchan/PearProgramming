package com.pearprogram.auth;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/auth")
public class AuthController {
    private final GuestIdentityService identities;

    public AuthController(GuestIdentityService identities) {
        this.identities = identities;
    }

    @GetMapping("/csrf")
    public CsrfResponse csrf(CsrfToken token) {
        return new CsrfResponse(token.getToken(), token.getHeaderName());
    }

    @PostMapping("/guest")
    @ResponseStatus(HttpStatus.CREATED)
    public AuthSessionResponse signIn(@Valid @RequestBody GuestSignInRequest request,
                                      Authentication authentication,
                                      HttpServletRequest httpRequest, HttpServletResponse response) {
        return identities.signIn(request, authentication, httpRequest, response);
    }

    @GetMapping("/session")
    public AuthSessionResponse session(Authentication authentication) {
        return identities.current(authentication);
    }

    @PatchMapping("/profile")
    public AuthSessionResponse updateProfile(@Valid @RequestBody UpdateProfileRequest request,
                                             Authentication authentication,
                                             HttpServletRequest httpRequest,
                                             HttpServletResponse response) {
        return identities.update(request, authentication, httpRequest, response);
    }

    @PostMapping("/logout")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void logout(Authentication authentication, HttpServletRequest request, HttpServletResponse response) {
        identities.logout(authentication, request, response);
    }
}
