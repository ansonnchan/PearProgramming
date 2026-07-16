package com.pearprogram.execution;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class ExecutionLanguageControllerTests {
    @Test
    void returnsTheRegistryCatalog() {
        ExecutionLanguageRegistry registry = new ExecutionLanguageRegistry();
        ExecutionLanguageController controller = new ExecutionLanguageController(registry);

        assertThat(controller.list()).isEqualTo(registry.options());
    }
}
