package com.pearprogram.health;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.OffsetDateTime;
import java.util.Map;

@RestController
public class HealthzController {
    @GetMapping("/healthz")
    public Map<String, Object> healthz() {
        return Map.of(
                "status", "ok",
                "timestamp", OffsetDateTime.now().toString()
        );
    }
}
