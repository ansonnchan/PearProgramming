package com.pearprogram.auth;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.http.HttpHeaders;
import org.springframework.test.context.ActiveProfiles;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "spring.data.redis.host=127.0.0.1",
        "spring.data.redis.port=1",
        "spring.data.redis.timeout=100ms",
        "pearprogram.realtime.redis-broadcast-enabled=false",
        "server.servlet.session.cookie.secure=true",
        "server.servlet.session.cookie.same-site=none"
})
@ActiveProfiles("test")
class CsrfCookieConfigurationTests {
    @Autowired private TestRestTemplate rest;

    @Test
    void configuresCsrfCookieForCrossSiteFrontend() {
        String setCookie = rest.getForEntity("/api/auth/csrf", String.class)
                .getHeaders()
                .getFirst(HttpHeaders.SET_COOKIE);

        assertThat(setCookie)
                .contains("XSRF-TOKEN=")
                .contains("Path=/")
                .contains("Secure")
                .containsIgnoringCase("SameSite=None");
    }
}
