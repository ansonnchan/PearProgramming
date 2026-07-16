package com.pearprogram.realtime;

import com.pearprogram.auth.GuestPrincipal;
import com.pearprogram.ai.AiParticipantService;
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
import org.springframework.messaging.handler.annotation.Header;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Controller;
import org.springframework.web.server.ResponseStatusException;

import java.time.Duration;
import java.time.OffsetDateTime;
import java.security.Principal;

@Controller
public class RoomEventController {
    private final RealtimeBroadcastService broadcastService;
    private final RoomService roomService;
    private final EphemeralRoomStateService roomStateService;
    private final RoomPresenceEventService presenceEvents;
    private final AiParticipantService aiParticipantService;
    private final MeterRegistry meterRegistry;

    public RoomEventController(
            RealtimeBroadcastService broadcastService,
            RoomService roomService,
            EphemeralRoomStateService roomStateService,
            RoomPresenceEventService presenceEvents,
            AiParticipantService aiParticipantService,
            @Nullable MeterRegistry meterRegistry
    ) {
        this.broadcastService = broadcastService;
        this.roomService = roomService;
        this.roomStateService = roomStateService;
        this.presenceEvents = presenceEvents;
        this.aiParticipantService = aiParticipantService;
        this.meterRegistry = meterRegistry;
    }

    @MessageMapping("/room/{code}/chat")
    public void chat(@DestinationVariable String code, ChatInboundMessage inbound, Principal authentication) {
        if (!roomStateService.roomExists(code)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Room not found");
        }

        GuestPrincipal principal = principal(authentication);
        incrementChatRate(code);
        broadcastService.broadcast("/topic/room/" + code + "/chat", new ChatOutboundMessage(
            java.util.UUID.randomUUID(),
                principal.id(),
                principal.displayName(),
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
                    principal.displayName(),
                    inbound.currentFile(),
                    inbound.content(),
                    inbound.currentLine(),
                    inbound.currentFileContent()
                ),
                    true,
                OffsetDateTime.now()
            ));
        }
    }

    @MessageMapping("/room/{code}/cursors")
    public void cursor(@DestinationVariable String code, CursorMessage cursor, Principal authentication) {
        GuestPrincipal principal = principal(authentication);
        broadcastService.broadcast("/topic/room/" + code + "/cursors", new CursorMessage(
                principal.id(),
                principal.displayName(),
                cursor.fileId(),
                cursor.line(),
                cursor.col(),
                cursor.color(),
                cursor.sentAt()
        ));
    }

    @MessageMapping("/room/{code}/members")
    public void member(@DestinationVariable String code, MemberEvent inbound,
                       @Header("simpSessionId") String connectionId, Principal authentication) {
        GuestPrincipal principal = principal(authentication);
        MemberEvent event = trustedMemberEvent(code, inbound, principal, connectionId);
        MemberEvent outbound = event;
        MemberEvent followUp = null;
        boolean publishSnapshot = false;
        if ("joined".equals(event.type())) {
            roomStateService.joinRoom(code, event.sessionId(), event.connectionId(), event.displayName(), event.color());
            RoomAccessDto access = roomStateService.roomAccess(code, event.sessionId(), event.displayName());
            if (access.leadUserId() == null || access.leadUserId().isBlank()) {
                access = roomStateService.transferLead(code, event.userId());
            }
            outbound = withRoomState(event, access);
            presenceEvents.register(code, outbound);
            publishSnapshot = true;
        } else if ("presence-sync".equals(event.type())) {
            roomStateService.joinRoom(code, event.sessionId(), event.connectionId(), event.displayName(), event.color());
            outbound = withRoomState(event, roomStateService.roomAccess(code, event.sessionId(), event.displayName()));
            presenceEvents.register(code, outbound);
            publishSnapshot = true;
        } else if ("left".equals(event.type())) {
            presenceEvents.depart(new RoomConnectionRegistry.ConnectionPresence(
                    code,
                    event.userId(),
                    event.connectionId(),
                    event.displayName(),
                    event.color(),
                    event.avatarUrl()
            ));
            return;
        } else if ("lead-transferred".equals(event.type())) {
            requireLead(code, principal.id());
            String nextLead = event.leadUserId() == null || event.leadUserId().isBlank()
                    ? event.targetUserId()
                    : event.leadUserId();
            if (nextLead == null || roomStateService.activeMember(code, nextLead).isEmpty()) {
                throw new AccessDeniedException("New lead must be an active room member");
            }
            outbound = withRoomState(event, roomStateService.transferLead(code, nextLead));
        } else if ("lead-removed".equals(event.type())) {
            requireLead(code, principal.id());
            outbound = withRoomState(event, roomStateService.transferLead(code, null));
        } else if ("lock-changed".equals(event.type()) && event.locked() != null) {
            requireLead(code, principal.id());
            outbound = withRoomState(event, roomStateService.setLocked(code, event.userId(), event.locked()));
        } else if ("room-closed".equals(event.type())) {
            requireLead(code, principal.id());
            roomService.closeRoom(code);
        } else if ("lead-sync".equals(event.type())) {
            requireLead(code, principal.id());
            outbound = withRoomState(event, roomStateService.roomAccess(code, principal.id(), principal.displayName()));
        } else {
            outbound = withRoomState(event, roomStateService.roomAccess(code, event.sessionId(), event.displayName()));
        }
        broadcastService.broadcast("/topic/room/" + code + "/members", outbound);
        if (followUp != null) {
            broadcastService.broadcast("/topic/room/" + code + "/members", followUp);
        }
        if (publishSnapshot) {
            presenceEvents.broadcastSnapshot(code, event.userId(), event.connectionId());
        }
    }

    @MessageMapping("/room/{code}/project-switch")
    public void projectSwitch(@DestinationVariable String code, ProjectSwitchEvent inbound, Principal authentication) {
        GuestPrincipal principal = principal(authentication);
        ProjectSwitchEvent event = trustedProjectSwitchEvent(inbound, principal);
        if (event.files() != null && "file-content-updated".equals(event.type())) {
            roomService.upsertRoomFiles(code, event.files());
        } else if (event.files() != null && ("accepted".equals(event.type()) || "sync".equals(event.type()) || "files-updated".equals(event.type()))) {
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
                event.at(),
                event.members(),
                event.presenceVersion()
        );
    }

    private GuestPrincipal principal(Principal principal) {
        if (principal instanceof Authentication authentication
                && authentication.getPrincipal() instanceof GuestPrincipal guestPrincipal) {
            return guestPrincipal;
        }
        throw new AccessDeniedException("Authenticated guest principal required");
    }

    private void requireLead(String code, String userId) {
        if (!userId.equals(roomStateService.getLeadUserId(code))) {
            throw new AccessDeniedException("Lead Pear permission required");
        }
    }

    private MemberEvent trustedMemberEvent(String code, MemberEvent event, GuestPrincipal principal, String connectionId) {
        String targetName = event.targetUserId() == null
                ? null
                : roomStateService.activeMember(code, event.targetUserId())
                        .map(EphemeralRoomStateService.ActiveMember::displayName)
                        .orElse(null);
        return new MemberEvent(
                event.type(),
                principal.id(),
                principal.id(),
                connectionId,
                principal.displayName(),
                event.color(),
                principal.avatarUrl(),
                event.leadUserId(),
                event.targetUserId(),
                targetName,
                event.locked(),
                OffsetDateTime.now(),
                null,
                null
        );
    }

    private ProjectSwitchEvent trustedProjectSwitchEvent(ProjectSwitchEvent event, GuestPrincipal principal) {
        boolean vote = "vote".equals(event.type()) || "declined".equals(event.type());
        return new ProjectSwitchEvent(
                event.type(),
                event.proposalId(),
                event.currentFolder(),
                event.newFolder(),
                principal.id(),
                principal.displayName(),
                event.targetUserId(),
                vote ? principal.id() : event.voterId(),
                vote ? principal.displayName() : event.voterName(),
                event.requiredUserIds(),
                event.approvedUserIds(),
                event.replaceExisting(),
                event.openUploaded(),
                event.files(),
                event.at()
        );
    }
}
