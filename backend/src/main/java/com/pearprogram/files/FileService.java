package com.pearprogram.files;

import org.springframework.stereotype.Service;

import java.util.List;
import java.util.UUID;

@Service
public class FileService {

    public List<FileDto> listFiles(UUID workspaceId) {
        // Files are no longer persisted; return empty list.
        return List.of();
    }

    public FileDto createFile(UUID workspaceId, CreateFileRequest request) {
        // Files are no longer persisted; return null.
        return null;
    }

    public List<FileDto> createFiles(UUID workspaceId, BatchCreateFilesRequest request) {
        // Files are no longer persisted; return empty list.
        return List.of();
    }

    public FileDto getFile(UUID fileId) {
        // Files are no longer persisted; return null.
        return null;
    }

    public FileDto updateFile(UUID fileId, UpdateFileRequest request) {
        // Files are no longer persisted; return null.
        return null;
    }

    public SnapshotResponse saveSnapshot(UUID fileId, SnapshotRequest request) {
        // Snapshots are no longer persisted; return empty response.
        return new SnapshotResponse(fileId, "", "");
    }

    public SnapshotResponse getSnapshot(UUID fileId) {
        // Snapshots are no longer persisted; return empty response.
        return new SnapshotResponse(fileId, "", "");
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
