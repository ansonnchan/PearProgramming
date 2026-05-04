package com.pearprogram.files;

import com.pearprogram.ai.AiAnnotationRepository;
import com.pearprogram.workspaces.Workspace;
import com.pearprogram.workspaces.WorkspaceRepository;
import jakarta.transaction.Transactional;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Service
public class FileService {
    private final WorkspaceRepository workspaceRepository;
    private final WorkspaceFileRepository fileRepository;
    private final AiAnnotationRepository aiAnnotationRepository;

    public FileService(
            WorkspaceRepository workspaceRepository,
            WorkspaceFileRepository fileRepository,
            AiAnnotationRepository aiAnnotationRepository
    ) {
        this.workspaceRepository = workspaceRepository;
        this.fileRepository = fileRepository;
        this.aiAnnotationRepository = aiAnnotationRepository;
    }

    public List<FileDto> listFiles(UUID workspaceId) {
        return fileRepository.findByWorkspaceIdOrderByPathAsc(workspaceId)
                .stream()
                .map(FileDto::from)
                .toList();
    }

    @Transactional
    public FileDto createFile(UUID workspaceId, CreateFileRequest request) {
        Workspace workspace = workspaceRepository.findById(workspaceId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Workspace not found"));

        fileRepository.findByWorkspaceIdAndPath(workspaceId, request.path()).ifPresent(existing -> {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "File path already exists");
        });

        WorkspaceFile file = new WorkspaceFile();
        file.setWorkspace(workspace);
        file.setPath(request.path());
        file.setLanguage(request.language() == null || request.language().isBlank() ? inferLanguage(request.path()) : request.language());
        file.setContent(request.content() == null ? "" : request.content());
        return FileDto.from(fileRepository.save(file));
    }

    @Transactional
    public List<FileDto> createFiles(UUID workspaceId, BatchCreateFilesRequest request) {
        Workspace workspace = workspaceRepository.findById(workspaceId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Workspace not found"));

        if (request.replaceExisting()) {
            aiAnnotationRepository.deleteByFile_Workspace_Id(workspaceId);
            fileRepository.deleteByWorkspaceId(workspaceId);
            fileRepository.flush();
        }

        Map<String, CreateFileRequest> byPath = new LinkedHashMap<>();
        for (CreateFileRequest fileRequest : request.files()) {
            String normalizedPath = normalizePath(fileRequest.path());
            if (!normalizedPath.isBlank()) {
                byPath.put(normalizedPath, new CreateFileRequest(
                        normalizedPath,
                        fileRequest.language(),
                        fileRequest.content()
                ));
            }
        }

        for (CreateFileRequest fileRequest : byPath.values()) {
            WorkspaceFile file = fileRepository.findByWorkspaceIdAndPath(workspaceId, fileRequest.path())
                    .orElseGet(WorkspaceFile::new);
            file.setWorkspace(workspace);
            file.setPath(fileRequest.path());
            file.setLanguage(fileRequest.language() == null || fileRequest.language().isBlank()
                    ? inferLanguage(fileRequest.path())
                    : fileRequest.language());
            file.setContent(fileRequest.content() == null ? "" : fileRequest.content());
            fileRepository.save(file);
        }

        return listFiles(workspaceId);
    }

    public FileDto getFile(UUID fileId) {
        return fileRepository.findById(fileId)
                .map(FileDto::from)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "File not found"));
    }

    @Transactional
    public FileDto updateFile(UUID fileId, UpdateFileRequest request) {
        WorkspaceFile file = fileRepository.findById(fileId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "File not found"));
        if (request.path() != null && !request.path().isBlank()) {
            file.setPath(request.path());
        }
        if (request.language() != null && !request.language().isBlank()) {
            file.setLanguage(request.language());
        }
        if (request.content() != null) {
            file.setContent(request.content());
        }
        return FileDto.from(file);
    }

    @Transactional
    public SnapshotResponse saveSnapshot(UUID fileId, SnapshotRequest request) {
        WorkspaceFile file = fileRepository.findById(fileId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "File not found"));

        String snapshot = request.plainText() != null ? request.plainText() : request.encodedState();
        file.setContent(snapshot == null ? "" : snapshot);
        return new SnapshotResponse(fileId, request.encodedState(), request.plainText());
    }

    public SnapshotResponse getSnapshot(UUID fileId) {
        WorkspaceFile file = fileRepository.findById(fileId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "File not found"));
        return new SnapshotResponse(file.getId(), file.getContent(), file.getContent());
    }

    private String inferLanguage(String path) {
        String lower = path.toLowerCase();
        if (lower.endsWith(".java")) {
            return "java";
        }
        if (lower.endsWith(".ts") || lower.endsWith(".tsx")) {
            return "typescript";
        }
        if (lower.endsWith(".js") || lower.endsWith(".jsx")) {
            return "javascript";
        }
        if (lower.endsWith(".py")) {
            return "python";
        }
        if (lower.endsWith(".c") || lower.endsWith(".h")) {
            return "c";
        }
        if (lower.endsWith(".cpp") || lower.endsWith(".cc") || lower.endsWith(".cxx")
                || lower.endsWith(".hpp") || lower.endsWith(".hh") || lower.endsWith(".hxx")) {
            return "cpp";
        }
        if (lower.endsWith(".html") || lower.endsWith(".htm")) {
            return "html";
        }
        if (lower.endsWith(".css")) {
            return "css";
        }
        if (lower.endsWith(".json")) {
            return "json";
        }
        if (lower.endsWith(".md") || lower.endsWith(".markdown")) {
            return "markdown";
        }
        if (lower.endsWith(".sql")) {
            return "sql";
        }
        return "plaintext";
    }

    private String normalizePath(String path) {
        return path.replace('\\', '/')
                .replaceAll("/+", "/")
                .replaceAll("^/+", "")
                .trim();
    }
}
