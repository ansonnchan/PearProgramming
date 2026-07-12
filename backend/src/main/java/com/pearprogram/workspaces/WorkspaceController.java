package com.pearprogram.workspaces;

import com.pearprogram.auth.GuestIdentityService;
import jakarta.validation.Valid;
import org.springframework.security.core.Authentication;
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
    private final GuestIdentityService identities;

    public WorkspaceController(WorkspaceService workspaceService, GuestIdentityService identities) {
        this.workspaceService = workspaceService;
        this.identities = identities;
    }

    @PostMapping
    public WorkspaceDto create(@Valid @RequestBody CreateWorkspaceRequest request, Authentication authentication) {
        return workspaceService.createWorkspace(request.name(), identities.requirePrincipal(authentication).id());
    }

    @GetMapping("/{workspaceId}")
    public WorkspaceDto get(@PathVariable UUID workspaceId, Authentication authentication) {
        return workspaceService.getWorkspace(workspaceId, identities.requirePrincipal(authentication).id());
    }
}
