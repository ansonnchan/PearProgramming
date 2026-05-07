package com.pearprogram.realtime;

import com.pearprogram.ai.AiParticipantService;
import com.pearprogram.ai.AiAnnotationDto;
import com.pearprogram.ai.AiAnnotationService;
import com.pearprogram.rooms.EphemeralRoomStateService;
import com.pearprogram.rooms.RoomAccessDto;
import com.pearprogram.rooms.RoomService;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import org.springframework.http.HttpStatus;
import org.springframework.lang.Nullable;
import org.springframework.messaging.handler.annotation.DestinationVariable;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.stereotype.Controller;
import org.springframework.web.server.ResponseStatusException;

import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.UUID;

@Controller
public class RoomEventController {
    private final RealtimeBroadcastService broadcastService;
    private final RoomService roomService;
    private final EphemeralRoomStateService roomStateService;
    private final AiParticipantService aiParticipantService;
    private final AiAnnotationService aiAnnotationService;
    private final MeterRegistry meterRegistry;

    public RoomEventController(
            RealtimeBroadcastService broadcastService,
            RoomService roomService,
            EphemeralRoomStateService roomStateService,
            AiParticipantService aiParticipantService,
            AiAnnotationService aiAnnotationService,
            @Nullable MeterRegistry meterRegistry
    ) {
        this.broadcastService = broadcastService;
        this.roomService = roomService;
        this.roomStateService = roomStateService;
        this.aiParticipantService = aiParticipantService;
        this.aiAnnotationService = aiAnnotationService;
        this.meterRegistry = meterRegistry;
    }

    @MessageMapping("/room/{code}/chat")
    public void chat(@DestinationVariable String code, ChatInboundMessage inbound) {
        if (!roomStateService.roomExists(code)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Room not found");
        }

        incrementChatRate(code);
        broadcastService.broadcast("/topic/room/" + code + "/chat", new ChatOutboundMessage(
            java.util.UUID.randomUUID(),
                inbound.userId(),
                inbound.displayName() == null || inbound.displayName().isBlank() ? "Guest" : inbound.displayName(),
            inbound.content(),
                false,
            OffsetDateTime.now()
        ));

        if (inbound.content() != null && inbound.content().toUpperCase().contains("@AI")) {
            broadcastService.broadcast("/topic/room/" + code + "/chat", new ChatOutboundMessage(
                java.util.UUID.randomUUID(),
                    null,
                    "AI",
                aiParticipantService.chatResponse(
                    inbound.displayName(),
                    inbound.currentFile(),
                    inbound.content(),
                    inbound.currentLine(),
                    inbound.currentFileContent()
                ),
                    true,
                OffsetDateTime.now()
            ));
            if (aiParticipantService.usesPlaceholderResponses()) {
            maybeCreatePlaceholderAnnotation(code, inbound);
            }
        }
    }

    @MessageMapping("/room/{code}/cursors")
    public void cursor(@DestinationVariable String code, CursorMessage cursor) {
        broadcastService.broadcast("/topic/room/" + code + "/cursors", cursor);
    }

    @MessageMapping("/room/{code}/members")
    public void member(@DestinationVariable String code, MemberEvent event) {
        MemberEvent outbound = event;
        MemberEvent followUp = null;
        if ("joined".equals(event.type())) {
            roomStateService.joinRoom(code, event.sessionId(), event.connectionId(), event.displayName(), event.color());
            RoomAccessDto access = roomStateService.roomAccess(code, event.sessionId(), event.displayName());
            if (access.leadUserId() == null || access.leadUserId().isBlank()) {
                access = roomStateService.transferLead(code, event.userId());
            }
            outbound = withRoomState(event, access);
            roomService.cancelCleanup(code);
        } else if ("presence-sync".equals(event.type())) {
            roomStateService.joinRoom(code, event.sessionId(), event.connectionId(), event.displayName(), event.color());
            outbound = withRoomState(event, roomStateService.roomAccess(code, event.sessionId(), event.displayName()));
        } else if ("left".equals(event.type())) {
            String previousLeadUserId = roomStateService.getLeadUserId(code);
            RoomAccessDto state = roomStateService.leaveRoom(code, event.sessionId(), event.connectionId(), event.displayName());
            outbound = withRoomState(event, state);
            if (state.memberCount() == 0) {
                roomService.scheduleCleanupIfEmpty(code);
            } else if (event.userId() != null && event.userId().equals(previousLeadUserId)) {
                java.util.Optional<EphemeralRoomStateService.ActiveMember> nextLead =
                        roomStateService.firstActiveMemberExcept(code, event.userId());
                if (nextLead.isPresent()) {
                    EphemeralRoomStateService.ActiveMember candidate = nextLead.get();
                    RoomAccessDto transferred = roomStateService.transferLead(code, candidate.userId());
                    outbound = withRoomState(event, transferred);
                    followUp = withRoomState(new MemberEvent(
                            "lead-transferred",
                            event.userId(),
                            event.sessionId(),
                            event.connectionId(),
                            event.displayName(),
                            event.color(),
                            event.avatarUrl(),
                            candidate.userId(),
                            candidate.userId(),
                            candidate.displayName(),
                            transferred.locked(),
                            event.at()
                    ), transferred);
                }
            }
        } else if ("lead-transferred".equals(event.type())) {
            String nextLead = event.leadUserId() == null || event.leadUserId().isBlank()
                    ? event.targetUserId()
                    : event.leadUserId();
            outbound = withRoomState(event, roomStateService.transferLead(code, nextLead));
        } else if ("lead-removed".equals(event.type())) {
            outbound = withRoomState(event, roomStateService.transferLead(code, null));
        } else if ("lock-changed".equals(event.type()) && event.locked() != null) {
            outbound = withRoomState(event, roomStateService.setLocked(code, event.userId(), event.locked()));
        } else if ("room-closed".equals(event.type())) {
            roomService.closeRoom(code);
        } else {
            outbound = withRoomState(event, roomStateService.roomAccess(code, event.sessionId(), event.displayName()));
        }
        broadcastService.broadcast("/topic/room/" + code + "/members", outbound);
        if (followUp != null) {
            broadcastService.broadcast("/topic/room/" + code + "/members", followUp);
        }
    }

    @MessageMapping("/room/{code}/project-switch")
    public void projectSwitch(@DestinationVariable String code, ProjectSwitchEvent event) {
        if (event.files() != null && ("accepted".equals(event.type()) || "sync".equals(event.type()) || "files-updated".equals(event.type()))) {
            roomService.saveRoomFiles(code, event.files());
        }
        broadcastService.broadcast("/topic/room/" + code + "/project-switch", event);
    }

    @MessageMapping("/room/{code}/ping")
    public void ping(@DestinationVariable String code, PingMessage ping) {
        long now = System.currentTimeMillis();
        if (meterRegistry != null && ping.sentAt() > 0 && ping.sentAt() <= now) {
            Timer.builder("ws_latency_ms")
                    .description("WebSocket round-trip time measured from STOMP ping/pong")
                    .tag("room", code)
                    .register(meterRegistry)
                    .record(Duration.ofMillis(now - ping.sentAt()));
        }
        broadcastService.sendLocal("/topic/room/" + code + "/pong", new PongMessage(ping.sentAt(), now));
    }

    private void incrementChatRate(String code) {
        if (meterRegistry != null) {
            Counter.builder("chat_messages_per_sec")
                    .description("Rate of chat messages per room")
                    .tag("room", code)
                    .register(meterRegistry)
                    .increment();
        }
    }

    private void maybeCreatePlaceholderAnnotation(String roomCode, ChatInboundMessage inbound) {
        if (inbound.currentFileId() == null || inbound.currentFileId().isBlank()) {
            return;
        }

        try {
            UUID fileId = UUID.fromString(inbound.currentFileId());
            int line = inbound.currentLine() == null || inbound.currentLine() < 1 ? 1 : inbound.currentLine();
            AiAnnotationDto annotation = aiAnnotationService.createPlaceholderAnnotation(
                    roomCode,
                    fileId,
                    line,
                    inbound.displayName()
            );
            if (annotation != null) {
                broadcastService.broadcast("/topic/room/" + roomCode + "/annotations", annotation);
            }
        } catch (IllegalArgumentException ignored) {
            // Local fallback file ids are not UUIDs, so the frontend handles placeholder annotations itself.
        }
    }

    private MemberEvent withRoomState(MemberEvent event, RoomAccessDto state) {
        return new MemberEvent(
                event.type(),
                event.userId(),
                event.sessionId(),
                event.connectionId(),
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
