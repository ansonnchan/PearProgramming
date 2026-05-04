package com.pearprogram.files;

public record SnapshotRequest(String roomCode, String encodedState, String plainText) {
}
