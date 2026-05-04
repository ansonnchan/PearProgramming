package com.pearprogram.workspaces;

import com.pearprogram.files.WorkspaceFile;
import com.pearprogram.files.WorkspaceFileRepository;
import jakarta.transaction.Transactional;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.util.UUID;

@Service
public class WorkspaceService {
    private static final String STARTER_FILE_PATH = "src/main/java/RoomController.java";
    private static final String STARTER_FILE_CONTENT = """
            package com.pearprogram.rooms;

            import org.springframework.web.bind.annotation.PostMapping;
            import org.springframework.web.bind.annotation.RequestMapping;
            import org.springframework.web.bind.annotation.RestController;

            @RestController
            @RequestMapping("/api/rooms")
            public class RoomController {
                private final RoomService roomService;

                public RoomController(RoomService roomService) {
                    this.roomService = roomService;
                }

                @PostMapping
                public RoomDto createRoom(CreateRoomRequest request) {
                    return roomService.createRoom(request.workspaceId());
                }
            }
            """;

    private final WorkspaceRepository workspaceRepository;
    private final WorkspaceFileRepository fileRepository;

    public WorkspaceService(WorkspaceRepository workspaceRepository, WorkspaceFileRepository fileRepository) {
        this.workspaceRepository = workspaceRepository;
        this.fileRepository = fileRepository;
    }

    @Transactional
    public WorkspaceDto createWorkspace(String name) {
        Workspace workspace = new Workspace();
        workspace.setName(name);
        Workspace saved = workspaceRepository.save(workspace);
        createStarterFile(saved);
        return WorkspaceDto.from(saved);
    }

    public WorkspaceDto getWorkspace(UUID id) {
        return workspaceRepository.findById(id)
                .map(WorkspaceDto::from)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Workspace not found"));
    }

    private void createStarterFile(Workspace workspace) {
        WorkspaceFile file = new WorkspaceFile();
        file.setWorkspace(workspace);
        file.setPath(STARTER_FILE_PATH);
        file.setLanguage("java");
        file.setContent(STARTER_FILE_CONTENT);
        fileRepository.save(file);
    }
}
