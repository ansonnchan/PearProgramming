package com.pearprogram.auth;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.OffsetDateTime;
import java.util.UUID;

@Entity
@Table(name = "app_users")
public class UserEntity {
    @Id
    private UUID id;

    @Column(name = "display_name", nullable = false, length = 60)
    private String displayName;

    @Column(name = "avatar_url", columnDefinition = "TEXT")
    private String avatarUrl;

    @Column(nullable = false)
    private boolean guest;

    @Column(name = "created_at", nullable = false)
    private OffsetDateTime createdAt;

    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;

    protected UserEntity() {
    }

    public UserEntity(UUID id, String displayName, String avatarUrl) {
        OffsetDateTime now = OffsetDateTime.now();
        this.id = id;
        this.displayName = displayName;
        this.avatarUrl = avatarUrl;
        this.guest = true;
        this.createdAt = now;
        this.updatedAt = now;
    }

    public void updateProfile(String displayName, String avatarUrl) {
        this.displayName = displayName;
        this.avatarUrl = avatarUrl;
        this.updatedAt = OffsetDateTime.now();
    }

    public UUID getId() { return id; }
    public String getDisplayName() { return displayName; }
    public String getAvatarUrl() { return avatarUrl; }
    public boolean isGuest() { return guest; }
    public OffsetDateTime getCreatedAt() { return createdAt; }
    public OffsetDateTime getUpdatedAt() { return updatedAt; }
}
