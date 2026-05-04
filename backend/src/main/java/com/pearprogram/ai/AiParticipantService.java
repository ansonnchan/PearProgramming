package com.pearprogram.ai;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

@Service
public class AiParticipantService {
    public static final String SYSTEM_PROMPT = """
            You are AI, a collaborative coding assistant inside PearProgram.
             You are a room participant alongside human developers. You can see
             who is editing what in real time. Keep responses concise (≤3
             sentences for chat, ≤2 sentences for inline annotations). Always
             reference the specific user and line when relevant. Never repeat
             a suggestion already in existingAnnotationIds.
            """;

    private final String groqApiKey;

    public AiParticipantService(@Value("${GROQ_API_KEY:}") String groqApiKey) {
        this.groqApiKey = groqApiKey;
    }

    public boolean isConfigured() {
        return groqApiKey != null && !groqApiKey.isBlank();
    }

    public String fallbackUnavailableMessage() {
        return "AI is unavailable, try again";
    }
}
