package com.pearprogram.persistence;

import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.sql.DriverManager;
import java.time.OffsetDateTime;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class DatabaseRestartPersistenceTests {
    @TempDir
    Path temporaryDirectory;

    @Test
    void rowsAndMigrationHistorySurviveDatabaseReconnection() throws Exception {
        String url = "jdbc:h2:file:" + temporaryDirectory.resolve("pearprogram-restart")
                + ";MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE";
        UUID userId = UUID.randomUUID();
        UUID workspaceId = UUID.randomUUID();

        migrate(url);
        try (var connection = DriverManager.getConnection(url, "sa", "")) {
            try (var user = connection.prepareStatement("""
                    INSERT INTO app_users (id, display_name, avatar_url, guest, created_at, updated_at)
                    VALUES (?, ?, NULL, TRUE, ?, ?)
                    """)) {
                user.setObject(1, userId);
                user.setString(2, "Restart User");
                user.setObject(3, OffsetDateTime.now());
                user.setObject(4, OffsetDateTime.now());
                user.executeUpdate();
            }
            try (var workspace = connection.prepareStatement("""
                    INSERT INTO workspaces (id, name, owner_user_id, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?)
                    """)) {
                workspace.setObject(1, workspaceId);
                workspace.setString(2, "Restart Workspace");
                workspace.setObject(3, userId);
                workspace.setObject(4, OffsetDateTime.now());
                workspace.setObject(5, OffsetDateTime.now());
                workspace.executeUpdate();
            }
        }

        migrate(url);
        try (var connection = DriverManager.getConnection(url, "sa", "");
             var query = connection.prepareStatement("SELECT name FROM workspaces WHERE id = ?")) {
            query.setObject(1, workspaceId);
            try (var result = query.executeQuery()) {
                assertThat(result.next()).isTrue();
                assertThat(result.getString(1)).isEqualTo("Restart Workspace");
            }
        }
    }

    private void migrate(String url) {
        Flyway.configure()
                .dataSource(url, "sa", "")
                .locations("classpath:db/migration")
                .load()
                .migrate();
    }
}
