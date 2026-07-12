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
  reason: 'full' | 'locked' | 'not_found' | null;
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
  createdById?: string;
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
  type: 'proposed' | 'vote' | 'accepted' | 'declined' | 'sync' | 'files-updated' | 'file-content-updated';
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
  replaceExisting?: boolean;
  openUploaded?: boolean;
  files?: WorkspaceFile[];
  at: string;
};

export type RoomSessionState = {
  room: Room;
  files: WorkspaceFile[];
  openFileIds: string[];
  activeFileId: string | null;
  expandedFolderPaths: string[];
  cursorPosition: {
    line: number;
    col: number;
  };
  roomLocked: boolean;
  leadUserId: string | null;
  chatOpen: boolean;
  explorerOpen: boolean;
  landingCode: string;
  chatDraft: string;
};

export type ExecutionStatus =
  | 'QUEUED'
  | 'SUBMITTED'
  | 'RUNNING'
  | 'COMPLETED'
  | 'COMPILATION_ERROR'
  | 'RUNTIME_ERROR'
  | 'TIMED_OUT'
  | 'FAILED';

export type ExecutionResult = {
  executionId: string;
  status: ExecutionStatus;
  stdout: string | null;
  stderr: string | null;
  compileOutput: string | null;
  exitCode: number | null;
  durationMs: number | null;
  message: string | null;
  createdAt: string;
  completedAt: string | null;
};
