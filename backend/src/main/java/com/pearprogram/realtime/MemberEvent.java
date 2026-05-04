package com.pearprogram.realtime;

import java.time.OffsetDateTime;

public record MemberEvent(String type, String userId, String displayName, String color, OffsetDateTime at) {
}
