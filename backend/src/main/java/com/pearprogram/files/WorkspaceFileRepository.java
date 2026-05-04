package com.pearprogram.files;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface WorkspaceFileRepository extends JpaRepository<WorkspaceFile, UUID> {
    List<WorkspaceFile> findByWorkspaceIdOrderByPathAsc(UUID workspaceId);

    Optional<WorkspaceFile> findByWorkspaceIdAndPath(UUID workspaceId, String path);

    void deleteByWorkspaceId(UUID workspaceId);
}
