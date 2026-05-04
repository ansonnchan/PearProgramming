package com.pearprogram.bootstrap;

import com.pearprogram.files.FileDto;
import com.pearprogram.rooms.RoomDto;
import com.pearprogram.workspaces.WorkspaceDto;

import java.util.List;

public record BootstrapResponse(WorkspaceDto workspace, RoomDto room, List<FileDto> files) {
}
