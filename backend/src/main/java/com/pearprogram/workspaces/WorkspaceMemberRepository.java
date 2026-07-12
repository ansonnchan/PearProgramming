package com.pearprogram.workspaces;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface WorkspaceMemberRepository extends JpaRepository<WorkspaceMemberEntity, UUID> {
    boolean existsByWorkspaceIdAndUserId(UUID workspaceId, UUID userId);
    Optional<WorkspaceMemberEntity> findByWorkspaceIdAndUserId(UUID workspaceId, UUID userId);
    List<WorkspaceMemberEntity> findAllByUserId(UUID userId);
}
