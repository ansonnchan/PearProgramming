package com.pearprogram.files;

import jakarta.validation.constraints.NotBlank;

public record CreateFileRequest(
        @NotBlank String path,
        String language,
        String content
) {
}
