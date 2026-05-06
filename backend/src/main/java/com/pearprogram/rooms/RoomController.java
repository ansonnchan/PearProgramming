package com.pearprogram.rooms;

import jakarta.validation.Valid;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/rooms")
public class RoomController {
    private static final Logger log = LoggerFactory.getLogger(RoomController.class);

    private final RoomService roomService;

    public RoomController(RoomService roomService) {
        this.roomService = roomService;
    }

    @PostMapping("/create")
    public RoomCreateResponse create() {
        log.info("Create room request received");
        return roomService.createRoom();
    }

    @PostMapping
    public RoomCreateResponse createLegacy() {
        log.info("Legacy create room request received");
        return roomService.createRoom();
    }

    @PostMapping("/join")
    public RoomJoinResponse join(@Valid @RequestBody JoinRoomRequest request) {
        log.info("Join room request received for code={}", request.code());
        return roomService.joinRoom(request.code());
    }

    @GetMapping("/{code}")
    public RoomDto getByCode(@PathVariable String code) {
        log.info("Get room request for code={}", code);
        return roomService.getRoom(code);
    }

    @GetMapping("/{code}/access")
    public RoomAccessDto access(@PathVariable String code) {
        log.info("Room access request for code={}", code);
        return roomService.getRoomAccess(code, null);
    }
}
