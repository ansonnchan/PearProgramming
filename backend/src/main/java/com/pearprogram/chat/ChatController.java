package com.pearprogram.chat;

import com.pearprogram.auth.GuestIdentityService;
import com.pearprogram.rooms.RoomService;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/rooms/{code}/chat")
public class ChatController {
    private final RoomService roomService;
    private final GuestIdentityService identities;

    public ChatController(RoomService roomService, GuestIdentityService identities) {
        this.roomService = roomService;
        this.identities = identities;
    }

    @GetMapping
    public List<ChatMessageDto> history(@PathVariable String code, Authentication authentication) {
        roomService.requireActiveMember(code, identities.requirePrincipal(authentication).id());
        // Chat messages are no longer persisted; return empty list.
        return List.of();
    }
}
