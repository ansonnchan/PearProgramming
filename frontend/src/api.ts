import type { BootstrapResponse, Room, WorkspaceFile } from './types';

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8080';
export const STOMP_URL = import.meta.env.VITE_STOMP_URL ?? 'http://localhost:8080/ws';
export const YJS_URL = import.meta.env.VITE_YJS_URL ?? 'ws://localhost:1234';

export async function bootstrapDemoRoom(): Promise<BootstrapResponse> {
  return postJson<BootstrapResponse>('/api/bootstrap', {});
}

export async function getRoom(code: string): Promise<Room> {
  return getJson<Room>(`/api/rooms/${code}`);
}

export async function listFiles(workspaceId: string): Promise<WorkspaceFile[]> {
  return getJson<WorkspaceFile[]>(`/api/workspaces/${workspaceId}/files`);
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`);
  if (!response.ok) {
    throw new Error(`GET ${path} failed with ${response.status}`);
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
    throw new Error(`POST ${path} failed with ${response.status}`);
  }
  return response.json() as Promise<T>;
}
