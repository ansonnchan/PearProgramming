package com.pearprogram.rooms;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.mock.web.MockHttpSession;

import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.notNullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;

@SpringBootTest(properties = {
        "spring.data.redis.host=127.0.0.1",
        "spring.data.redis.port=1",
        "spring.data.redis.timeout=100ms"
})
@AutoConfigureMockMvc
class RoomFlowTests {
    @Autowired
    private MockMvc mockMvc;

    @Test
    void createAssignsCreatorLeadAndJoinKeepsSameRoom() throws Exception {
        MockHttpSession creatorSession = signIn("Creator");
        String code = mockMvc.perform(post("/api/rooms/create")
                        .session(creatorSession)
                        .with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code", notNullValue()))
                .andExpect(jsonPath("$.memberCount", equalTo(1)))
                .andReturn()
                .getResponse()
                .getContentAsString()
                .replaceAll(".*\"code\"\\s*:\\s*\"([^\"]+)\".*", "$1");

        String creatorId = authenticatedUserId(creatorSession);
        mockMvc.perform(get("/api/rooms/{code}", code).session(creatorSession))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code", equalTo(code)))
                .andExpect(jsonPath("$.leadUserId", equalTo(creatorId)))
                .andExpect(jsonPath("$.memberCount", equalTo(1)));

        MockHttpSession joinerSession = signIn("Joiner");
        mockMvc.perform(post("/api/rooms/join")
                        .session(joinerSession)
                        .with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"code\":\"%s\"}".formatted(code)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code", equalTo(code)))
                .andExpect(jsonPath("$.memberCount", equalTo(2)));

        mockMvc.perform(get("/api/rooms/{code}", code).session(creatorSession))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.leadUserId", equalTo(creatorId)))
                .andExpect(jsonPath("$.memberCount", equalTo(2)));
    }

    @Test
    void joiningInvalidCodeDoesNotCreateRoom() throws Exception {
        MockHttpSession session = signIn("Joiner");
        mockMvc.perform(post("/api/rooms/join")
                        .session(session)
                        .with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"code\":\"000000\"}"))
                .andExpect(status().isNotFound());

        mockMvc.perform(get("/api/rooms/{code}", "000000").session(session))
                .andExpect(status().isNotFound());
    }

    private MockHttpSession signIn(String displayName) throws Exception {
        return (MockHttpSession) mockMvc.perform(post("/api/auth/guest")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"displayName\":\"%s\"}".formatted(displayName)))
                .andExpect(status().isCreated())
                .andReturn()
                .getRequest()
                .getSession(false);
    }

    private String authenticatedUserId(MockHttpSession session) {
        Object context = session.getAttribute("SPRING_SECURITY_CONTEXT");
        org.springframework.security.core.context.SecurityContext securityContext =
                (org.springframework.security.core.context.SecurityContext) context;
        com.pearprogram.auth.GuestPrincipal principal =
                (com.pearprogram.auth.GuestPrincipal) securityContext.getAuthentication().getPrincipal();
        return principal.id();
    }
}
