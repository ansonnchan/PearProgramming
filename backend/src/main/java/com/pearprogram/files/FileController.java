package com.pearprogram.files;

import com.pearprogram.auth.GuestIdentityService;
import com.pearprogram.workspaces.WorkspaceService;
import jakarta.validation.Valid;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

@RestController
public class FileController {
    private final FileService fileService;
    private final WorkspaceService workspaceService;
    private final GuestIdentityService identities;

    public FileController(FileService fileService, WorkspaceService workspaceService, GuestIdentityService identities) {
        this.fileService = fileService;
        this.workspaceService = workspaceService;
        this.identities = identities;
    }

    @GetMapping("/api/workspaces/{workspaceId}/files")
    public List<FileDto> list(@PathVariable UUID workspaceId, Authentication authentication) {
        workspaceService.requireAccess(workspaceId, identities.requirePrincipal(authentication).id());
        return fileService.listFiles(workspaceId);
    }

    @PostMapping("/api/workspaces/{workspaceId}/files")
    public FileDto create(@PathVariable UUID workspaceId, @Valid @RequestBody CreateFileRequest request, Authentication authentication) {
        workspaceService.requireAccess(workspaceId, identities.requirePrincipal(authentication).id());
        return fileService.createFile(workspaceId, request);
    }

    @PostMapping("/api/workspaces/{workspaceId}/files/batch")
    public List<FileDto> createBatch(@PathVariable UUID workspaceId, @Valid @RequestBody BatchCreateFilesRequest request, Authentication authentication) {
        workspaceService.requireAccess(workspaceId, identities.requirePrincipal(authentication).id());
        return fileService.createFiles(workspaceId, request);
    }

    @GetMapping("/api/files/{fileId}")
    public FileDto get(@PathVariable UUID fileId, Authentication authentication) {
        FileDto file = fileService.getFile(fileId);
        workspaceService.requireAccess(file.workspaceId(), identities.requirePrincipal(authentication).id());
        return file;
    }

    @PatchMapping("/api/files/{fileId}")
    public FileDto update(@PathVariable UUID fileId, @RequestBody UpdateFileRequest request, Authentication authentication) {
        FileDto file = fileService.getFile(fileId);
        workspaceService.requireAccess(file.workspaceId(), identities.requirePrincipal(authentication).id());
        return fileService.updateFile(fileId, request);
    }

    @DeleteMapping("/api/files/{fileId}")
    public void delete(@PathVariable UUID fileId, Authentication authentication) {
        FileDto file = fileService.getFile(fileId);
        workspaceService.requireAccess(file.workspaceId(), identities.requirePrincipal(authentication).id());
        fileService.deleteFile(fileId);
    }

    @GetMapping("/internal/files/{fileId}/snapshot")
    public SnapshotResponse getSnapshot(@PathVariable UUID fileId) {
        return fileService.getSnapshot(fileId);
    }

    @PostMapping("/internal/files/{fileId}/snapshot")
    public SnapshotResponse saveSnapshot(@PathVariable UUID fileId, @RequestBody SnapshotRequest request) {
        return fileService.saveSnapshot(fileId, request);
    }
}
