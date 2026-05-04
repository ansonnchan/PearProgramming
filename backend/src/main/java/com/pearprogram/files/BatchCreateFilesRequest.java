package com.pearprogram.files;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotEmpty;

import java.util.List;

public record BatchCreateFilesRequest(
        @NotEmpty List<@Valid CreateFileRequest> files,
        boolean replaceExisting
) {
}
