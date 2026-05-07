package com.pearprogram.rooms;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.notNullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

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
        String code = mockMvc.perform(post("/api/rooms/create")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"sessionId":"creator-session","displayName":"Creator"}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code", notNullValue()))
                .andExpect(jsonPath("$.memberCount", equalTo(1)))
                .andReturn()
                .getResponse()
                .getContentAsString()
                .replaceAll(".*\"code\"\\s*:\\s*\"([^\"]+)\".*", "$1");

        mockMvc.perform(get("/api/rooms/{code}", code))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code", equalTo(code)))
                .andExpect(jsonPath("$.leadUserId", equalTo("creator-session")))
                .andExpect(jsonPath("$.memberCount", equalTo(1)));

        mockMvc.perform(post("/api/rooms/join")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"code":"%s","sessionId":"joiner-session","displayName":"Joiner"}
                                """.formatted(code)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code", equalTo(code)))
                .andExpect(jsonPath("$.memberCount", equalTo(2)));

        mockMvc.perform(get("/api/rooms/{code}", code))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.leadUserId", equalTo("creator-session")))
                .andExpect(jsonPath("$.memberCount", equalTo(2)));
    }

    @Test
    void joiningInvalidCodeDoesNotCreateRoom() throws Exception {
        mockMvc.perform(post("/api/rooms/join")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"code":"000000","sessionId":"joiner-session","displayName":"Joiner"}
                                """))
                .andExpect(status().isNotFound());

        mockMvc.perform(get("/api/rooms/{code}", "000000"))
                .andExpect(status().isNotFound());
    }
}
