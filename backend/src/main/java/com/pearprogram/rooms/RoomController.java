package com.pearprogram.rooms;

import com.pearprogram.auth.GuestIdentityService;
import com.pearprogram.auth.GuestPrincipal;
import jakarta.validation.Valid;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.security.core.Authentication;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/rooms")
public class RoomController {
    private static final Logger log = LoggerFactory.getLogger(RoomController.class);

    private final RoomService roomService;
    private final GuestIdentityService identities;

    public RoomController(RoomService roomService, GuestIdentityService identities) {
        this.roomService = roomService;
        this.identities = identities;
    }

    @PostMapping("/create")
    public RoomCreateResponse create(@RequestBody(required = false) CreateRoomRequest request, Authentication authentication) {
        log.info("Create room request received");
        GuestPrincipal principal = identities.requirePrincipal(authentication);
        return roomService.createRoom(principal.id(), principal.displayName());
    }

    @PostMapping
    public RoomCreateResponse createLegacy(@RequestBody(required = false) CreateRoomRequest request, Authentication authentication) {
        log.info("Legacy create room request received");
        GuestPrincipal principal = identities.requirePrincipal(authentication);
        return roomService.createRoom(principal.id(), principal.displayName());
    }

    @PostMapping("/join")
    public RoomJoinResponse join(@Valid @RequestBody JoinRoomRequest request, Authentication authentication) {
        log.info("Join room request received for code={}", request.code());
        GuestPrincipal principal = identities.requirePrincipal(authentication);
        return roomService.joinRoom(request.code(), principal.id(), principal.displayName());
    }

    @GetMapping("/{code}")
    public RoomDto getByCode(@PathVariable String code, Authentication authentication) {
        log.info("Get room request for code={}", code);
        roomService.requireDurableMember(code, identities.requirePrincipal(authentication).id());
        return roomService.getRoom(code);
    }

    @GetMapping("/{code}/access")
    public RoomAccessDto access(@PathVariable String code, Authentication authentication) {
        GuestPrincipal principal = identities.requirePrincipal(authentication);
        log.info("Room access request for code={}, userId={}", code, principal.id());
        return roomService.getRoomAccess(code, principal.id(), principal.displayName());
    }

    @GetMapping("/{code}/files")
    public List<Map<String, Object>> files(@PathVariable String code, Authentication authentication) {
        log.info("Room files request for code={}", code);
        roomService.requireDurableMember(code, identities.requirePrincipal(authentication).id());
        return roomService.getRoomFiles(code);
    }

    @PutMapping("/{code}/files")
    public List<Map<String, Object>> saveFiles(@PathVariable String code, @RequestBody RoomFilesRequest request, Authentication authentication) {
        int count = request == null || request.files() == null ? 0 : request.files().size();
        log.info("Save room files request for code={} count={}", code, count);
        roomService.requireDurableMember(code, identities.requirePrincipal(authentication).id());
        return roomService.saveRoomFiles(code, request == null ? List.of() : request.files());
    }
}
