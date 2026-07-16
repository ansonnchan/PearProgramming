import type { AiAnnotation, AuthSession, BootstrapResponse, ChatMessage, ExecutionResult, Room, RoomAccess, RoomCreateResponse, RoomJoinResponse, Workspace, WorkspaceFile } from './types';
import type { ExecutionLanguageOption } from './language';
import type { UploadCandidate } from './uploads';
import { getOptionalUrlEnv, getRequiredUrlEnv, logResolvedFrontendEnv } from './env';

export const API_BASE_URL = stripWakeHealthPath(getRequiredUrlEnv('VITE_API_URL', {
  aliases: ['VITE_API_BASE_URL'],
  allowedProtocols: ['http:', 'https:']
}));
export const STOMP_URL = getRequiredUrlEnv('VITE_STOMP_URL', {
  allowedProtocols: ['http:', 'https:']
});
const rawYjsUrl = import.meta.env.PROD
  ? getRequiredUrlEnv('VITE_YJS_URL', { allowedProtocols: ['ws:', 'wss:', 'http:', 'https:'] })
  : getOptionalUrlEnv('VITE_YJS_URL', { allowedProtocols: ['ws:', 'wss:', 'http:', 'https:'] });
export const YJS_URL = rawYjsUrl ? toWebSocketUrl(rawYjsUrl) : '';

logResolvedFrontendEnv({ apiUrl: API_BASE_URL, stompUrl: STOMP_URL, yjsUrl: YJS_URL });

let csrfToken = '';
let csrfHeaderName = 'X-XSRF-TOKEN';

function toWebSocketUrl(value: string) {
  const parsed = new URL(value);
  if (parsed.protocol === 'https:') {
    parsed.protocol = 'wss:';
  } else if (parsed.protocol === 'http:') {
    parsed.protocol = 'ws:';
  }
  stripWakeHealthPathInPlace(parsed);
  return parsed.toString().replace(/\/+$/, '');
}

function stripWakeHealthPath(value: string) {
  const parsed = new URL(value);
  stripWakeHealthPathInPlace(parsed);
  return parsed.toString().replace(/\/+$/, '');
}

function stripWakeHealthPathInPlace(url: URL) {
  const path = url.pathname.replace(/\/+$/, '');
  if (path === '/health' || path === '/healthz') {
    url.pathname = '/';
    url.search = '';
    url.hash = '';
  }
}

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

export async function getRoomAccess(code: string): Promise<RoomAccess> {
  return getJson<RoomAccess>(`/api/rooms/${encodeURIComponent(code)}/access`);
}

export async function createWorkspace(name: string): Promise<Workspace> {
  return postJson<Workspace>('/api/workspaces', { name });
}

export async function createRoom(): Promise<RoomCreateResponse> {
  return postJson<RoomCreateResponse>('/api/rooms/create', {});
}

export async function joinRoom(code: string): Promise<RoomJoinResponse> {
  return postJson<RoomJoinResponse>('/api/rooms/join', { code });
}

export async function getRoomFiles(code: string): Promise<WorkspaceFile[]> {
  return getJson<WorkspaceFile[]>(`/api/rooms/${encodeURIComponent(code)}/files`);
}

export async function saveRoomFiles(code: string, files: WorkspaceFile[]): Promise<WorkspaceFile[]> {
  return putJson<WorkspaceFile[]>(`/api/rooms/${encodeURIComponent(code)}/files`, { files });
}

export async function listFiles(workspaceId: string): Promise<WorkspaceFile[]> {
  return getJson<WorkspaceFile[]>(`/api/workspaces/${encodeURIComponent(workspaceId)}/files`);
}

export async function createFile(workspaceId: string, path: string, content = '', language?: string): Promise<WorkspaceFile> {
  return postJson<WorkspaceFile>(`/api/workspaces/${encodeURIComponent(workspaceId)}/files`, { path, content, language });
}

export async function uploadWorkspaceFiles(workspaceId: string, files: UploadCandidate[], replaceExisting: boolean): Promise<WorkspaceFile[]> {
  return postJson<WorkspaceFile[]>(`/api/workspaces/${encodeURIComponent(workspaceId)}/files/batch`, {
    replaceExisting,
    files: files.map((file) => ({
      path: file.path,
      language: file.language,
      content: file.content
    }))
  });
}

export async function updateFileContent(fileId: string, content: string): Promise<WorkspaceFile> {
  return patchJson<WorkspaceFile>(`/api/files/${encodeURIComponent(fileId)}`, { content });
}

export async function submitExecution(
  roomCode: string,
  idempotencyKey: string,
  request: { language: string; sourceCode: string; stdin: string }
): Promise<ExecutionResult> {
  return requestJson<ExecutionResult>('POST', `/api/rooms/${encodeURIComponent(roomCode)}/executions`, request, {
    'Idempotency-Key': idempotencyKey
  });
}

export async function getExecution(roomCode: string, executionId: string): Promise<ExecutionResult> {
  return requestJson<ExecutionResult>('GET', `/api/rooms/${encodeURIComponent(roomCode)}/executions/${encodeURIComponent(executionId)}`, undefined, {
  });
}

export async function getExecutionLanguages(): Promise<ExecutionLanguageOption[]> {
  return getJson<ExecutionLanguageOption[]>('/api/execution/languages');
}

export async function signInGuest(displayName: string, avatarUrl?: string): Promise<AuthSession> {
  const session = await requestJson<AuthSession>('POST', '/api/auth/guest', { displayName, avatarUrl }, {}, false);
  await refreshCsrfToken();
  return session;
}

export async function restoreAuthSession(): Promise<AuthSession | null> {
  const response = await fetch(`${API_BASE_URL}/api/auth/session`, { credentials: 'include' });
  if (response.status === 401) {
    csrfToken = '';
    return null;
  }
  if (!response.ok) {
    throw await toApiError('GET', '/api/auth/session', response);
  }
  const session = await response.json() as AuthSession;
  await refreshCsrfToken();
  return session;
}

export async function updateAuthProfile(displayName: string, avatarUrl?: string): Promise<AuthSession> {
  return requestJson<AuthSession>('PATCH', '/api/auth/profile', { displayName, avatarUrl }, {});
}

export async function logoutAuthSession(): Promise<void> {
  await requestJson<void>('POST', '/api/auth/logout', undefined, {});
  csrfToken = '';
}

export function getStompConnectHeaders() {
  return csrfToken ? { [csrfHeaderName]: csrfToken } : {};
}

async function refreshCsrfToken() {
  const response = await fetch(`${API_BASE_URL}/api/auth/csrf`, { credentials: 'include' });
  if (!response.ok) {
    throw await toApiError('GET', '/api/auth/csrf', response);
  }
  const body = await response.json() as { token: string; headerName: string };
  csrfToken = body.token;
  csrfHeaderName = body.headerName;
}



export async function listChatHistory(code: string): Promise<ChatMessage[]> {
  return getJson<ChatMessage[]>(`/api/rooms/${encodeURIComponent(code)}/chat`);
}

export async function listAnnotations(code: string, fileId: string): Promise<AiAnnotation[]> {
  return getJson<AiAnnotation[]>(`/api/rooms/${encodeURIComponent(code)}/files/${fileId}/annotations`);
}

export async function dismissAnnotation(annotationId: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/annotations/${annotationId}`, {
    method: 'DELETE',
    credentials: 'include',
    headers: await mutationHeaders()
  });
  if (!response.ok) {
    throw new Error(`DELETE /api/annotations/${annotationId} failed with ${response.status}`);
  }
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, { credentials: 'include' });
  if (!response.ok) {
    throw await toApiError('GET', path, response);
  }
  return response.json() as Promise<T>;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  return requestJson<T>('POST', path, body, {});
}

async function putJson<T>(path: string, body: unknown): Promise<T> {
  return requestJson<T>('PUT', path, body, {});
}

async function patchJson<T>(path: string, body: unknown): Promise<T> {
  return requestJson<T>('PATCH', path, body, {});
}

async function requestJson<T>(method: 'GET' | 'POST' | 'PUT' | 'PATCH', path: string, body: unknown,
                              headers: Record<string, string>, includeCsrf = method !== 'GET'): Promise<T> {
  const secureHeaders = includeCsrf ? await mutationHeaders() : {};
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...secureHeaders,
      ...headers
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'include'
  });
  if (!response.ok) {
    throw await toApiError(method, path, response);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return response.json() as Promise<T>;
}

async function mutationHeaders() {
  if (!csrfToken) {
    await refreshCsrfToken();
  }
  return { [csrfHeaderName]: csrfToken };
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
