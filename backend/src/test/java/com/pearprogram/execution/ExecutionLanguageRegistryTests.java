package com.pearprogram.execution;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class ExecutionLanguageRegistryTests {
    private final ExecutionLanguageRegistry registry = new ExecutionLanguageRegistry();

    @Test
    void mapsSupportedApplicationLanguagesAndAliasesToJudge0Ids() {
        assertThat(registry.judge0Id("java")).hasValue(62);
        assertThat(registry.judge0Id("python")).hasValue(71);
        assertThat(registry.judge0Id("javascript")).hasValue(63);
        assertThat(registry.judge0Id("nodejs")).hasValue(63);
        assertThat(registry.judge0Id("c")).hasValue(50);
        assertThat(registry.judge0Id("C++")).hasValue(54);
        assertThat(registry.judge0Id("typescript")).hasValue(74);
        assertThat(registry.judge0Id("sql")).hasValue(82);
        assertThat(registry.judge0Id("C#")).hasValue(51);
        assertThat(registry.judge0Id("php")).hasValue(68);
        assertThat(registry.judge0Id("ruby")).hasValue(72);
        assertThat(registry.judge0Id("golang")).hasValue(60);
        assertThat(registry.judge0Id("rust")).hasValue(73);
        assertThat(registry.judge0Id("kotlin")).hasValue(78);
        assertThat(registry.judge0Id("swift")).hasValue(83);
        assertThat(registry.judge0Id("r")).hasValue(80);
        assertThat(registry.judge0Id("bash")).hasValue(46);
        assertThat(registry.judge0Id("markdown")).isEmpty();
    }

    @Test
    void exposesAStableUniqueCatalogForTheFrontend() {
        List<ExecutionLanguageOption> options = registry.options();

        assertThat(options).extracting(ExecutionLanguageOption::id)
                .containsExactly(
                        "java", "python", "javascript", "c", "cpp", "typescript", "sql", "csharp",
                        "php", "ruby", "go", "rust", "kotlin", "swift", "r", "shell"
                )
                .doesNotHaveDuplicates();
        assertThat(options).extracting(ExecutionLanguageOption::label)
                .contains("JavaScript", "C++", "C#", "Shell");
    }
}
