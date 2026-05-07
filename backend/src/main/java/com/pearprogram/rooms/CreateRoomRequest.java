package com.pearprogram.rooms;

import java.util.UUID;

public record CreateRoomRequest(UUID workspaceId, String sessionId, String displayName) {
}
