package com.pearprogram.auth;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpSession;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.authentication.logout.SecurityContextLogoutHandler;
import org.springframework.security.web.context.SecurityContextRepository;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.UUID;

@Service
public class GuestIdentityService {
    private final SecurityContextRepository contextRepository;
    private final RealtimeAccessTokenService realtimeTokens;
    private final UserService users;

    public GuestIdentityService(SecurityContextRepository contextRepository, RealtimeAccessTokenService realtimeTokens,
                                UserService users) {
        this.contextRepository = contextRepository;
        this.realtimeTokens = realtimeTokens;
        this.users = users;
    }

    public AuthSessionResponse signIn(GuestSignInRequest request, Authentication currentAuthentication,
                                      HttpServletRequest httpRequest, HttpServletResponse response) {
        if (currentAuthentication != null && currentAuthentication.getPrincipal() instanceof GuestPrincipal principal) {
            realtimeTokens.revokeUser(principal.id());
        }
        HttpSession existing = httpRequest.getSession(false);
        if (existing != null) {
            existing.invalidate();
        }
        httpRequest.getSession(true);
        GuestPrincipal principal = new GuestPrincipal(
                UUID.randomUUID(),
                request.displayName().trim(),
                normalizeAvatar(request.avatarUrl())
        );
        users.createGuest(principal.userId(), principal.displayName(), principal.avatarUrl());
        saveAuthentication(principal, httpRequest, response);
        return response(principal);
    }

    public AuthSessionResponse current(Authentication authentication) {
        return response(requirePrincipal(authentication));
    }

    public AuthSessionResponse update(UpdateProfileRequest request, Authentication authentication,
                                      HttpServletRequest httpRequest, HttpServletResponse response) {
        GuestPrincipal current = requirePrincipal(authentication);
        GuestPrincipal updated = new GuestPrincipal(
                current.userId(),
                request.displayName().trim(),
                normalizeAvatar(request.avatarUrl())
        );
        users.updateProfile(updated.userId(), updated.displayName(), updated.avatarUrl());
        realtimeTokens.revokeUser(current.id());
        saveAuthentication(updated, httpRequest, response);
        return response(updated);
    }

    public void logout(Authentication authentication, HttpServletRequest request, HttpServletResponse response) {
        if (authentication != null && authentication.getPrincipal() instanceof GuestPrincipal principal) {
            realtimeTokens.revokeUser(principal.id());
        }
        new SecurityContextLogoutHandler().logout(request, response, authentication);
    }

    public GuestPrincipal requirePrincipal(Authentication authentication) {
        if (authentication == null || !(authentication.getPrincipal() instanceof GuestPrincipal principal)) {
            throw new IllegalStateException("Authenticated guest principal is required");
        }
        return principal;
    }

    private void saveAuthentication(GuestPrincipal principal, HttpServletRequest request, HttpServletResponse response) {
        UsernamePasswordAuthenticationToken authentication = UsernamePasswordAuthenticationToken.authenticated(
                principal,
                null,
                List.of(new SimpleGrantedAuthority("ROLE_USER"))
        );
        SecurityContext context = SecurityContextHolder.createEmptyContext();
        context.setAuthentication(authentication);
        SecurityContextHolder.setContext(context);
        contextRepository.saveContext(context, request, response);
    }

    private AuthSessionResponse response(GuestPrincipal principal) {
        RealtimeAccessTokenService.IssuedToken realtimeToken = realtimeTokens.issue(principal);
        return new AuthSessionResponse(
                principal.userId(),
                principal.displayName(),
                principal.avatarUrl(),
                realtimeToken.value(),
                realtimeToken.expiresAt()
        );
    }

    private String normalizeAvatar(String avatarUrl) {
        return avatarUrl == null || avatarUrl.isBlank() ? null : avatarUrl.trim();
    }
}
