package com.pearprogram.files;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface WorkspaceFileRepository extends JpaRepository<WorkspaceFileEntity, UUID> {
    List<WorkspaceFileEntity> findAllByWorkspaceIdOrderBySortOrderAscPathAsc(UUID workspaceId);
    Optional<WorkspaceFileEntity> findByWorkspaceIdAndPath(UUID workspaceId, String path);
    void deleteAllByWorkspaceId(UUID workspaceId);
}
