import type { RoomSessionState } from '../types';

const ROOM_SESSION_STORAGE_KEY = 'pearprogram-room-session';
const CONNECTION_SESSION_STORAGE_KEY = 'pearprogram-connection-session';

export type SaveState = 'idle' | 'saving' | 'saved' | 'offline' | 'error';

export function getJoinCode() {
  const match = window.location.pathname.match(/^\/(?:join|room)\/([^/]+)/);
  return match?.[1] ?? null;
}

export function getOrCreateConnectionId() {
  const stored = sessionStorage.getItem(CONNECTION_SESSION_STORAGE_KEY);
  if (stored) {
    return stored;
  }
  const id = crypto.randomUUID();
  sessionStorage.setItem(CONNECTION_SESSION_STORAGE_KEY, id);
  return id;
}

export function loadRoomSession(): RoomSessionState | null {
  const stored = sessionStorage.getItem(ROOM_SESSION_STORAGE_KEY);
  if (!stored) {
    return null;
  }
  try {
    const parsed = JSON.parse(stored) as RoomSessionState;
    return parsed.room?.code ? parsed : null;
  } catch {
    sessionStorage.removeItem(ROOM_SESSION_STORAGE_KEY);
    return null;
  }
}

export function persistRoomSession(state: RoomSessionState) {
  sessionStorage.setItem(ROOM_SESSION_STORAGE_KEY, JSON.stringify(state));
}

export function clearRoomSession() {
  sessionStorage.removeItem(ROOM_SESSION_STORAGE_KEY);
}

export function buildWakeUrl(baseUrl: string, path: string) {
  try {
    const url = new URL(baseUrl);
    const currentPath = url.pathname.replace(/\/+$/, '');
    const basePath = currentPath === '/health' || currentPath === '/healthz' ? '' : currentPath;
    url.pathname = `${basePath}/${path.replace(/^\/+/, '')}`;
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/+$/, '');
  } catch {
    return '';
  }
}

export function normalizeRoomCode(value: string) {
  return value.trim().toUpperCase().replace(/[\s-]+/g, '');
}

export function isValidRoomCode(value: string) {
  return /^[A-Z0-9]{6}$/.test(value);
}

export function formatPacificTime(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/Los_Angeles',
    timeZoneName: 'short'
  }).format(new Date(value));
}

export function saveStatusText(state: SaveState, lastSavedAt: string | null) {
  if (state === 'saving') return 'Autosaving...';
  if (state === 'saved') return lastSavedAt ? `Autosaved ${formatPacificTime(lastSavedAt)}` : 'Autosaved';
  if (state === 'offline') return 'Local changes';
  if (state === 'error') return 'Autosave retrying';
  return 'Autosave ready';
}
