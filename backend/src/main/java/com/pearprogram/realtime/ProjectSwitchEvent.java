package com.pearprogram.realtime;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;

public record ProjectSwitchEvent(
        String type,
        String proposalId,
        String currentFolder,
        String newFolder,
        String proposerId,
        String proposerName,
        String voterId,
        String voterName,
        List<String> requiredUserIds,
        List<String> approvedUserIds,
        List<Map<String, Object>> files,
        OffsetDateTime at
) {
}
