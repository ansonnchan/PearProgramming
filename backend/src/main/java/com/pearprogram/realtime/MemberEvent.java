package com.pearprogram.realtime;

import java.time.OffsetDateTime;

public record MemberEvent(
        String type,
        String userId,
        String sessionId,
        String connectionId,
        String displayName,
        String color,
        String avatarUrl,
        String leadUserId,
        String targetUserId,
        String targetUserName,
        Boolean locked,
        OffsetDateTime at
) {
}
