package com.pearprogram.realtime;

public record ChatInboundMessage(
        String userId,
        String displayName,
        String content,
        String currentFileId,
        String currentFile,
        Integer currentLine,
        String currentFileContent
) {
}
