package com.pearprogram.workspaces;

import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

@RestController
@RequestMapping("/api/workspaces")
public class WorkspaceController {
    private final WorkspaceService workspaceService;

    public WorkspaceController(WorkspaceService workspaceService) {
        this.workspaceService = workspaceService;
    }

    @PostMapping
    public WorkspaceDto create(@Valid @RequestBody CreateWorkspaceRequest request) {
        return workspaceService.createWorkspace(request.name());
    }

    @GetMapping("/{workspaceId}")
    public WorkspaceDto get(@PathVariable UUID workspaceId) {
        return workspaceService.getWorkspace(workspaceId);
    }
}
