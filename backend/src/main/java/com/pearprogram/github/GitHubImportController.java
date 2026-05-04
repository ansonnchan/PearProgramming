package com.pearprogram.github;

import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

@RestController
@RequestMapping("/api/workspaces/{workspaceId}/github/import")
public class GitHubImportController {
    private final GitHubImportService importService;

    public GitHubImportController(GitHubImportService importService) {
        this.importService = importService;
    }

    @PostMapping
    public GitHubImportResponse importRepository(@PathVariable UUID workspaceId, @RequestBody GitHubImportRequest request) {
        return importService.importPlaceholder(workspaceId, request);
    }
}
