package com.pearprogram.bootstrap;

import com.pearprogram.files.FileService;
import com.pearprogram.rooms.RoomDto;
import com.pearprogram.rooms.RoomService;
import com.pearprogram.workspaces.WorkspaceDto;
import com.pearprogram.workspaces.WorkspaceService;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/bootstrap")
public class BootstrapController {
    private final WorkspaceService workspaceService;
    private final RoomService roomService;
    private final FileService fileService;

    public BootstrapController(WorkspaceService workspaceService, RoomService roomService, FileService fileService) {
        this.workspaceService = workspaceService;
        this.roomService = roomService;
        this.fileService = fileService;
    }

    @PostMapping
    public BootstrapResponse createDemoRoom() {
        WorkspaceDto workspace = workspaceService.createWorkspace("pearprogram-demo");
        RoomDto room = roomService.createRoom(workspace.id());
        return new BootstrapResponse(workspace, room, fileService.listFiles(workspace.id()));
    }
}
