package com.pearprogram.realtime;

import com.pearprogram.rooms.EphemeralRoomStateService;
import com.pearprogram.rooms.RoomAccessDto;
import com.pearprogram.rooms.RoomService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.time.OffsetDateTime;

@Service
public class RoomPresenceEventService {
    private static final Logger log = LoggerFactory.getLogger(RoomPresenceEventService.class);

    private final RealtimeBroadcastService broadcasts;
    private final RoomService rooms;
    private final EphemeralRoomStateService state;
    private final RoomConnectionRegistry connections;

    public RoomPresenceEventService(
            RealtimeBroadcastService broadcasts,
            RoomService rooms,
            EphemeralRoomStateService state,
            RoomConnectionRegistry connections
    ) {
        this.broadcasts = broadcasts;
        this.rooms = rooms;
        this.state = state;
        this.connections = connections;
    }

    public void register(String roomCode, MemberEvent event) {
        connections.register(new RoomConnectionRegistry.ConnectionPresence(
                roomCode,
                event.userId(),
                event.connectionId(),
                event.displayName(),
                event.color(),
                event.avatarUrl()
        ));
        rooms.cancelCleanup(roomCode);
        log.info("Room presence connection registered room={} connectionId={} userId={}",
                roomCode, event.connectionId(), event.userId());
    }

    public void disconnect(String connectionId) {
        connections.remove(connectionId).ifPresent(this::depart);
    }

    public void depart(RoomConnectionRegistry.ConnectionPresence presence) {
        connections.remove(presence.connectionId());
        String previousLeadUserId = state.getLeadUserId(presence.roomCode());
        RoomAccessDto roomState = state.leaveRoom(
                presence.roomCode(),
                presence.userId(),
                presence.connectionId(),
                presence.displayName()
        );
        boolean userStillActive = state.activeMember(presence.roomCode(), presence.userId()).isPresent();

        if (!userStillActive) {
            broadcasts.broadcast(topic(presence.roomCode()), new MemberEvent(
                    "left",
                    presence.userId(),
                    presence.userId(),
                    presence.connectionId(),
                    presence.displayName(),
                    presence.color(),
                    presence.avatarUrl(),
                    roomState.leadUserId(),
                    null,
                    null,
                    roomState.locked(),
                    OffsetDateTime.now(),
                    null,
                    null
            ));
        }

        if (roomState.memberCount() == 0) {
            rooms.scheduleCleanupIfEmpty(presence.roomCode());
        } else if (!userStillActive && presence.userId().equals(previousLeadUserId)) {
            state.firstActiveMemberExcept(presence.roomCode(), presence.userId()).ifPresent(candidate -> {
                RoomAccessDto transferred = state.transferLead(presence.roomCode(), candidate.userId());
                broadcasts.broadcast(topic(presence.roomCode()), new MemberEvent(
                        "lead-transferred",
                        presence.userId(),
                        presence.userId(),
                        presence.connectionId(),
                        presence.displayName(),
                        presence.color(),
                        presence.avatarUrl(),
                        transferred.leadUserId(),
                        candidate.userId(),
                        candidate.displayName(),
                        transferred.locked(),
                        OffsetDateTime.now(),
                        null,
                        null
                ));
            });
        }

        broadcastSnapshot(presence.roomCode(), presence.userId(), presence.connectionId());
        log.info("Room presence connection removed room={} connectionId={} userId={} userStillActive={} activeCount={}",
                presence.roomCode(), presence.connectionId(), presence.userId(), userStillActive, roomState.memberCount());
    }

    public void broadcastSnapshot(String roomCode, String actorUserId, String connectionId) {
        var members = state.activeMembers(roomCode).stream()
                .map(member -> new PresenceMember(member.userId(), member.displayName(), member.cursorColor()))
                .toList();
        long version = state.nextPresenceVersion(roomCode);
        broadcasts.broadcast(topic(roomCode), new MemberEvent(
                "presence-snapshot",
                actorUserId,
                actorUserId,
                connectionId,
                null,
                null,
                null,
                state.getLeadUserId(roomCode),
                null,
                null,
                state.isLocked(roomCode),
                OffsetDateTime.now(),
                members,
                version
        ));
        log.info("Room presence snapshot published room={} connectionId={} userId={} version={} activeCount={}",
                roomCode, connectionId, actorUserId, version, members.size());
    }

    private String topic(String roomCode) {
        return "/topic/room/" + roomCode + "/members";
    }
}
