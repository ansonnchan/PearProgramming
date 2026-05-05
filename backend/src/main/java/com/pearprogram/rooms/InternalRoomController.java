package com.pearprogram.rooms;

import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/internal/rooms")
public class InternalRoomController {
    private final RoomService roomService;

    public InternalRoomController(RoomService roomService) {
        this.roomService = roomService;
    }

    @PostMapping("/{code}/cleanup")
    public RoomCleanupDto cleanup(@PathVariable String code) {
        return roomService.cleanupIfEmpty(code);
    }
}
