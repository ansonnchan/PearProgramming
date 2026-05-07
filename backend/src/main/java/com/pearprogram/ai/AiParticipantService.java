package com.pearprogram.ai;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

import java.time.Duration;
import java.util.List;
import java.util.Map;

@Service
public class AiParticipantService {
    private static final Logger log = LoggerFactory.getLogger(AiParticipantService.class);

    public static final String SYSTEM_PROMPT = """
            You are AI, a collaborative coding assistant inside PearProgram.
             You are a room participant alongside human developers. You can see
             who is editing what in real time. Keep responses concise (<=3
             sentences for chat, <=2 sentences for inline annotations). Always
             reference the specific user and line when relevant. Never repeat
             a suggestion already in existingAnnotationIds.
            """;

    private final String groqApiKey;
    private final boolean placeholderMode;
    private final String model;
    private final int maxCompletionTokens;
    private final double temperature;
    private final RestClient restClient;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public AiParticipantService(
            @Value("${GROQ_API_KEY:}") String groqApiKey,
            @Value("${pearprogram.ai.placeholder-mode:false}") boolean placeholderMode,
            @Value("${GROQ_BASE_URL:https://api.groq.com/openai/v1}") String groqBaseUrl,
            @Value("${GROQ_MODEL:llama-3.3-70b-versatile}") String model,
            @Value("${GROQ_MAX_COMPLETION_TOKENS:220}") int maxCompletionTokens,
            @Value("${GROQ_TEMPERATURE:0.3}") double temperature
    ) {
        this.groqApiKey = groqApiKey;
        this.placeholderMode = placeholderMode;
        this.model = model;
        this.maxCompletionTokens = maxCompletionTokens;
        this.temperature = temperature;

        SimpleClientHttpRequestFactory requestFactory = new SimpleClientHttpRequestFactory();
        requestFactory.setConnectTimeout(Duration.ofSeconds(5));
        requestFactory.setReadTimeout(Duration.ofSeconds(20));
        this.restClient = RestClient.builder()
                .baseUrl(trimTrailingSlash(groqBaseUrl))
                .requestFactory(requestFactory)
                .defaultHeader(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE)
                .build();
    }

    public boolean isConfigured() {
        return groqApiKey != null && !groqApiKey.isBlank();
    }

    public boolean usesPlaceholderResponses() {
        return placeholderMode && !isConfigured();
    }

    public String chatResponse(String displayName, String currentFile) {
        return chatResponse(displayName, currentFile, null, null, null);
    }

    public String chatResponse(String displayName, String currentFile, String userMessage, Integer currentLine) {
        return chatResponse(displayName, currentFile, userMessage, currentLine, null);
    }

    public String chatResponse(String displayName, String currentFile, String userMessage, Integer currentLine, String currentFileContent) {
        if (usesPlaceholderResponses()) {
            String user = displayName == null || displayName.isBlank() ? "your teammate" : displayName;
            String file = currentFile == null || currentFile.isBlank() ? "the active file" : currentFile;
            return "Placeholder AI: " + user + ", I can see the room context for " + file
                    + ". I would check changed lines, cursor positions, and recent chat before suggesting a concise next step.";
        }
        if (!isConfigured()) {
            return "PearAI is not configured. Set GROQ_API_KEY on the backend, or enable PEARPROGRAM_AI_PLACEHOLDER=true for local demo responses.";
        }

        try {
            String response = callGroq(displayName, currentFile, userMessage, currentLine, currentFileContent);
            if (response == null || response.isBlank()) {
                return "PearAI could not produce a response. Try asking again with a little more context.";
            }
            return response.trim();
        } catch (RestClientException | JsonProcessingException ex) {
            log.warn("Groq chat completion failed: {}", ex.getMessage());
            return "PearAI is having trouble reaching Groq right now. Try again in a moment.";
        }
    }

    private String callGroq(String displayName, String currentFile, String userMessage, Integer currentLine, String currentFileContent) throws JsonProcessingException {
        Map<String, Object> request = Map.of(
                "model", model,
                "temperature", temperature,
                "max_completion_tokens", maxCompletionTokens,
                "messages", List.of(
                        Map.of("role", "system", "content", SYSTEM_PROMPT),
                        Map.of("role", "user", "content", buildUserPrompt(displayName, currentFile, userMessage, currentLine, currentFileContent))
                )
        );

        String body = restClient.post()
                .uri("/chat/completions")
                .header(HttpHeaders.AUTHORIZATION, "Bearer " + groqApiKey)
                .body(request)
                .retrieve()
                .body(String.class);

        JsonNode root = objectMapper.readTree(body == null ? "{}" : body);
        return root.path("choices").path(0).path("message").path("content").asText("");
    }

    private String buildUserPrompt(String displayName, String currentFile, String userMessage, Integer currentLine, String currentFileContent) {
        String user = displayName == null || displayName.isBlank() ? "A teammate" : displayName;
        String file = currentFile == null || currentFile.isBlank() ? "No file selected" : currentFile;
        String line = currentLine == null || currentLine < 1 ? "Unknown" : currentLine.toString();
        String message = userMessage == null || userMessage.isBlank()
                ? "The user mentioned @AI without additional details."
                : userMessage.replaceAll("(?i)@ai\\b", "").trim();
        if (message.isBlank()) {
            message = "The user mentioned @AI without additional details.";
        }
        String codeContext = trimCodeContext(currentFileContent);

        return """
                User: %s
                Current file: %s
                Cursor line: %s
                Visible active file code:
                ```text
                %s
                ```

                User chat message:
                %s

                Respond as PearAI in the room chat. Be concise, practical, and specific to the visible context.
                If you need more code context before making a confident suggestion, ask one short follow-up question.
                """.formatted(user, file, line, codeContext, message);
    }

    private String trimCodeContext(String currentFileContent) {
        if (currentFileContent == null || currentFileContent.isBlank()) {
            return "No code content was provided.";
        }
        String normalized = currentFileContent.strip();
        int maxChars = 12_000;
        if (normalized.length() <= maxChars) {
            return normalized;
        }
        return normalized.substring(0, maxChars) + "\n...[truncated]";
    }

    private String trimTrailingSlash(String value) {
        if (value == null || value.isBlank()) {
            return "https://api.groq.com/openai/v1";
        }
        return value.replaceAll("/+$", "");
    }
}
