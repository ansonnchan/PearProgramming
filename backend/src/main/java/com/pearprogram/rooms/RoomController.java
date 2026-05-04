package com.pearprogram.rooms;

import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/rooms")
public class RoomController {
    private final RoomService roomService;

    public RoomController(RoomService roomService) {
        this.roomService = roomService;
    }

    @PostMapping
    public RoomDto create(@Valid @RequestBody CreateRoomRequest request) {
        return roomService.createRoom(request.workspaceId());
    }

    @GetMapping("/{code}")
    public RoomDto getByCode(@PathVariable String code) {
        return roomService.getRoom(code);
    }
}
