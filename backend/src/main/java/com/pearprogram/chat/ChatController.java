package com.pearprogram.chat;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/rooms/{code}/chat")
public class ChatController {

    @GetMapping
    public List<ChatMessageDto> history(@PathVariable String code) {
        // Chat messages are no longer persisted; return empty list.
        return List.of();
    }
}
