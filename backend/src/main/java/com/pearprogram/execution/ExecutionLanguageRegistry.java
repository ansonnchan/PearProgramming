package com.pearprogram.execution;

import org.springframework.stereotype.Component;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.OptionalInt;
import java.util.Set;

@Component
public class ExecutionLanguageRegistry {
    private static final List<LanguageDefinition> LANGUAGES = List.of(
            new LanguageDefinition("java", "Java", 62),
            new LanguageDefinition("python", "Python", 71),
            new LanguageDefinition("javascript", "JavaScript", 63),
            new LanguageDefinition("c", "C", 50),
            new LanguageDefinition("cpp", "C++", 54),
            new LanguageDefinition("typescript", "TypeScript", 74),
            new LanguageDefinition("sql", "SQL", 82),
            new LanguageDefinition("csharp", "C#", 51),
            new LanguageDefinition("php", "PHP", 68),
            new LanguageDefinition("ruby", "Ruby", 72),
            new LanguageDefinition("go", "Go", 60),
            new LanguageDefinition("rust", "Rust", 73),
            new LanguageDefinition("kotlin", "Kotlin", 78),
            new LanguageDefinition("swift", "Swift", 83),
            new LanguageDefinition("r", "R", 80),
            new LanguageDefinition("shell", "Shell", 46)
    );
    private static final Map<String, LanguageDefinition> LANGUAGES_BY_ID = indexLanguages();
    private static final Map<String, String> ALIASES = Map.ofEntries(
            Map.entry("bash", "shell"),
            Map.entry("c#", "csharp"),
            Map.entry("c++", "cpp"),
            Map.entry("cs", "csharp"),
            Map.entry("golang", "go"),
            Map.entry("js", "javascript"),
            Map.entry("kt", "kotlin"),
            Map.entry("node", "javascript"),
            Map.entry("nodejs", "javascript"),
            Map.entry("py", "python"),
            Map.entry("rb", "ruby"),
            Map.entry("rs", "rust"),
            Map.entry("sh", "shell"),
            Map.entry("ts", "typescript")
    );

    public String normalize(String language) {
        String normalized = language == null ? "" : language.trim().toLowerCase(Locale.ROOT);
        return ALIASES.getOrDefault(normalized, normalized);
    }

    public OptionalInt judge0Id(String language) {
        LanguageDefinition definition = LANGUAGES_BY_ID.get(normalize(language));
        return definition == null ? OptionalInt.empty() : OptionalInt.of(definition.judge0Id());
    }

    public Set<String> supportedLanguages() {
        return new LinkedHashMap<>(LANGUAGES_BY_ID).keySet();
    }

    public List<ExecutionLanguageOption> options() {
        return LANGUAGES.stream()
                .map(language -> new ExecutionLanguageOption(language.id(), language.label()))
                .toList();
    }

    private static Map<String, LanguageDefinition> indexLanguages() {
        Map<String, LanguageDefinition> indexed = new LinkedHashMap<>();
        LANGUAGES.forEach(language -> indexed.put(language.id(), language));
        return Collections.unmodifiableMap(indexed);
    }

    private record LanguageDefinition(String id, String label, int judge0Id) {}
}
