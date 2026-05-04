export type Workspace = {
  id: string;
  name: string;
  createdAt: string;
};

export type Room = {
  id: string;
  code: string;
  workspaceId: string;
  active: boolean;
  createdAt: string;
  expiresAt: string;
};

export type WorkspaceFile = {
  id: string;
  workspaceId: string;
  path: string;
  language: string;
  content: string;
  createdAt: string;
  updatedAt: string;
};

export type BootstrapResponse = {
  workspace: Workspace;
  room: Room;
  files: WorkspaceFile[];
};

export type ChatMessage = {
  id: string;
  userId: string | null;
  displayName: string;
  content: string;
  ai: boolean;
  createdAt: string;
};

export type CursorMessage = {
  userId: string;
  displayName: string;
  fileId: string;
  line: number;
  col: number;
  color: string;
  sentAt: number;
};

export type Member = {
  id: string;
  name: string;
  color: string;
  ai?: boolean;
};
