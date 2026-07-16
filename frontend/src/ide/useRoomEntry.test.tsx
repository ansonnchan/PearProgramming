import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoomSessionState } from '../types';
import { useRoomEntry } from './useRoomEntry';

const api = vi.hoisted(() => ({
  createRoom: vi.fn(),
  getRoom: vi.fn(),
  getRoomAccess: vi.fn(),
  getRoomFiles: vi.fn(),
  joinRoom: vi.fn()
}));

vi.mock('../api', () => ({
  API_BASE_URL: 'https://api.example.test',
  ApiError: class ApiError extends Error { status = 500; },
  createRoom: api.createRoom,
  getRoom: api.getRoom,
  getRoomAccess: api.getRoomAccess,
  getRoomFiles: api.getRoomFiles,
  joinRoom: api.joinRoom
}));

const room = {
  code: 'PEAR12',
  workspaceId: 'workspace-1',
  active: true,
  createdAt: '2026-07-15T00:00:00Z',
  memberCount: 1,
  maxUsers: 10,
  locked: false,
  leadUserId: 'user-1'
};

describe('useRoomEntry reconnect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const values = new Map<string, string>();
    Object.defineProperty(window, 'sessionStorage', {
      configurable: true,
      value: {
        clear: () => values.clear(),
        getItem: (key: string) => values.get(key) ?? null,
        removeItem: (key: string) => values.delete(key),
        setItem: (key: string, value: string) => values.set(key, value)
      }
    });
    window.history.replaceState(null, '', '/');
    const savedFile = {
      id: 'deleted-file', workspaceId: 'workspace-1', path: 'deleted.ts', language: 'typescript', content: '',
      createdAt: '2026-07-15T00:00:00Z', updatedAt: '2026-07-15T00:00:00Z'
    };
    const session: RoomSessionState = {
      room,
      files: [savedFile],
      openFileIds: [savedFile.id],
      activeFileId: savedFile.id,
      expandedFolderPaths: [],
      cursorPosition: { line: 1, col: 1 },
      roomLocked: false,
      leadUserId: 'user-1',
      chatOpen: true,
      explorerOpen: true,
      landingCode: room.code,
      chatDraft: ''
    };
    window.sessionStorage.setItem('pearprogram-room-session', JSON.stringify(session));
    api.joinRoom.mockResolvedValue({});
    api.getRoom.mockResolvedValue(room);
    api.getRoomFiles.mockResolvedValue([]);
  });

  it('accepts an empty server snapshot after deletion instead of restoring cached files', async () => {
    const onOpenRoom = vi.fn();
    renderHook(() => useRoomEntry({
      authReady: true,
      onOpenRoom,
      onToast: vi.fn(),
      signIn: vi.fn(),
      user: { id: 'user-1', name: 'Pear', color: '#627d31' }
    }));

    await waitFor(() => expect(onOpenRoom).toHaveBeenCalledTimes(2));
    expect(onOpenRoom.mock.calls[0][1]).toHaveLength(1);
    expect(onOpenRoom.mock.calls[1][1]).toEqual([]);
  });
});
