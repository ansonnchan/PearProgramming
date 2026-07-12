package com.pearprogram.config;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import static org.assertj.core.api.Assertions.assertThat;

class InternalServiceAuthenticationFilterTests {
    @Test
    void rejectsNonLoopbackTrafficWithoutTheConfiguredSecret() throws Exception {
        InternalServiceAuthenticationFilter filter = new InternalServiceAuthenticationFilter("expected-secret");
        MockHttpServletRequest request = internalRequest("10.0.0.12");
        request.addHeader(InternalServiceAuthenticationFilter.TOKEN_HEADER, "wrong-secret");
        MockHttpServletResponse response = new MockHttpServletResponse();

        filter.doFilter(request, response, new MockFilterChain());

        assertThat(response.getStatus()).isEqualTo(401);
        assertThat(response.getContentAsString()).doesNotContain("expected-secret");
    }

    @Test
    void acceptsTheSharedSecretAndAllowsLoopbackOnlyWhenUnconfigured() throws Exception {
        MockHttpServletRequest authenticatedRequest = internalRequest("10.0.0.12");
        authenticatedRequest.addHeader(InternalServiceAuthenticationFilter.TOKEN_HEADER, "expected-secret");
        MockHttpServletResponse authenticatedResponse = new MockHttpServletResponse();
        new InternalServiceAuthenticationFilter("expected-secret")
                .doFilter(authenticatedRequest, authenticatedResponse, new MockFilterChain());
        assertThat(authenticatedResponse.getStatus()).isEqualTo(200);

        MockHttpServletResponse loopbackResponse = new MockHttpServletResponse();
        new InternalServiceAuthenticationFilter("")
                .doFilter(internalRequest("127.0.0.1"), loopbackResponse, new MockFilterChain());
        assertThat(loopbackResponse.getStatus()).isEqualTo(200);

        MockHttpServletResponse remoteResponse = new MockHttpServletResponse();
        new InternalServiceAuthenticationFilter("")
                .doFilter(internalRequest("10.0.0.12"), remoteResponse, new MockFilterChain());
        assertThat(remoteResponse.getStatus()).isEqualTo(401);
    }

    private MockHttpServletRequest internalRequest(String remoteAddress) {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/internal/auth/realtime/validate");
        request.setRemoteAddr(remoteAddress);
        return request;
    }
}
