package com.pearprogram.rooms;

import jakarta.validation.constraints.NotNull;

import java.util.UUID;

public record CreateRoomRequest(@NotNull UUID workspaceId) {
}
