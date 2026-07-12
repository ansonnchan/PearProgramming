package com.pearprogram.execution;

import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.OptionalInt;
import java.util.Set;

@Component
public class ExecutionLanguageRegistry {
    private static final Map<String, Integer> JUDGE0_LANGUAGE_IDS = Map.of(
            "c", 50,
            "cpp", 54,
            "java", 62,
            "javascript", 63,
            "python", 71
    );
    private static final Map<String, String> ALIASES = Map.of(
            "c++", "cpp",
            "node", "javascript",
            "nodejs", "javascript",
            "py", "python"
    );

    public String normalize(String language) {
        String normalized = language == null ? "" : language.trim().toLowerCase(Locale.ROOT);
        return ALIASES.getOrDefault(normalized, normalized);
    }

    public OptionalInt judge0Id(String language) {
        Integer id = JUDGE0_LANGUAGE_IDS.get(normalize(language));
        return id == null ? OptionalInt.empty() : OptionalInt.of(id);
    }

    public Set<String> supportedLanguages() {
        return new LinkedHashMap<>(JUDGE0_LANGUAGE_IDS).keySet();
    }
}
