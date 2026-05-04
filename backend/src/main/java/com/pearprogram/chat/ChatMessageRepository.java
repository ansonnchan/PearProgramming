package com.pearprogram.chat;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface ChatMessageRepository extends JpaRepository<ChatMessage, UUID> {
    List<ChatMessage> findTop20ByRoom_CodeOrderByCreatedAtDesc(String roomCode);
}
