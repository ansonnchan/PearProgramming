package com.pearprogram.realtime;

import com.pearprogram.ai.AiParticipantService;
import com.pearprogram.auth.GuestPrincipal;
import com.pearprogram.rooms.EphemeralRoomStateService;
import com.pearprogram.rooms.RoomService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

class RoomPresenceIntegrationTests {
    private RealtimeBroadcastService broadcasts;
    private EphemeralRoomStateService state;
    private RoomPresenceEventService presence;
    private RoomEventController controller;
    private RoomService rooms;

    @BeforeEach
    void setUp() {
        broadcasts = mock(RealtimeBroadcastService.class);
        state = new EphemeralRoomStateService(
                mock(StringRedisTemplate.class), 120, "presence-test", "", "", "", false
        );
        state.reserveRoomCode("PEAR12");
        state.initializeRoom("PEAR12", OffsetDateTime.now());
        rooms = mock(RoomService.class);
        RoomConnectionRegistry connections = new RoomConnectionRegistry();
        presence = new RoomPresenceEventService(broadcasts, rooms, state, connections);
        controller = new RoomEventController(
                broadcasts,
                rooms,
                state,
                presence,
                mock(AiParticipantService.class),
                null
        );
    }

    @Test
    void creatorAndIndependentLateJoinerConvergeOnTheSameServerSnapshot() {
        GuestPrincipal creator = principal("Creator");
        GuestPrincipal joiner = principal("Joiner");

        join("connection-a", creator);
        assertThat(state.activeMembers("PEAR12")).extracting("userId").containsExactly(creator.id());

        join("connection-b", joiner);
        assertThat(state.activeMembers("PEAR12")).extracting("userId").containsExactlyInAnyOrder(creator.id(), joiner.id());

        MemberEvent snapshot = lastSnapshot();
        assertThat(snapshot.members()).extracting("userId").containsExactlyInAnyOrder(creator.id(), joiner.id());
        assertThat(snapshot.presenceVersion()).isPositive();
    }

    @Test
    void concurrentClientsAndTwoTabsUseServerConnectionIdentityWithoutDuplicateUsers() throws Exception {
        GuestPrincipal first = principal("First device");
        GuestPrincipal second = principal("Second device");

        Thread one = new Thread(() -> join("device-one", first));
        Thread two = new Thread(() -> join("device-two", second));
        one.start();
        two.start();
        one.join();
        two.join();
        join("second-tab", first);

        assertThat(state.activeMemberCount("PEAR12")).isEqualTo(2);
        assertThat(state.activeMembers("PEAR12")).extracting("userId")
                .containsExactlyInAnyOrder(first.id(), second.id());
    }

    @Test
    void reconnectAndAbruptDisconnectPublishAReplacementSnapshot() {
        GuestPrincipal creator = principal("Creator");
        GuestPrincipal joiner = principal("Joiner");
        join("creator-connection", creator);
        join("old-connection", joiner);

        presence.disconnect("old-connection");
        join("reconnected", joiner);
        assertThat(state.activeMemberCount("PEAR12")).isEqualTo(2);

        presence.disconnect("reconnected");
        MemberEvent snapshot = lastSnapshot();
        assertThat(snapshot.members()).extracting("userId").containsExactly(creator.id());
    }

    @Test
    void finalAbruptDisconnectSchedulesEmptyRoomCleanup() {
        GuestPrincipal creator = principal("Creator");
        join("only-connection", creator);

        presence.disconnect("only-connection");

        verify(rooms).scheduleCleanupIfEmpty("PEAR12");
        assertThat(state.activeMemberCount("PEAR12")).isZero();
    }

    @Test
    void leadCanLockAndUnlockWhileNonLeadCannotChangeRoomAccess() {
        GuestPrincipal creator = principal("Creator");
        GuestPrincipal existingMember = principal("Existing member");
        GuestPrincipal prospectiveMember = principal("Prospective member");
        join("creator-connection", creator);
        join("member-connection", existingMember);

        changeLock("creator-connection", creator, true);

        assertThat(state.roomAccess("PEAR12", prospectiveMember.id(), prospectiveMember.displayName()))
                .extracting("canJoin", "reason", "locked")
                .containsExactly(false, "locked", true);
        assertThat(state.roomAccess("PEAR12", existingMember.id(), existingMember.displayName()).canJoin()).isTrue();

        assertThatThrownBy(() -> changeLock("member-connection", existingMember, false))
                .isInstanceOf(AccessDeniedException.class)
                .hasMessageContaining("Lead Pear");
        assertThat(state.roomAccess("PEAR12", prospectiveMember.id(), prospectiveMember.displayName()).locked()).isTrue();

        changeLock("creator-connection", creator, false);
        assertThat(state.roomAccess("PEAR12", prospectiveMember.id(), prospectiveMember.displayName()))
                .extracting("canJoin", "reason", "locked")
                .containsExactly(true, null, false);
    }

    private void join(String connectionId, GuestPrincipal principal) {
        controller.member("PEAR12", new MemberEvent(
                "joined", "client-user", "client-session", "client-connection", principal.displayName(), "#627d31",
                null, null, null, null, false, OffsetDateTime.now(), null, null
        ), connectionId, UsernamePasswordAuthenticationToken.authenticated(principal, null, List.of()));
    }

    private void changeLock(String connectionId, GuestPrincipal principal, boolean locked) {
        controller.member("PEAR12", new MemberEvent(
                "lock-changed", "client-user", "client-session", "client-connection", principal.displayName(), "#627d31",
                null, null, null, null, locked, OffsetDateTime.now(), null, null
        ), connectionId, UsernamePasswordAuthenticationToken.authenticated(principal, null, List.of()));
    }

    private MemberEvent lastSnapshot() {
        ArgumentCaptor<Object> payloads = ArgumentCaptor.forClass(Object.class);
        verify(broadcasts, org.mockito.Mockito.atLeastOnce()).broadcast(eq("/topic/room/PEAR12/members"), payloads.capture());
        return payloads.getAllValues().stream()
                .filter(MemberEvent.class::isInstance)
                .map(MemberEvent.class::cast)
                .filter(event -> "presence-snapshot".equals(event.type()))
                .reduce((first, second) -> second)
                .orElseThrow();
    }

    private GuestPrincipal principal(String name) {
        return new GuestPrincipal(UUID.randomUUID(), name, null);
    }
}
