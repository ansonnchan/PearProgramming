package com.pearprogram.files;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;

@Service
public class FileService {
    private final Map<UUID, FileDto> files = new ConcurrentHashMap<>();
    private final Map<UUID, Set<UUID>> filesByWorkspace = new ConcurrentHashMap<>();
    private final Map<UUID, SnapshotResponse> snapshots = new ConcurrentHashMap<>();

    public List<FileDto> listFiles(UUID workspaceId) {
        return filesByWorkspace.getOrDefault(workspaceId, Set.of()).stream()
                .map(files::get)
                .filter((file) -> file != null)
                .sorted(Comparator.comparing(FileDto::path))
                .toList();
    }

    public FileDto createFile(UUID workspaceId, CreateFileRequest request) {
        String path = normalizePath(request.path());
        if (path.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "File path is required");
        }

        OffsetDateTime now = OffsetDateTime.now();
        FileDto file = new FileDto(
                UUID.randomUUID(),
                workspaceId,
                uniquePath(workspaceId, path, null),
                normalizeLanguage(request.language(), path),
                request.content() == null ? "" : request.content(),
                now,
                now
        );
        store(file);
        return file;
    }

    public List<FileDto> createFiles(UUID workspaceId, BatchCreateFilesRequest request) {
        if (request.replaceExisting()) {
            removeWorkspaceFiles(workspaceId);
        }

        List<FileDto> created = new ArrayList<>();
        for (CreateFileRequest fileRequest : request.files()) {
            created.add(createFile(workspaceId, fileRequest));
        }
        return created.stream()
                .sorted(Comparator.comparing(FileDto::path))
                .toList();
    }

    public FileDto getFile(UUID fileId) {
        FileDto file = files.get(fileId);
        if (file == null) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "File not found");
        }
        return file;
    }

    public FileDto updateFile(UUID fileId, UpdateFileRequest request) {
        FileDto current = getFile(fileId);
        String requestedPath = request.path() == null || request.path().isBlank()
                ? current.path()
                : normalizePath(request.path());
        if (requestedPath.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "File path is required");
        }

        FileDto updated = new FileDto(
                current.id(),
                current.workspaceId(),
                uniquePath(current.workspaceId(), requestedPath, current.id()),
                normalizeLanguage(request.language(), requestedPath),
                request.content() == null ? current.content() : request.content(),
                current.createdAt(),
                OffsetDateTime.now()
        );
        store(updated);
        return updated;
    }

    public SnapshotResponse saveSnapshot(UUID fileId, SnapshotRequest request) {
        SnapshotResponse snapshot = new SnapshotResponse(
                fileId,
                request.encodedState() == null ? "" : request.encodedState(),
                request.plainText() == null ? "" : request.plainText()
        );
        snapshots.put(fileId, snapshot);

        FileDto file = files.get(fileId);
        if (file != null && request.plainText() != null) {
            files.put(fileId, new FileDto(
                    file.id(),
                    file.workspaceId(),
                    file.path(),
                    file.language(),
                    request.plainText(),
                    file.createdAt(),
                    OffsetDateTime.now()
            ));
        }
        return snapshot;
    }

    public SnapshotResponse getSnapshot(UUID fileId) {
        SnapshotResponse snapshot = snapshots.get(fileId);
        if (snapshot != null) {
            return snapshot;
        }

        FileDto file = files.get(fileId);
        return new SnapshotResponse(fileId, "", file == null ? "" : file.content());
    }

    private void store(FileDto file) {
        files.put(file.id(), file);
        filesByWorkspace.computeIfAbsent(file.workspaceId(), ignored -> ConcurrentHashMap.newKeySet()).add(file.id());
    }

    private void removeWorkspaceFiles(UUID workspaceId) {
        Set<UUID> existing = filesByWorkspace.remove(workspaceId);
        if (existing == null) {
            return;
        }

        for (UUID id : existing) {
            files.remove(id);
            snapshots.remove(id);
        }
    }

    private String uniquePath(UUID workspaceId, String requestedPath, UUID currentFileId) {
        Set<String> existingPaths = filesByWorkspace.getOrDefault(workspaceId, Set.of()).stream()
                .filter((id) -> !id.equals(currentFileId))
                .map(files::get)
                .filter((file) -> file != null)
                .map(FileDto::path)
                .collect(Collectors.toSet());

        if (!existingPaths.contains(requestedPath)) {
            return requestedPath;
        }

        String folder = "";
        String name = requestedPath;
        int slash = requestedPath.lastIndexOf('/');
        if (slash >= 0) {
            folder = requestedPath.substring(0, slash + 1);
            name = requestedPath.substring(slash + 1);
        }

        String base = name;
        String extension = "";
        int dot = name.lastIndexOf('.');
        if (dot > 0) {
            base = name.substring(0, dot);
            extension = name.substring(dot);
        }

        int index = 2;
        String candidate = folder + base + "-" + index + extension;
        while (existingPaths.contains(candidate)) {
            index += 1;
            candidate = folder + base + "-" + index + extension;
        }
        return candidate;
    }

    private String normalizeLanguage(String language, String path) {
        if (language != null && !language.isBlank()) {
            return language.trim();
        }
        return inferLanguage(path);
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
