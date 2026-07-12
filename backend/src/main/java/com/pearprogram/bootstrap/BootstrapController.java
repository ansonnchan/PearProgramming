package com.pearprogram.bootstrap;

import com.pearprogram.auth.GuestIdentityService;
import com.pearprogram.auth.GuestPrincipal;
import com.pearprogram.files.FileService;
import com.pearprogram.rooms.RoomCreateResponse;
import com.pearprogram.rooms.RoomService;
import com.pearprogram.workspaces.WorkspaceDto;
import com.pearprogram.workspaces.WorkspaceService;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.security.core.Authentication;

@RestController
@RequestMapping("/api/bootstrap")
public class BootstrapController {
    private final WorkspaceService workspaceService;
    private final RoomService roomService;
    private final FileService fileService;
    private final GuestIdentityService identities;

    public BootstrapController(WorkspaceService workspaceService, RoomService roomService, FileService fileService,
                               GuestIdentityService identities) {
        this.workspaceService = workspaceService;
        this.roomService = roomService;
        this.fileService = fileService;
        this.identities = identities;
    }

    @PostMapping
    public BootstrapResponse createDemoRoom(Authentication authentication) {
        GuestPrincipal principal = identities.requirePrincipal(authentication);
        RoomCreateResponse room = roomService.createRoom(principal.id(), principal.displayName());
        WorkspaceDto workspace = workspaceService.getWorkspace(room.workspaceId(), principal.id());
        return new BootstrapResponse(workspace, roomService.getRoom(room.code()), fileService.listFiles(workspace.id()));
    }
}
