package com.pearprogram.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.util.List;

@ConfigurationProperties(prefix = "pearprogram.cors")
public class CorsProperties {
    private List<String> allowedOrigins = List.of("http://localhost:5173", "http://127.0.0.1:5173");

    public List<String> getAllowedOrigins() {
        return allowedOrigins;
    }

    public void setAllowedOrigins(List<String> allowedOrigins) {
        this.allowedOrigins = allowedOrigins;
    }
}
