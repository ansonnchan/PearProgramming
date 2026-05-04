package com.pearprogram.github;

import com.pearprogram.files.FileDto;
import com.pearprogram.files.WorkspaceFile;
import com.pearprogram.files.WorkspaceFileRepository;
import com.pearprogram.workspaces.Workspace;
import com.pearprogram.workspaces.WorkspaceRepository;
import jakarta.transaction.Transactional;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Service
public class GitHubImportService {
    private final WorkspaceRepository workspaceRepository;
    private final WorkspaceFileRepository fileRepository;

    public GitHubImportService(WorkspaceRepository workspaceRepository, WorkspaceFileRepository fileRepository) {
        this.workspaceRepository = workspaceRepository;
        this.fileRepository = fileRepository;
    }

    @Transactional
    public GitHubImportResponse importPlaceholder(UUID workspaceId, GitHubImportRequest request) {
        Workspace workspace = workspaceRepository.findById(workspaceId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Workspace not found"));
        String owner = blankToDefault(request.owner(), "sample-org");
        String repo = blankToDefault(request.repo(), "pearprogram-import");
        String branch = blankToDefault(request.branch(), "main");

        List<WorkspaceFile> created = new ArrayList<>();
        created.add(createOrReplace(workspace, repo + "/README.md", "markdown", "# " + repo + "\n\nPlaceholder GitHub import from " + owner + "/" + repo + "@" + branch + ".\n"));
        created.add(createOrReplace(workspace, repo + "/src/ImportedEditor.tsx", "typescript", """
                export function ImportedEditor() {
                  return <section>PearProgram imported this placeholder file from GitHub.</section>;
                }
                """));
        created.add(createOrReplace(workspace, repo + "/api/RoomImportController.java", "java", """
                package imported;

                public class RoomImportController {
                    public String source() {
                        return "placeholder-github-import";
                    }
                }
                """));

        return new GitHubImportResponse(owner, repo, branch, created.stream().map(FileDto::from).toList());
    }

    private WorkspaceFile createOrReplace(Workspace workspace, String path, String language, String content) {
        WorkspaceFile file = fileRepository.findByWorkspaceIdAndPath(workspace.getId(), path)
                .orElseGet(WorkspaceFile::new);
        file.setWorkspace(workspace);
        file.setPath(path);
        file.setLanguage(language);
        file.setContent(content);
        return fileRepository.save(file);
    }

    private String blankToDefault(String value, String fallback) {
        return value == null || value.isBlank() ? fallback : value;
    }
}
