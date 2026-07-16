package com.pearprogram.rooms;

import com.pearprogram.workspaces.WorkspaceService;
import com.pearprogram.execution.ExecutionCleanupService;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class RoomServiceCleanupTests {
    @Test
    void lastParticipantSchedulesIdempotentCleanupExactlyOnce() {
        EphemeralRoomStateService state = mock(EphemeralRoomStateService.class);
        when(state.activeMemberCount("PEAR12")).thenReturn(0);
        when(state.roomExists("PEAR12")).thenReturn(true, false);
        RoomService service = service(state, 0);

        service.scheduleCleanupIfEmpty("PEAR12");
        assertThat(service.cleanupIfEmpty("PEAR12").cleanedUp()).isTrue();
        assertThat(service.cleanupIfEmpty("PEAR12").cleanedUp()).isFalse();

        verify(state).deleteRoom("PEAR12");
    }

    @Test
    void participantReconnectDuringGraceCancelsCleanup() {
        EphemeralRoomStateService state = mock(EphemeralRoomStateService.class);
        when(state.activeMemberCount("PEAR12")).thenReturn(0, 1);
        when(state.roomExists("PEAR12")).thenReturn(true);
        RoomService service = service(state, 120);

        service.scheduleCleanupIfEmpty("PEAR12");
        service.cancelCleanup("PEAR12");
        assertThat(service.cleanupIfEmpty("PEAR12").reason()).isEqualTo("active_members");

        verify(state, never()).deleteRoom("PEAR12");
    }

    @Test
    void stalePresenceEntriesDoNotPreventCleanupAfterPruningReportsEmpty() {
        EphemeralRoomStateService state = mock(EphemeralRoomStateService.class);
        when(state.activeMemberCount("PEAR12")).thenReturn(0);
        when(state.roomExists("PEAR12")).thenReturn(true);
        RoomService service = service(state, 0);

        service.scheduleCleanupIfEmpty("PEAR12");
        assertThat(service.cleanupIfEmpty("PEAR12").cleanedUp()).isTrue();

        verify(state).deleteRoom("PEAR12");
    }

    private RoomService service(EphemeralRoomStateService state, long graceSeconds) {
        return new RoomService(
                mock(RoomCodeGenerator.class),
                state,
                mock(RoomProjectStateService.class),
                mock(RoomRepository.class),
                mock(RoomMemberRepository.class),
                mock(WorkspaceService.class),
                mock(ExecutionCleanupService.class),
                graceSeconds
        );
    }
}
