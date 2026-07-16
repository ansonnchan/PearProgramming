package com.pearprogram.execution;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.not;
import static org.hamcrest.Matchers.hasItem;
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
@ActiveProfiles("test")
class ExecutionLanguageFlowTests {
    @Autowired
    private MockMvc mockMvc;

    @Test
    void authenticatedClientsReceiveTheExecutableLanguageCatalog() throws Exception {
        mockMvc.perform(get("/api/execution/languages"))
                .andExpect(status().isUnauthorized());

        MockHttpSession session = (MockHttpSession) mockMvc.perform(post("/api/auth/guest")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"displayName\":\"Language Tester\"}"))
                .andExpect(status().isCreated())
                .andReturn()
                .getRequest()
                .getSession(false);

        mockMvc.perform(get("/api/execution/languages").session(session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(16)))
                .andExpect(jsonPath("$[0].id").value("java"))
                .andExpect(jsonPath("$[*].id", hasItem("rust")))
                .andExpect(jsonPath("$[*].id", not(hasItem("markdown"))));
    }
}
