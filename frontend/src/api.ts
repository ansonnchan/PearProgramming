import type { AiAnnotation, BootstrapResponse, ChatMessage, GitHubImportResponse, Room, WorkspaceFile } from './types';

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8080';
export const STOMP_URL = import.meta.env.VITE_STOMP_URL ?? 'http://localhost:8080/ws';
export const YJS_URL = import.meta.env.VITE_YJS_URL ?? 'ws://localhost:1234';

export async function bootstrapDemoRoom(): Promise<BootstrapResponse> {
  return postJson<BootstrapResponse>('/api/bootstrap', {});
}

export async function issueDevToken(userId: string, displayName: string): Promise<string> {
  const response = await postJson<{ token: string; tokenType: string }>('/auth/dev-token', {
    userId,
    displayName
  });
  return response.token;
}

export async function getRoom(code: string): Promise<Room> {
  return getJson<Room>(`/api/rooms/${code}`);
}

export async function listFiles(workspaceId: string): Promise<WorkspaceFile[]> {
  return getJson<WorkspaceFile[]>(`/api/workspaces/${workspaceId}/files`);
}

export async function createFile(workspaceId: string, path: string, content = ''): Promise<WorkspaceFile> {
  return postJson<WorkspaceFile>(`/api/workspaces/${workspaceId}/files`, {
    path,
    content
  });
}

export async function importPlaceholderRepository(workspaceId: string, owner: string, repo: string, branch: string): Promise<GitHubImportResponse> {
  return postJson<GitHubImportResponse>(`/api/workspaces/${workspaceId}/github/import`, {
    owner,
    repo,
    branch
  });
}

export async function listChatHistory(code: string): Promise<ChatMessage[]> {
  return getJson<ChatMessage[]>(`/api/rooms/${code}/chat`);
}

export async function listAnnotations(code: string, fileId: string): Promise<AiAnnotation[]> {
  return getJson<AiAnnotation[]>(`/api/rooms/${code}/files/${fileId}/annotations`);
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
