package com.pearprogram.rooms;

import com.pearprogram.files.FileDto;
import com.pearprogram.files.FileService;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Service
public class RoomProjectStateService {
    private final RoomRepository rooms;
    private final FileService files;

    public RoomProjectStateService(RoomRepository rooms, FileService files) {
        this.rooms = rooms;
        this.files = files;
    }

    @Transactional(readOnly = true)
    public List<Map<String, Object>> getFiles(String roomCode) {
        RoomEntity room = requireRoom(roomCode);
        return files.listFiles(room.getWorkspaceId()).stream().map(this::toMap).toList();
    }

    @Transactional
    public List<Map<String, Object>> saveFiles(String roomCode, List<Map<String, Object>> incoming) {
        RoomEntity room = requireRoom(roomCode);
        return files.synchronizeWorkspace(room.getWorkspaceId(), incoming, true).stream().map(this::toMap).toList();
    }

    @Transactional
    public List<Map<String, Object>> upsertFiles(String roomCode, List<Map<String, Object>> incoming) {
        RoomEntity room = requireRoom(roomCode);
        return files.synchronizeWorkspace(room.getWorkspaceId(), incoming, false).stream().map(this::toMap).toList();
    }

    private RoomEntity requireRoom(String code) {
        return rooms.findByCodeAndActiveTrue(code)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Room not found"));
    }

    private Map<String, Object> toMap(FileDto file) {
        Map<String, Object> value = new LinkedHashMap<>();
        value.put("id", file.id().toString());
        value.put("workspaceId", file.workspaceId().toString());
        value.put("path", file.path());
        value.put("language", file.language());
        value.put("content", file.content());
        value.put("createdAt", file.createdAt().toString());
        value.put("updatedAt", file.updatedAt().toString());
        return value;
    }
}
