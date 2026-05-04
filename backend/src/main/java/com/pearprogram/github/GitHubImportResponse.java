package com.pearprogram.github;

import com.pearprogram.files.FileDto;

import java.util.List;

public record GitHubImportResponse(String owner, String repo, String branch, List<FileDto> files) {
}
