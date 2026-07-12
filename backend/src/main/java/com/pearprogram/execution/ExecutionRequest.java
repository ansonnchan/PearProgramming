package com.pearprogram.execution;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

public record ExecutionRequest(
        @NotBlank String language,
        @NotNull String sourceCode,
        String stdin
) {
}
