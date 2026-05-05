package com.pearprogram.rooms;

public record RoomAccessDto(
        boolean canJoin,
        String reason,
        boolean locked,
        int memberCount,
        int maxUsers,
        String leadUserId
) {
}
