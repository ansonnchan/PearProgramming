import type { AiAnnotation, BootstrapResponse, ChatMessage, Room, RoomAccess, RoomCreateResponse, RoomJoinResponse, Workspace, WorkspaceFile } from './types';
import type { UploadCandidate } from './uploads';

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';
export const STOMP_URL = import.meta.env.VITE_STOMP_URL ?? '';
export const YJS_URL = import.meta.env.VITE_YJS_URL ?? '';

export class ApiError extends Error {
  status: number;

  constructor(method: string, path: string, status: number, body: string) {
    super(`${method} ${path} failed with ${status}${body ? `: ${body}` : ''}`);
    this.name = 'ApiError';
    this.status = status;
  }
}

export async function bootstrapDemoRoom(): Promise<BootstrapResponse> {
  return postJson<BootstrapResponse>('/api/bootstrap', {});
}

export async function getRoom(code: string): Promise<Room> {
  return getJson<Room>(`/api/rooms/${encodeURIComponent(code)}`);
}

export async function getRoomAccess(code: string, sessionId: string, displayName: string): Promise<RoomAccess> {
  return getJson<RoomAccess>(`/api/rooms/${encodeURIComponent(code)}/access?sessionId=${encodeURIComponent(sessionId)}&displayName=${encodeURIComponent(displayName)}`);
}

export async function createWorkspace(name: string): Promise<Workspace> {
  return postJson<Workspace>('/api/workspaces', { name });
}

export async function createRoom(): Promise<RoomCreateResponse> {
  return postJson<RoomCreateResponse>('/api/rooms/create', {});
}

export async function joinRoom(code: string, sessionId: string, displayName?: string): Promise<RoomJoinResponse> {
  return postJson<RoomJoinResponse>('/api/rooms/join', { code, sessionId, displayName });
}

export async function listFiles(workspaceId: string): Promise<WorkspaceFile[]> {
  // Workspaces are no longer persisted; return empty list
  return [];
}

export async function createFile(workspaceId: string, path: string, content = '', language?: string): Promise<WorkspaceFile> {
  // Files are no longer persisted; return null
  return {} as WorkspaceFile;
}

export async function uploadWorkspaceFiles(workspaceId: string, files: UploadCandidate[], replaceExisting: boolean): Promise<WorkspaceFile[]> {
  // Files are no longer persisted; return empty list
  return [];
}

export async function updateFileContent(fileId: string, content: string): Promise<WorkspaceFile> {
  // Files are no longer persisted; return null
  return {} as WorkspaceFile;
}



export async function listChatHistory(code: string): Promise<ChatMessage[]> {
  return getJson<ChatMessage[]>(`/api/rooms/${encodeURIComponent(code)}/chat`);
}

export async function listAnnotations(code: string, fileId: string): Promise<AiAnnotation[]> {
  return getJson<AiAnnotation[]>(`/api/rooms/${encodeURIComponent(code)}/files/${fileId}/annotations`);
}

export async function dismissAnnotation(annotationId: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/annotations/${annotationId}`, {
    method: 'DELETE'
  });
  if (!response.ok) {
    throw new Error(`DELETE /api/annotations/${annotationId} failed with ${response.status}`);
  }
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`);
  if (!response.ok) {
    throw await toApiError('GET', path, response);
  }
  return response.json() as Promise<T>;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    throw await toApiError('POST', path, response);
  }
  return response.json() as Promise<T>;
}

async function patchJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    throw await toApiError('PATCH', path, response);
  }
  return response.json() as Promise<T>;
}

async function toApiError(method: string, path: string, response: Response) {
  let body = '';
  try {
    body = await response.text();
  } catch {
    body = '';
  }
  return new ApiError(method, path, response.status, body.slice(0, 300));
}
