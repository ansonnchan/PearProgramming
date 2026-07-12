import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useRoomConnection } from './useRoomConnection';

const mocks = vi.hoisted(() => ({ instances: [] as Array<{ activate: ReturnType<typeof vi.fn>; deactivate: ReturnType<typeof vi.fn> }> }));

vi.mock('../api', () => ({ getStompConnectHeaders: () => ({}), STOMP_URL: 'http://localhost/stomp' }));
vi.mock('sockjs-client', () => ({ default: vi.fn() }));
vi.mock('@stomp/stompjs', () => ({
  Client: class Client {
    connected = false;
    activate = vi.fn();
    deactivate = vi.fn();
    subscribe = vi.fn();
    constructor() { mocks.instances.push(this); }
  }
}));

const handlers = {
  onAnnotation: vi.fn(), onChat: vi.fn(), onConnected: vi.fn(), onCursor: vi.fn(),
  onHeartbeat: vi.fn(), onMember: vi.fn(), onProjectSwitch: vi.fn()
};

describe('useRoomConnection', () => {
  it('owns one client per room and deactivates it on room changes and unmount', () => {
    const { rerender, unmount } = renderHook(({ room }) => useRoomConnection(room, handlers), { initialProps: { room: 'ABC123' as string | null } });
    expect(mocks.instances).toHaveLength(1);
    expect(mocks.instances[0].activate).toHaveBeenCalledOnce();

    rerender({ room: 'XYZ789' });
    expect(mocks.instances[0].deactivate).toHaveBeenCalledOnce();
    expect(mocks.instances).toHaveLength(2);
    unmount();
    expect(mocks.instances[1].deactivate).toHaveBeenCalledOnce();
  });
});
