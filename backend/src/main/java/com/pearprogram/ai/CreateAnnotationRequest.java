package com.pearprogram.ai;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import java.util.UUID;

public record CreateAnnotationRequest(
        @NotNull UUID fileId,
        @Min(1) int line,
        @NotBlank String content
) {
}
