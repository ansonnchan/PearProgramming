package com.pearprogram.ai;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.OffsetDateTime;
import java.util.UUID;

@Entity
@Table(name = "ai_annotations")
public class AiAnnotationEntity {
    @Id
    private UUID id;

    @Column(name = "room_id", nullable = false)
    private UUID roomId;

    @Column(name = "file_id", nullable = false)
    private UUID fileId;

    @Column(name = "triggered_by_user_id")
    private UUID triggeredByUserId;

    @Column(name = "line_number", nullable = false)
    private int lineNumber;

    @Column(nullable = false, columnDefinition = "TEXT")
    private String content;

    @Column(nullable = false)
    private boolean dismissed;

    @Column(name = "created_at", nullable = false)
    private OffsetDateTime createdAt;

    protected AiAnnotationEntity() {
    }

    public AiAnnotationEntity(UUID roomId, UUID fileId, UUID triggeredByUserId, int lineNumber, String content) {
        this.id = UUID.randomUUID();
        this.roomId = roomId;
        this.fileId = fileId;
        this.triggeredByUserId = triggeredByUserId;
        this.lineNumber = lineNumber;
        this.content = content;
        this.dismissed = false;
        this.createdAt = OffsetDateTime.now();
    }

    public void dismiss() { this.dismissed = true; }
    public UUID getId() { return id; }
    public UUID getRoomId() { return roomId; }
    public UUID getFileId() { return fileId; }
    public UUID getTriggeredByUserId() { return triggeredByUserId; }
    public int getLineNumber() { return lineNumber; }
    public String getContent() { return content; }
    public boolean isDismissed() { return dismissed; }
    public OffsetDateTime getCreatedAt() { return createdAt; }
}
