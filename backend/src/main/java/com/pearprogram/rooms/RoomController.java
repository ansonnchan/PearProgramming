package com.pearprogram.rooms;

import jakarta.validation.Valid;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/rooms")
public class RoomController {
    private final RoomService roomService;
    private static final Logger log = LoggerFactory.getLogger(RoomController.class);

    public RoomController(RoomService roomService) {
        this.roomService = roomService;
    }

    @PostMapping
    public RoomDto create(@Valid @RequestBody CreateRoomRequest request) {
        log.info("Create room request received for workspaceId={}", request.workspaceId());
        RoomDto dto = roomService.createRoom(request.workspaceId());
        log.info("Created room {} for workspace {}", dto.code(), dto.workspaceId());
        return dto;
    }

    @GetMapping("/{code}")
    public RoomDto getByCode(@PathVariable String code) {
        log.info("Get room request for code={}", code);
        RoomDto dto = roomService.getRoom(code);
        log.info("Returning room {} (workspace={})", dto.code(), dto.workspaceId());
        return dto;
    }

    @GetMapping("/{code}/access")
    public RoomAccessDto access(@PathVariable String code, @RequestParam(required = false) String userId) {
        log.info("Room access request for code={} userId={}", code, userId);
        RoomAccessDto access = roomService.getRoomAccess(code, userId);
        log.info("Access for code={} userId={} -> canJoin={} reason={}", code, userId, access.canJoin(), access.reason());
        return access;
    }
}
