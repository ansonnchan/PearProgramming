package com.pearprogram.ai;

import com.pearprogram.auth.UserService;
import com.pearprogram.files.CreateFileRequest;
import com.pearprogram.files.FileService;
import com.pearprogram.rooms.RoomService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpStatus;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.web.server.ResponseStatusException;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@SpringBootTest
@ActiveProfiles("test")
class AiAnnotationServiceTests {
    @Autowired private AiAnnotationService annotations;
    @Autowired private UserService users;
    @Autowired private RoomService rooms;
    @Autowired private FileService files;

    @Test
    void persistsListsAndMembershipProtectsAnnotationDismissal() {
        UUID owner = createUser("Annotation Owner");
        UUID outsider = createUser("Annotation Outsider");
        var room = rooms.createRoom(owner.toString(), "Annotation Owner");
        var file = files.createFile(room.workspaceId(), new CreateFileRequest("Main.java", "java", "class Main {}"));

        var created = annotations.create(room.code(), new CreateAnnotationRequest(file.id(), 2, "Use a helper"), owner);

        assertThat(annotations.listActive(room.code(), file.id())).containsExactly(created);
        assertThatThrownBy(() -> annotations.dismiss(created.id(), outsider))
                .isInstanceOfSatisfying(ResponseStatusException.class,
                        error -> assertThat(error.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN));

        annotations.dismiss(created.id(), owner);
        assertThat(annotations.listActive(room.code(), file.id())).isEmpty();
    }

    private UUID createUser(String name) {
        UUID id = UUID.randomUUID();
        users.createGuest(id, name, null);
        return id;
    }
}
