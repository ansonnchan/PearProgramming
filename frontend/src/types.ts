export type Workspace = {
  id: string;
  name: string;
  createdAt: string;
};

export type Room = {
  code: string;
  active: boolean;
  createdAt: string;
  memberCount: number;
  maxUsers: number;
  locked: boolean;
  leadUserId: string | null;
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

export type RoomCreateResponse = {
  code: string;
  joinUrl: string;
  createdAt: string;
  memberCount: number;
};

export type RoomJoinResponse = {
  code: string;
  displayName: string;
  cursorColor: string;
  memberCount: number;
  maxUsers: number;
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


export type ProjectSwitchEvent = {
  type: 'proposed' | 'vote' | 'accepted' | 'declined' | 'sync';
  proposalId: string;
  currentFolder: string;
  newFolder: string;
  proposerId: string;
  proposerName: string;
  voterId?: string;
  voterName?: string;
  targetUserId?: string;
  requiredUserIds?: string[];
  approvedUserIds?: string[];
  files?: WorkspaceFile[];
  at: string;
};
