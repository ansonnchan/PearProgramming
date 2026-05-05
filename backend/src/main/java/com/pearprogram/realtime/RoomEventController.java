package com.pearprogram.realtime;

import com.pearprogram.ai.AiParticipantService;
import com.pearprogram.ai.AiAnnotationDto;
import com.pearprogram.ai.AiAnnotationService;
import com.pearprogram.chat.ChatMessage;
import com.pearprogram.chat.ChatMessageRepository;
import com.pearprogram.rooms.EphemeralRoomStateService;
import com.pearprogram.rooms.Room;
import com.pearprogram.rooms.RoomAccessDto;
import com.pearprogram.rooms.RoomRepository;
import com.pearprogram.rooms.RoomService;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import org.springframework.http.HttpStatus;
import org.springframework.messaging.handler.annotation.DestinationVariable;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Controller;
import org.springframework.web.server.ResponseStatusException;

import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.UUID;

@Controller
public class RoomEventController {
    private final SimpMessagingTemplate messagingTemplate;
    private final RoomRepository roomRepository;
    private final RoomService roomService;
    private final EphemeralRoomStateService roomStateService;
    private final ChatMessageRepository chatMessageRepository;
    private final AiParticipantService aiParticipantService;
    private final AiAnnotationService aiAnnotationService;
    private final MeterRegistry meterRegistry;

    public RoomEventController(
            SimpMessagingTemplate messagingTemplate,
            RoomRepository roomRepository,
            RoomService roomService,
            EphemeralRoomStateService roomStateService,
            ChatMessageRepository chatMessageRepository,
            AiParticipantService aiParticipantService,
            AiAnnotationService aiAnnotationService,
            MeterRegistry meterRegistry
    ) {
        this.messagingTemplate = messagingTemplate;
        this.roomRepository = roomRepository;
        this.roomService = roomService;
        this.roomStateService = roomStateService;
        this.chatMessageRepository = chatMessageRepository;
        this.aiParticipantService = aiParticipantService;
        this.aiAnnotationService = aiAnnotationService;
        this.meterRegistry = meterRegistry;
    }

    @MessageMapping("/room/{code}/chat")
    public void chat(@DestinationVariable String code, ChatInboundMessage inbound) {
        Room room = roomRepository.findByCode(code)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Room not found"));

        ChatMessage saved = persistChat(room, inbound.content(), false);
        incrementChatRate(code);
        messagingTemplate.convertAndSend("/topic/room/" + code + "/chat", new ChatOutboundMessage(
                saved.getId(),
                inbound.userId(),
                inbound.displayName() == null || inbound.displayName().isBlank() ? "Guest" : inbound.displayName(),
                saved.getContent(),
                false,
                saved.getCreatedAt()
        ));

        if (inbound.content() != null && inbound.content().toUpperCase().contains("@AI")) {
            ChatMessage aiMessage = persistChat(room, aiParticipantService.chatResponse(
                    inbound.displayName(),
                    inbound.currentFile(),
                    inbound.content(),
                    inbound.currentLine()
            ), true);
            messagingTemplate.convertAndSend("/topic/room/" + code + "/chat", new ChatOutboundMessage(
                    aiMessage.getId(),
                    null,
                    "AI",
                    aiMessage.getContent(),
                    true,
                    aiMessage.getCreatedAt()
            ));
            if (aiParticipantService.usesPlaceholderResponses()) {
                maybeCreatePlaceholderAnnotation(room, inbound);
            }
        }
    }

    @MessageMapping("/room/{code}/cursors")
    public void cursor(@DestinationVariable String code, CursorMessage cursor) {
        messagingTemplate.convertAndSend("/topic/room/" + code + "/cursors", cursor);
    }

    @MessageMapping("/room/{code}/members")
    public void member(@DestinationVariable String code, MemberEvent event) {
        MemberEvent outbound = event;
        if ("joined".equals(event.type())) {
            outbound = withRoomState(event, roomStateService.joinRoom(code, event.userId()));
            roomService.cancelCleanup(code);
        } else if ("left".equals(event.type())) {
            RoomAccessDto state = roomStateService.leaveRoom(code, event.userId());
            outbound = withRoomState(event, state);
            if (state.memberCount() == 0) {
                roomService.scheduleCleanupIfEmpty(code);
            }
        } else if ("lead-transferred".equals(event.type())) {
            String nextLead = event.leadUserId() == null || event.leadUserId().isBlank()
                    ? event.targetUserId()
                    : event.leadUserId();
            outbound = withRoomState(event, roomStateService.transferLead(code, nextLead));
        } else if ("lock-changed".equals(event.type()) && event.locked() != null) {
            outbound = withRoomState(event, roomStateService.setLocked(code, event.userId(), event.locked()));
        } else if ("room-closed".equals(event.type())) {
            roomService.closeRoom(code);
        } else {
            outbound = withRoomState(event, roomStateService.roomAccess(code, event.userId()));
        }
        messagingTemplate.convertAndSend("/topic/room/" + code + "/members", outbound);
    }

    @MessageMapping("/room/{code}/project-switch")
    public void projectSwitch(@DestinationVariable String code, ProjectSwitchEvent event) {
        messagingTemplate.convertAndSend("/topic/room/" + code + "/project-switch", event);
    }

    @MessageMapping("/room/{code}/ping")
    public void ping(@DestinationVariable String code, PingMessage ping) {
        long now = System.currentTimeMillis();
        if (ping.sentAt() > 0 && ping.sentAt() <= now) {
            Timer.builder("ws_latency_ms")
                    .description("WebSocket round-trip time measured from STOMP ping/pong")
                    .tag("room", code)
                    .register(meterRegistry)
                    .record(Duration.ofMillis(now - ping.sentAt()));
        }
        messagingTemplate.convertAndSend("/topic/room/" + code + "/pong", new PongMessage(ping.sentAt(), now));
    }

    private ChatMessage persistChat(Room room, String content, boolean ai) {
        ChatMessage message = new ChatMessage();
        message.setRoom(room);
        message.setContent(content == null ? "" : content);
        message.setAi(ai);
        message.setCreatedAt(OffsetDateTime.now());
        return chatMessageRepository.save(message);
    }

    private void incrementChatRate(String code) {
        Counter.builder("chat_messages_per_sec")
                .description("Rate of chat messages per room")
                .tag("room", code)
                .register(meterRegistry)
                .increment();
    }

    private void maybeCreatePlaceholderAnnotation(Room room, ChatInboundMessage inbound) {
        if (inbound.currentFileId() == null || inbound.currentFileId().isBlank()) {
            return;
        }

        try {
            UUID fileId = UUID.fromString(inbound.currentFileId());
            int line = inbound.currentLine() == null || inbound.currentLine() < 1 ? 1 : inbound.currentLine();
            AiAnnotationDto annotation = aiAnnotationService.createPlaceholderAnnotation(
                    room,
                    fileId,
                    line,
                    inbound.displayName()
            );
            if (annotation != null) {
                messagingTemplate.convertAndSend("/topic/room/" + room.getCode() + "/annotations", annotation);
            }
        } catch (IllegalArgumentException ignored) {
            // Local fallback file ids are not UUIDs, so the frontend handles placeholder annotations itself.
        }
    }

    private MemberEvent withRoomState(MemberEvent event, RoomAccessDto state) {
        return new MemberEvent(
                event.type(),
                event.userId(),
                event.displayName(),
                event.color(),
                event.avatarUrl(),
                state.leadUserId(),
                event.targetUserId(),
                event.targetUserName(),
                state.locked(),
                event.at()
        );
    }
}
