package com.pearprogram.realtime;

import com.pearprogram.ai.AiAnnotationService;
import com.pearprogram.ai.AiParticipantService;
import com.pearprogram.auth.GuestPrincipal;
import com.pearprogram.rooms.EphemeralRoomStateService;
import com.pearprogram.rooms.RoomService;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

class RoomEventControllerIdentityTests {
    @Test
    void replacesClientSuppliedCursorIdentityWithTheAuthenticatedPrincipal() {
        RealtimeBroadcastService broadcasts = mock(RealtimeBroadcastService.class);
        RoomEventController controller = new RoomEventController(
                broadcasts,
                mock(RoomService.class),
                mock(EphemeralRoomStateService.class),
                mock(AiParticipantService.class),
                mock(AiAnnotationService.class),
                null
        );
        GuestPrincipal principal = new GuestPrincipal(UUID.randomUUID(), "Authenticated User", null);
        var authentication = UsernamePasswordAuthenticationToken.authenticated(principal, null, List.of());

        controller.cursor("ABC123", new CursorMessage(
                "impersonated-user",
                "Impostor",
                "file-1",
                4,
                7,
                "#ffffff",
                123L
        ), authentication);

        ArgumentCaptor<Object> payload = ArgumentCaptor.forClass(Object.class);
        verify(broadcasts).broadcast(org.mockito.ArgumentMatchers.eq("/topic/room/ABC123/cursors"), payload.capture());
        CursorMessage outbound = (CursorMessage) payload.getValue();
        assertThat(outbound.userId()).isEqualTo(principal.id());
        assertThat(outbound.displayName()).isEqualTo(principal.displayName());
    }
}
