package com.pearprogram.persistence;

import com.pearprogram.auth.UserRepository;
import com.pearprogram.auth.UserService;
import com.pearprogram.files.BatchCreateFilesRequest;
import com.pearprogram.files.CreateFileRequest;
import com.pearprogram.files.FileService;
import com.pearprogram.files.SnapshotRequest;
import com.pearprogram.files.UpdateFileRequest;
import com.pearprogram.files.WorkspaceFileRepository;
import com.pearprogram.rooms.EphemeralRoomStateService;
import com.pearprogram.rooms.RoomMemberRepository;
import com.pearprogram.rooms.RoomRepository;
import com.pearprogram.rooms.RoomService;
import com.pearprogram.workspaces.WorkspaceMemberEntity;
import com.pearprogram.workspaces.WorkspaceMemberRepository;
import com.pearprogram.workspaces.WorkspaceMemberRole;
import com.pearprogram.workspaces.WorkspaceRepository;
import com.pearprogram.workspaces.WorkspaceService;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@SpringBootTest
@ActiveProfiles("test")
class PersistenceIntegrationTests {
    @Autowired private Flyway flyway;
    @Autowired private JdbcTemplate jdbc;
    @Autowired private UserService users;
    @Autowired private UserRepository userRepository;
    @Autowired private WorkspaceService workspaces;
    @Autowired private WorkspaceRepository workspaceRepository;
    @Autowired private WorkspaceMemberRepository workspaceMembers;
    @Autowired private FileService files;
    @Autowired private WorkspaceFileRepository fileRepository;
    @Autowired private RoomService rooms;
    @Autowired private RoomRepository roomRepository;
    @Autowired private RoomMemberRepository roomMembers;
    @Autowired private EphemeralRoomStateService ephemeralRooms;

    @Test
    void migrationCreatesAndValidatesTheCoreSchema() {
        assertThat(flyway.info().current().getVersion().getVersion()).isEqualTo("2");
        Integer tables = jdbc.queryForObject("""
                SELECT COUNT(*) FROM information_schema.tables
                WHERE table_schema = 'public'
                  AND table_name IN ('app_users', 'workspaces', 'workspace_members', 'rooms',
                                     'room_members', 'workspace_files', 'file_snapshots', 'ai_annotations')
                """, Integer.class);
        assertThat(tables).isEqualTo(8);
    }

    @Test
    void workspaceMembershipControlsAccessAndRejectsDuplicates() {
        UUID owner = createUser("Workspace Owner");
        UUID member = createUser("Workspace Member");
        var workspace = workspaces.createWorkspace("Persistent workspace", owner.toString());

        assertThat(workspaces.getWorkspace(workspace.id(), owner.toString())).isEqualTo(workspace);
        assertThatThrownBy(() -> workspaces.getWorkspace(workspace.id(), member.toString()))
                .isInstanceOfSatisfying(ResponseStatusException.class,
                        error -> assertThat(error.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN));

        workspaces.addMember(workspace.id(), member);
        assertThat(workspaces.getWorkspace(workspace.id(), member.toString()).id()).isEqualTo(workspace.id());
        assertThat(workspaceMembers.findAllByUserId(member)).hasSize(1);

        assertThatThrownBy(() -> workspaceMembers.saveAndFlush(
                new WorkspaceMemberEntity(workspace.id(), member, WorkspaceMemberRole.MEMBER)))
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThat(workspaceMembers.findAllByUserId(member)).hasSize(1);
    }

    @Test
    void fileLifecycleAndSnapshotsPersistAcrossServiceCalls() {
        UUID owner = createUser("File Owner");
        UUID workspaceId = workspaces.createWorkspace("Files", owner.toString()).id();

        var first = files.createFile(workspaceId, new CreateFileRequest("src/Main.java", null, "class Main {}"));
        var duplicate = files.createFile(workspaceId, new CreateFileRequest("src/Main.java", "java", "class Other {}"));
        assertThat(duplicate.path()).isEqualTo("src/Main-2.java");

        var renamed = files.updateFile(first.id(), new UpdateFileRequest("src/App.java", null, "class App {}"));
        assertThat(renamed.path()).isEqualTo("src/App.java");
        assertThat(renamed.language()).isEqualTo("java");

        files.saveSnapshot(first.id(), new SnapshotRequest("ROOM01", "encoded-yjs-state", "class App { }"));
        assertThat(files.getSnapshot(first.id()).encodedState()).isEqualTo("encoded-yjs-state");
        assertThat(files.getFile(first.id()).content()).isEqualTo("class App { }");

        files.deleteFile(duplicate.id());
        assertThat(files.listFiles(workspaceId)).extracting("id").containsExactly(first.id());
    }

    @Test
    void batchCreationRollsBackWhenAnyFileIsInvalid() {
        UUID owner = createUser("Rollback Owner");
        UUID workspaceId = workspaces.createWorkspace("Rollback", owner.toString()).id();
        var original = files.createFile(workspaceId, new CreateFileRequest("original.txt", "plaintext", "keep"));

        assertThatThrownBy(() -> files.createFiles(workspaceId, new BatchCreateFilesRequest(List.of(
                new CreateFileRequest("valid.txt", "plaintext", "valid"),
                new CreateFileRequest("../invalid.txt", "plaintext", "invalid")
        ), true))).isInstanceOf(ResponseStatusException.class);

        assertThat(files.listFiles(workspaceId)).extracting("id").containsExactly(original.id());
    }

    @Test
    void roomCreationAndJoiningPersistBothMembershipLayers() {
        UUID owner = createUser("Room Owner");
        UUID joiner = createUser("Room Joiner");
        var room = rooms.createRoom(owner.toString(), "Room Owner");

        rooms.joinRoom(room.code(), joiner.toString(), "Room Joiner");
        var entity = roomRepository.findByCodeAndActiveTrue(room.code()).orElseThrow();

        assertThat(entity.getWorkspaceId()).isEqualTo(room.workspaceId());
        assertThat(roomMembers.existsByRoomIdAndUserId(entity.getId(), owner)).isTrue();
        assertThat(roomMembers.existsByRoomIdAndUserId(entity.getId(), joiner)).isTrue();
        assertThat(workspaceMembers.existsByWorkspaceIdAndUserId(room.workspaceId(), joiner)).isTrue();
    }

    @Test
    void durableRoomRehydratesAfterEphemeralStateIsLost() {
        UUID owner = createUser("Restart Owner");
        var created = rooms.createRoom(owner.toString(), "Restart Owner");
        ephemeralRooms.deleteRoom(created.code());

        var restored = rooms.getRoom(created.code());

        assertThat(restored.code()).isEqualTo(created.code());
        assertThat(restored.workspaceId()).isEqualTo(created.workspaceId());
        assertThat(ephemeralRooms.roomExists(created.code())).isTrue();
    }

    @Test
    void closingRoomCascadesWorkspaceFilesAndMemberships() {
        UUID owner = createUser("Close Owner");
        var created = rooms.createRoom(owner.toString(), "Close Owner");
        UUID fileId = files.createFile(created.workspaceId(), new CreateFileRequest("close.txt", null, "bye")).id();

        rooms.closeRoom(created.code());

        assertThat(roomRepository.findByCode(created.code())).isEmpty();
        assertThat(workspaceRepository.findById(created.workspaceId())).isEmpty();
        assertThat(fileRepository.findById(fileId)).isEmpty();
    }

    private UUID createUser(String displayName) {
        UUID id = UUID.randomUUID();
        users.createGuest(id, displayName, null);
        assertThat(userRepository.existsById(id)).isTrue();
        return id;
    }
}
