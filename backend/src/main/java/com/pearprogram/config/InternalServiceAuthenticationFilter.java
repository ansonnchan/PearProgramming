package com.pearprogram.config;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.MediaType;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

public class InternalServiceAuthenticationFilter extends OncePerRequestFilter {
    static final String TOKEN_HEADER = "X-Pear-Internal-Token";

    private final String configuredToken;

    public InternalServiceAuthenticationFilter(String configuredToken) {
        this.configuredToken = configuredToken == null ? "" : configuredToken.trim();
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return !request.getRequestURI().startsWith("/internal/");
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
            throws ServletException, IOException {
        if (isAuthorized(request)) {
            filterChain.doFilter(request, response);
            return;
        }

        response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.getWriter().write("{\"error\":\"internal_authentication_required\",\"message\":\"Internal service authentication failed\"}");
    }

    private boolean isAuthorized(HttpServletRequest request) {
        if (configuredToken.isEmpty()) {
            return isLoopback(request.getRemoteAddr());
        }
        String supplied = request.getHeader(TOKEN_HEADER);
        return supplied != null && MessageDigest.isEqual(
                configuredToken.getBytes(StandardCharsets.UTF_8),
                supplied.getBytes(StandardCharsets.UTF_8)
        );
    }

    private boolean isLoopback(String address) {
        return "127.0.0.1".equals(address)
                || "::1".equals(address)
                || "0:0:0:0:0:0:0:1".equals(address);
    }
}
