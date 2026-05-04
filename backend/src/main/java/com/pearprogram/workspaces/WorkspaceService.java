package com.pearprogram.workspaces;

import jakarta.transaction.Transactional;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.util.UUID;

@Service
public class WorkspaceService {
    private final WorkspaceRepository workspaceRepository;

    public WorkspaceService(WorkspaceRepository workspaceRepository) {
        this.workspaceRepository = workspaceRepository;
    }

    @Transactional
    public WorkspaceDto createWorkspace(String name) {
        Workspace workspace = new Workspace();
        workspace.setName(name);
        Workspace saved = workspaceRepository.save(workspace);
        return WorkspaceDto.from(saved);
    }

    public WorkspaceDto getWorkspace(UUID id) {
        return workspaceRepository.findById(id)
                .map(WorkspaceDto::from)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Workspace not found"));
    }
}
