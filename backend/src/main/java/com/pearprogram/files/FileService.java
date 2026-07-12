package com.pearprogram.files;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

@Service
public class FileService {
    private final WorkspaceFileRepository files;
    private final FileSnapshotRepository snapshots;

    public FileService(WorkspaceFileRepository files, FileSnapshotRepository snapshots) {
        this.files = files;
        this.snapshots = snapshots;
    }

    @Transactional(readOnly = true)
    public List<FileDto> listFiles(UUID workspaceId) {
        return files.findAllByWorkspaceIdOrderBySortOrderAscPathAsc(workspaceId).stream().map(this::toDto).toList();
    }

    @Transactional
    public FileDto createFile(UUID workspaceId, CreateFileRequest request) {
        String path = requirePath(request.path());
        int order = files.findAllByWorkspaceIdOrderBySortOrderAscPathAsc(workspaceId).size();
        WorkspaceFileEntity file = new WorkspaceFileEntity(
                UUID.randomUUID(),
                workspaceId,
                uniquePath(workspaceId, path, null),
                normalizeLanguage(request.language(), path),
                request.content() == null ? "" : request.content(),
                order
        );
        return toDto(files.save(file));
    }

    @Transactional
    public List<FileDto> createFiles(UUID workspaceId, BatchCreateFilesRequest request) {
        if (request.replaceExisting()) {
            files.deleteAllByWorkspaceId(workspaceId);
            files.flush();
        }
        List<FileDto> created = new ArrayList<>();
        for (CreateFileRequest file : request.files()) {
            created.add(createFile(workspaceId, file));
        }
        return created;
    }

    @Transactional(readOnly = true)
    public FileDto getFile(UUID fileId) {
        return toDto(requireEntity(fileId));
    }

    @Transactional
    public FileDto updateFile(UUID fileId, UpdateFileRequest request) {
        WorkspaceFileEntity current = requireEntity(fileId);
        String path = request.path() == null || request.path().isBlank()
                ? current.getPath()
                : requirePath(request.path());
        String content = request.content() == null ? current.getContent() : request.content();
        current.update(
                uniquePath(current.getWorkspaceId(), path, current.getId()),
                normalizeLanguage(request.language(), path, current.getLanguage()),
                content,
                current.getSortOrder()
        );
        return toDto(current);
    }

    @Transactional
    public void deleteFile(UUID fileId) {
        files.delete(requireEntity(fileId));
    }

    @Transactional
    public SnapshotResponse saveSnapshot(UUID fileId, SnapshotRequest request) {
        WorkspaceFileEntity file = requireEntity(fileId);
        String encoded = request.encodedState() == null ? "" : request.encodedState();
        String plain = request.plainText() == null ? "" : request.plainText();
        FileSnapshotEntity snapshot = snapshots.findById(fileId)
                .orElseGet(() -> new FileSnapshotEntity(fileId, encoded, plain));
        snapshot.update(encoded, plain);
        snapshots.save(snapshot);
        if (request.plainText() != null) {
            file.updateContent(plain);
        }
        return new SnapshotResponse(fileId, encoded, plain);
    }

    @Transactional(readOnly = true)
    public SnapshotResponse getSnapshot(UUID fileId) {
        WorkspaceFileEntity file = requireEntity(fileId);
        return snapshots.findById(fileId)
                .map(snapshot -> new SnapshotResponse(fileId, snapshot.getEncodedState(), snapshot.getPlainText()))
                .orElseGet(() -> new SnapshotResponse(fileId, "", file.getContent()));
    }

    @Transactional
    public List<FileDto> synchronizeWorkspace(UUID workspaceId, List<Map<String, Object>> incoming, boolean replaceExisting) {
        List<WorkspaceFileEntity> existing = files.findAllByWorkspaceIdOrderBySortOrderAscPathAsc(workspaceId);
        Set<UUID> retained = new HashSet<>();
        int order = 0;
        for (Map<String, Object> raw : incoming == null ? List.<Map<String, Object>>of() : incoming) {
            String path = requirePath(stringValue(raw.get("path")));
            UUID requestedId = uuidValue(raw.get("id"));
            WorkspaceFileEntity entity = requestedId == null ? null : files.findById(requestedId).orElse(null);
            if (entity != null && !entity.getWorkspaceId().equals(workspaceId)) {
                throw new ResponseStatusException(HttpStatus.CONFLICT, "File belongs to another workspace");
            }
            if (entity == null) {
                entity = files.findByWorkspaceIdAndPath(workspaceId, path).orElse(null);
            }
            String language = normalizeLanguage(stringValue(raw.get("language")), path);
            String content = raw.get("content") == null ? "" : raw.get("content").toString();
            if (entity == null) {
                UUID id = requestedId != null && !files.existsById(requestedId) ? requestedId : UUID.randomUUID();
                entity = new WorkspaceFileEntity(id, workspaceId, uniquePath(workspaceId, path, null), language, content, order);
                files.save(entity);
            } else {
                entity.update(uniquePath(workspaceId, path, entity.getId()), language, content, order);
            }
            retained.add(entity.getId());
            order++;
        }
        if (replaceExisting) {
            existing.stream().filter(file -> !retained.contains(file.getId())).forEach(files::delete);
        }
        files.flush();
        return listFiles(workspaceId);
    }

    private WorkspaceFileEntity requireEntity(UUID fileId) {
        return files.findById(fileId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "File not found"));
    }

    private String uniquePath(UUID workspaceId, String requestedPath, UUID currentFileId) {
        Set<String> paths = new HashSet<>();
        for (WorkspaceFileEntity file : files.findAllByWorkspaceIdOrderBySortOrderAscPathAsc(workspaceId)) {
            if (!file.getId().equals(currentFileId)) {
                paths.add(file.getPath());
            }
        }
        if (!paths.contains(requestedPath)) {
            return requestedPath;
        }
        int slash = requestedPath.lastIndexOf('/');
        String folder = slash < 0 ? "" : requestedPath.substring(0, slash + 1);
        String name = slash < 0 ? requestedPath : requestedPath.substring(slash + 1);
        int dot = name.lastIndexOf('.');
        String base = dot > 0 ? name.substring(0, dot) : name;
        String extension = dot > 0 ? name.substring(dot) : "";
        int index = 2;
        String candidate;
        do {
            candidate = folder + base + "-" + index++ + extension;
        } while (paths.contains(candidate));
        return candidate;
    }

    private String requirePath(String raw) {
        String path = raw == null ? "" : raw.replace('\\', '/').replaceAll("/+", "/").replaceAll("^/+", "").trim();
        if (path.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "File path is required");
        }
        if (path.length() > 1024 || path.equals("..") || path.startsWith("../") || path.contains("/../")) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "File path is invalid");
        }
        return path;
    }

    private String normalizeLanguage(String language, String path) {
        return normalizeLanguage(language, path, null);
    }

    private String normalizeLanguage(String language, String path, String fallback) {
        if (language != null && !language.isBlank()) {
            return language.trim();
        }
        if (fallback != null && !fallback.isBlank()) {
            return fallback;
        }
        String lower = path.toLowerCase();
        if (lower.endsWith(".java")) return "java";
        if (lower.endsWith(".ts") || lower.endsWith(".tsx")) return "typescript";
        if (lower.endsWith(".js") || lower.endsWith(".jsx")) return "javascript";
        if (lower.endsWith(".py")) return "python";
        if (lower.endsWith(".c") || lower.endsWith(".h")) return "c";
        if (lower.endsWith(".cpp") || lower.endsWith(".cc") || lower.endsWith(".cxx") || lower.endsWith(".hpp")) return "cpp";
        if (lower.endsWith(".html") || lower.endsWith(".htm")) return "html";
        if (lower.endsWith(".css")) return "css";
        if (lower.endsWith(".json")) return "json";
        if (lower.endsWith(".md")) return "markdown";
        if (lower.endsWith(".sql")) return "sql";
        return "plaintext";
    }

    private String stringValue(Object value) {
        return value == null ? null : value.toString();
    }

    private UUID uuidValue(Object value) {
        try {
            return value == null ? null : UUID.fromString(value.toString());
        } catch (IllegalArgumentException ignored) {
            return null;
        }
    }

    private FileDto toDto(WorkspaceFileEntity file) {
        return new FileDto(file.getId(), file.getWorkspaceId(), file.getPath(), file.getLanguage(), file.getContent(),
                file.getCreatedAt(), file.getUpdatedAt());
    }
}
