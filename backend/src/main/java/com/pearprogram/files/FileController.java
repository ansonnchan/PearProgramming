package com.pearprogram.files;

import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
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

    public FileController(FileService fileService) {
        this.fileService = fileService;
    }

    @GetMapping("/api/workspaces/{workspaceId}/files")
    public List<FileDto> list(@PathVariable UUID workspaceId) {
        return fileService.listFiles(workspaceId);
    }

    @PostMapping("/api/workspaces/{workspaceId}/files")
    public FileDto create(@PathVariable UUID workspaceId, @Valid @RequestBody CreateFileRequest request) {
        return fileService.createFile(workspaceId, request);
    }

    @PostMapping("/api/workspaces/{workspaceId}/files/batch")
    public List<FileDto> createBatch(@PathVariable UUID workspaceId, @Valid @RequestBody BatchCreateFilesRequest request) {
        return fileService.createFiles(workspaceId, request);
    }

    @GetMapping("/api/files/{fileId}")
    public FileDto get(@PathVariable UUID fileId) {
        return fileService.getFile(fileId);
    }

    @PatchMapping("/api/files/{fileId}")
    public FileDto update(@PathVariable UUID fileId, @RequestBody UpdateFileRequest request) {
        return fileService.updateFile(fileId, request);
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
