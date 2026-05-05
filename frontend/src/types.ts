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

export type RoomAccess = {
  canJoin: boolean;
  reason: 'full' | 'locked' | null;
  locked: boolean;
  memberCount: number;
  maxUsers: number;
  leadUserId: string | null;
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

export type AiAnnotation = {
  id: string;
  fileId: string;
  roomCode: string;
  triggeredBy: string | null;
  line: number;
  content: string;
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
  avatarUrl?: string;
  ai?: boolean;
};

export type GitHubImportResponse = {
  owner: string;
  repo: string;
  branch: string;
  files: WorkspaceFile[];
};

export type ProjectSwitchEvent = {
  type: 'proposed' | 'vote' | 'accepted' | 'declined';
  proposalId: string;
  currentFolder: string;
  newFolder: string;
  proposerId: string;
  proposerName: string;
  voterId?: string;
  voterName?: string;
  requiredUserIds?: string[];
  approvedUserIds?: string[];
  files?: WorkspaceFile[];
  at: string;
};
