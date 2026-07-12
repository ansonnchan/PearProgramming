package com.pearprogram.execution;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class ExecutionLanguageRegistryTests {
    private final ExecutionLanguageRegistry registry = new ExecutionLanguageRegistry();

    @Test
    void mapsOnlySupportedApplicationLanguagesToJudge0Ids() {
        assertThat(registry.judge0Id("java")).hasValue(62);
        assertThat(registry.judge0Id("python")).hasValue(71);
        assertThat(registry.judge0Id("javascript")).hasValue(63);
        assertThat(registry.judge0Id("nodejs")).hasValue(63);
        assertThat(registry.judge0Id("c")).hasValue(50);
        assertThat(registry.judge0Id("C++")).hasValue(54);
        assertThat(registry.judge0Id("ruby")).isEmpty();
    }
}
