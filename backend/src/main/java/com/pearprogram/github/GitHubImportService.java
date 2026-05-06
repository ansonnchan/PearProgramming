package com.pearprogram.github;

import com.pearprogram.files.FileDto;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Service
public class GitHubImportService {

    public GitHubImportResponse importPlaceholder(UUID workspaceId, GitHubImportRequest request) {
        // GitHub imports are no longer persisted; return placeholder.
        String owner = blankToDefault(request.owner(), "sample-org");
        String repo = blankToDefault(request.repo(), "pearprogram-import");
        String branch = blankToDefault(request.branch(), "main");

        List<FileDto> created = new ArrayList<>();
        return new GitHubImportResponse(owner, repo, branch, created);
    }

    private String blankToDefault(String value, String fallback) {
        return value == null || value.isBlank() ? fallback : value;
    }
}
