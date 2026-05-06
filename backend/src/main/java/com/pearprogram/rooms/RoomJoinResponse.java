package com.pearprogram.rooms;

public record RoomJoinResponse(
        String code,
        String displayName,
        String cursorColor,
        int memberCount,
        int maxUsers
) {
}