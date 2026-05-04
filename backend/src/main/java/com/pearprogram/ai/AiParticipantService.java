package com.pearprogram.ai;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

@Service
public class AiParticipantService {
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

    public AiParticipantService(
            @Value("${GROQ_API_KEY:}") String groqApiKey,
            @Value("${pearprogram.ai.placeholder-mode:true}") boolean placeholderMode
    ) {
        this.groqApiKey = groqApiKey;
        this.placeholderMode = placeholderMode;
    }

    public boolean isConfigured() {
        return groqApiKey != null && !groqApiKey.isBlank();
    }

    public String chatResponse(String displayName, String currentFile) {
        if (placeholderMode || !isConfigured()) {
            String user = displayName == null || displayName.isBlank() ? "your teammate" : displayName;
            String file = currentFile == null || currentFile.isBlank() ? "the active file" : currentFile;
            return "Placeholder AI: " + user + ", I can see the room context for " + file
                    + ". I would check changed lines, cursor positions, and recent chat before suggesting a concise next step.";
        }
        return "AI is unavailable, try again";
    }
}
