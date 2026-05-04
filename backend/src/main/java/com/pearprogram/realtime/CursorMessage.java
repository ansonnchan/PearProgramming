package com.pearprogram.realtime;

public record CursorMessage(
        String userId,
        String displayName,
        String fileId,
        int line,
        int col,
        String color,
        long sentAt
) {
}
