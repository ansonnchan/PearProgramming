package com.pearprogram.files;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.OffsetDateTime;
import java.util.UUID;

@Entity
@Table(name = "file_snapshots")
public class FileSnapshotEntity {
    @Id
    @Column(name = "file_id")
    private UUID fileId;

    @Column(name = "encoded_state", nullable = false, columnDefinition = "TEXT")
    private String encodedState;

    @Column(name = "plain_text", nullable = false, columnDefinition = "TEXT")
    private String plainText;

    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;

    protected FileSnapshotEntity() {
    }

    public FileSnapshotEntity(UUID fileId, String encodedState, String plainText) {
        this.fileId = fileId;
        update(encodedState, plainText);
    }

    public void update(String encodedState, String plainText) {
        this.encodedState = encodedState;
        this.plainText = plainText;
        this.updatedAt = OffsetDateTime.now();
    }

    public UUID getFileId() { return fileId; }
    public String getEncodedState() { return encodedState; }
    public String getPlainText() { return plainText; }
}
