package com.pearprogram.files;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;

import java.time.OffsetDateTime;
import java.util.UUID;

@Entity
@Table(name = "workspace_files", uniqueConstraints = @UniqueConstraint(
        name = "uk_workspace_file_path", columnNames = {"workspace_id", "path"}
))
public class WorkspaceFileEntity {
    @Id
    private UUID id;

    @Column(name = "workspace_id", nullable = false)
    private UUID workspaceId;

    @Column(nullable = false, length = 1024)
    private String path;

    @Column(nullable = false, length = 64)
    private String language;

    @Column(nullable = false, columnDefinition = "TEXT")
    private String content;

    @Column(name = "sort_order", nullable = false)
    private int sortOrder;

    @Column(name = "created_at", nullable = false)
    private OffsetDateTime createdAt;

    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;

    protected WorkspaceFileEntity() {
    }

    public WorkspaceFileEntity(UUID id, UUID workspaceId, String path, String language, String content, int sortOrder) {
        OffsetDateTime now = OffsetDateTime.now();
        this.id = id;
        this.workspaceId = workspaceId;
        this.path = path;
        this.language = language;
        this.content = content;
        this.sortOrder = sortOrder;
        this.createdAt = now;
        this.updatedAt = now;
    }

    public void update(String path, String language, String content, int sortOrder) {
        this.path = path;
        this.language = language;
        this.content = content;
        this.sortOrder = sortOrder;
        this.updatedAt = OffsetDateTime.now();
    }

    public void updateContent(String content) {
        this.content = content;
        this.updatedAt = OffsetDateTime.now();
    }

    public UUID getId() { return id; }
    public UUID getWorkspaceId() { return workspaceId; }
    public String getPath() { return path; }
    public String getLanguage() { return language; }
    public String getContent() { return content; }
    public int getSortOrder() { return sortOrder; }
    public OffsetDateTime getCreatedAt() { return createdAt; }
    public OffsetDateTime getUpdatedAt() { return updatedAt; }
}
