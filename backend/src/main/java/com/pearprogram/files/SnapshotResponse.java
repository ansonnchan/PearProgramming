package com.pearprogram.files;

import java.util.UUID;

public record SnapshotResponse(UUID fileId, String encodedState, String plainText) {
}
