import Editor, { type OnMount } from '@monaco-editor/react';
import { Client } from '@stomp/stompjs';
import {
  Bot,
  Check,
  Copy,
  Download,
  FilePlus2,
  Folder,
  FolderPlus,
  ImagePlus,
  MessageSquare,
  Upload,
  UserRound,
  Wifi,
  WifiOff,
  X
} from 'lucide-react';
import { type DragEvent, type KeyboardEvent, type RefObject, useCallback, useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import {
  API_BASE_URL,
  ApiError,
  createFile,
  createRoom,
  dismissAnnotation,
  getRoom,
  getRoomFiles,
  getRoomAccess,
  joinRoom as apiJoinRoom,
  listAnnotations,
  listChatHistory,
  saveRoomFiles,
  updateFileContent,
  uploadWorkspaceFiles,
  YJS_URL
} from './api';
import { executionLanguageForEditorLanguage, inferLanguage, languageClass, type ExecutionLanguage } from './language';
import { useExecution } from './execution/useExecution';
import { createExecutionInput } from './execution/input';
import { ExecutionConsole } from './components/execution/ExecutionConsole';
import { ExecutionToolbar } from './components/execution/ExecutionToolbar';
import { useAuthSession } from './auth/useAuthSession';
import { useRoomConnection } from './collaboration/useRoomConnection';
import { useCollaborativeDocument } from './collaboration/useCollaborativeDocument';
import { FileTree } from './components/file-tree/FileTree';
import { ChatPanel, type DisplayChatMessage, type MentionOption } from './components/chat/ChatPanel';
import pearLogoUrl from '../assets/favicon.png';
import pearChibiUrl from '../assets/pear_chibi.jpg';
import type { UploadCandidate, UploadReadResult } from './uploads';
import { projectNameForPaths, readDroppedUploadCandidates, readUploadCandidates, UPLOAD_ACCEPT } from './uploads';
import type { AiAnnotation, ChatMessage, CursorMessage, Member, ProjectSwitchEvent, Room, RoomSessionState, WorkspaceFile } from './types';

const DEFAULT_COLOR = '#000000';
const ROOM_SESSION_STORAGE_KEY = 'pearprogram-room-session';
const CONNECTION_SESSION_STORAGE_KEY = 'pearprogram-connection-session';
const CONTENT_SYNC_DELAY_MS = 250;
const BACKEND_WAKE_URL = buildWakeUrl(API_BASE_URL, '/healthz');
const REALTIME_WAKE_URL = 'https://pear-program-realtime.onrender.com/health';

const FALLBACK_ROOM: Room = {
  code: 'LOCAL1',
  workspaceId: '00000000-0000-0000-0000-000000000000',
  active: true,
  createdAt: new Date().toISOString(),
  memberCount: 1,
  maxUsers: 10,
  locked: false,
  leadUserId: null
};


type PendingSwitch = {
  proposalId: string;
  currentFolder: string;
  newFolder: string;
  proposerId: string;
  proposerName: string;
  requiredUserIds: string[];
  approvedUserIds: string[];
};

type MemberRealtimeEvent = {
  type: 'joined' | 'left' | 'presence-sync' | 'lead-sync' | 'lead-transferred' | 'lead-removed' | 'lock-changed' | 'room-closed';
  userId: string;
  sessionId?: string;
  connectionId?: string;
  displayName?: string;
  color?: string;
  avatarUrl?: string;
  leadUserId?: string;
  targetUserId?: string;
  targetUserName?: string;
  locked?: boolean;
  at?: string;
};

type SaveState = 'idle' | 'saving' | 'saved' | 'offline' | 'error';

type PendingRoomAction = 'create' | 'join';


export default function App() {
  const [room, setRoom] = useState<Room | null>(null);
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [openFileIds, setOpenFileIds] = useState<string[]>([]);
  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const [messages, setMessages] = useState<DisplayChatMessage[]>([]);
  const [annotations, setAnnotations] = useState<AiAnnotation[]>([]);
  const [cursors, setCursors] = useState<Record<string, CursorMessage>>({});
  const [presenceMembers, setPresenceMembers] = useState<Record<string, Member>>({});
  const [chatDraft, setChatDraft] = useState('');
  const [chatError, setChatError] = useState('');
  const [mentionState, setMentionState] = useState({ open: false, query: '', start: 0, end: 0 });
  const [mentionActiveIndex, setMentionActiveIndex] = useState(0);
  const [cursorPosition, setCursorPosition] = useState({ line: 1, col: 1 });
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => new Set());
  const [landingCode, setLandingCode] = useState('');
  const [landingError, setLandingError] = useState('');
  const [landingNotice, setLandingNotice] = useState('');
  const [creatingRoom, setCreatingRoom] = useState(false);
  const [joiningRoom, setJoiningRoom] = useState(false);
  const [chatOpen, setChatOpen] = useState(true);
  const [explorerOpen, setExplorerOpen] = useState(true);
  const [pacificNow, setPacificNow] = useState(() => new Date());
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [pendingSwitch, setPendingSwitch] = useState<PendingSwitch | null>(null);
  const [uploadNotice, setUploadNotice] = useState('');
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [uploadDragging, setUploadDragging] = useState(false);
  const [leadUserId, setLeadUserId] = useState<string | null>(null);
  const [roomLocked, setRoomLocked] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [pearMenuOpen, setPearMenuOpen] = useState(false);
  const [delegateOpen, setDelegateOpen] = useState(false);
  const [delegateUserId, setDelegateUserId] = useState('');
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileDraftName, setProfileDraftName] = useState('');
  const [profileDraftAvatar, setProfileDraftAvatar] = useState<string | undefined>();
  const [pendingRoomAction, setPendingRoomAction] = useState<PendingRoomAction | null>(null);
  const [entryProfileOpen, setEntryProfileOpen] = useState(false);
  const [entryProfileName, setEntryProfileName] = useState('');
  const [entryProfileAvatar, setEntryProfileAvatar] = useState<string | undefined>();
  const [entryProfileError, setEntryProfileError] = useState('');
  const [createItemKind, setCreateItemKind] = useState<'file' | 'folder' | null>(null);
  const [createItemName, setCreateItemName] = useState('');
  const [createItemError, setCreateItemError] = useState('');
  const { ready: authReady, realtimeToken, signIn, signOut, updateProfile, user, userRef } = useAuthSession();
  const [connectionId] = useState(() => getOrCreateConnectionId());
  const [editorMountVersion, setEditorMountVersion] = useState(0);
  const [executionLanguage, setExecutionLanguage] = useState<ExecutionLanguage>('javascript');
  const [executionStdin, setExecutionStdin] = useState('');
  const [executionPanelOpen, setExecutionPanelOpen] = useState(true);

  const openFiles = openFileIds
    .map((fileId) => files.find((file) => file.id === fileId))
    .filter((file): file is WorkspaceFile => Boolean(file));
  const activeFile = openFiles.find((file) => file.id === activeFileId) ?? null;
  const activeProjectName = files.length > 0 ? projectNameForPaths(files.map((file) => file.path)) : 'Empty room';
  const remoteMembers = Object.values(cursors)
    .filter((cursor) => cursor.userId !== user.id)
    .map<Member>((cursor) => ({ id: cursor.userId, name: cursor.displayName, color: cursor.color }));
  const humanMembers = uniqueMembers([user, ...Object.values(presenceMembers), ...remoteMembers]);
  const members = uniqueMembers([...humanMembers, { id: 'ai', name: 'AI', color: '#8B5CF6', ai: true }]);
  const mentionOptions = buildMentionOptions(members);
  const filteredMentionOptions = mentionState.open
    ? mentionOptions.filter((option) => mentionMatches(option, mentionState.query)).slice(0, 6)
    : [];
  const isLeadPear = leadUserId === user.id;
  const roleLabel = isLeadPear ? 'Lead Pear' : 'Junior Pear';
  const delegateCandidates = humanMembers.filter((member) => member.id !== user.id);

  const editorRef = useRef<unknown>(null);
  const monacoRef = useRef<any>(null);
  const cursorWidgetsRef = useRef<Map<string, any>>(new Map());
  const annotationWidgetsRef = useRef<Map<string, any>>(new Map());
  const cursorSentAtRef = useRef(0);
  const saveTimerRef = useRef<number | null>(null);
  const suppressEditorChangeRef = useRef(false);
  const pendingUploadRef = useRef<{ proposalId: string; candidates: UploadCandidate[]; newFolder: string; openUploaded: boolean } | null>(null);
  const pendingUploadSyncRef = useRef<ProjectSwitchEvent[]>([]);
  const committingProposalRef = useRef<string | null>(null);
  const roomRef = useRef<Room | null>(null);
  const filesRef = useRef<WorkspaceFile[]>([]);
  const openFileIdsRef = useRef<string[]>([]);
  const activeFileIdRef = useRef<string | null>(null);
  const activeFileRef = useRef<WorkspaceFile | null>(null);
  const mentionOptionsRef = useRef<MentionOption[]>([]);
  const leadUserIdRef = useRef<string | null>(null);
  const roomLockedRef = useRef(false);
  const toastTimerRef = useRef<number | null>(null);
  const contentSyncTimerRef = useRef<number | null>(null);
  const pendingContentSyncRef = useRef<{ fileId: string; content: string; updatedAt: string } | null>(null);
  const lastLocalEditAtRef = useRef(0);
  const seedingFileIdsRef = useRef<Set<string>>(new Set());
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const chatInputRef = useRef<HTMLInputElement | null>(null);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const entryAvatarInputRef = useRef<HTMLInputElement | null>(null);
  const bootstrappedRoomRef = useRef(false);
  const {
    clear: clearExecutionConsole,
    error: executionError,
    result: executionResult,
    run: submitActiveExecution,
    submitting: executionSubmitting
  } = useExecution(room && activeFile ? `${room.code}:${activeFile.id}` : null, room?.code ?? null);

  const handleJoinRoom = useCallback(async (rawCode: string, displayName?: string, replaceUrl = true) => {
    const code = normalizeRoomCode(rawCode);
    if (!isValidRoomCode(code)) {
      setLandingError('Please enter in a valid pear room code');
      return;
    }

    setJoiningRoom(true);
    setLandingError('');
    setLandingNotice('');
    try {
      const access = await getRoomAccess(code);
      if (!access.canJoin) {
        if (access.reason === 'locked') {
          showToast('Room is Locked. Contact the room owner if this is a mistake.');
        } else if (access.reason === 'not_found') {
          setLandingError(`Room ${code} has expired or was closed.`);
        } else {
          setLandingError('Room is Full.');
        }
        setJoiningRoom(false);
        return;
      }
      await apiJoinRoom(code);
      const joinedRoom = await getRoom(code);
      const roomFiles = await getRoomFiles(code).catch(() => []);
      openRoom(joinedRoom, roomFiles, replaceUrl);
    } catch (error) {
      console.warn('Join room failed', { apiBaseUrl: API_BASE_URL, code, error });
      setLandingError(error instanceof ApiError && error.status === 404
        ? `Room ${code} was not found. No new room was created.`
        : `Could not join this room. The frontend tried ${API_BASE_URL}.`);
    } finally {
      setJoiningRoom(false);
    }
  }, []);

  const handleCreateRoom = useCallback(async () => {
    setCreatingRoom(true);
    setLandingError('');
    setLandingNotice('');
    try {
      const createResponse = await createRoom();
      const createdRoom = await getRoom(createResponse.code);
      openRoom(createdRoom, [], true);
    } catch (error) {
      console.warn('Create room failed', { apiBaseUrl: API_BASE_URL, error });
      setLandingError(`Could not create a shared room. The frontend tried ${API_BASE_URL}.`);
    } finally {
      setCreatingRoom(false);
    }
  }, []);

  const scheduleAutosave = useCallback((fileId: string, content: string) => {
    const currentRoom = roomRef.current;
    if (!currentRoom || currentRoom.code === FALLBACK_ROOM.code || !isUuid(fileId)) {
      setSaveState('offline');
      return;
    }

    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
    }

    setSaveState('saving');
    saveTimerRef.current = window.setTimeout(() => {
      void updateFileContent(fileId, content)
        .then((saved) => {
          setFiles((current) => current.map((file) => (file.id === saved.id ? saved : file)));
          setSaveState('saved');
          setLastSavedAt(new Date().toISOString());
        })
        .catch(() => {
          setSaveState('error');
        });
    }, 700);
  }, []);

  const handleEditorMount: OnMount = useCallback((editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    setEditorMountVersion((version) => version + 1);
    monaco.editor.defineTheme('pear-github-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [],
      colors: {
        'editor.background': '#0d1117',
        'editorGutter.background': '#0d1117',
        'editorLineNumber.foreground': '#5f6b7a',
        'editorCursor.foreground': '#58a6ff',
        'editor.selectionBackground': '#264f78'
      }
    });
    monaco.editor.setTheme('pear-github-dark');

    editor.onDidChangeModelContent(() => {
      if (suppressEditorChangeRef.current) {
        return;
      }
      const currentFile = activeFileRef.current;
      if (!currentFile) {
        return;
      }
      const content = editor.getValue();
      const updatedAt = new Date().toISOString();
      lastLocalEditAtRef.current = Date.now();
      const nextFiles = filesRef.current.map((file) => (
        file.id === currentFile.id ? { ...file, content, updatedAt } : file
      ));
      filesRef.current = nextFiles;
      setFiles(nextFiles);
      scheduleAutosave(currentFile.id, content);
      scheduleContentBroadcast(currentFile.id, content, updatedAt);
    });

    editor.onDidChangeCursorPosition((event) => {
      setCursorPosition({ line: event.position.lineNumber, col: event.position.column });
      const now = Date.now();
      if (now - cursorSentAtRef.current < 50) {
        return;
      }
      cursorSentAtRef.current = now;
      const client = stompRef.current;
      const currentRoom = roomRef.current;
      const currentFile = activeFileRef.current;
      if (!client?.connected || !currentRoom || !currentFile) {
        return;
      }
      client.publish({
        destination: `/app/room/${currentRoom.code}/cursors`,
        body: JSON.stringify({
          userId: user.id,
          displayName: user.name,
          fileId: currentFile.id,
          line: event.position.lineNumber,
          col: event.position.column,
          color: DEFAULT_COLOR,
          sentAt: now
        })
      });
    });
  }, [scheduleAutosave, user.id, user.name]);

  useEffect(() => {
    roomRef.current = room;
  }, [room]);

  useEffect(() => {
    activeFileRef.current = activeFile;
  }, [activeFile]);

  useEffect(() => {
    const inferred = executionLanguageForEditorLanguage(activeFile?.language);
    if (inferred) {
      setExecutionLanguage(inferred);
    }
  }, [activeFile?.id, activeFile?.language]);

  useEffect(() => {
    activeFileIdRef.current = activeFileId;
  }, [activeFileId]);

  useEffect(() => {
    openFileIdsRef.current = openFileIds;
  }, [openFileIds]);

  useEffect(() => {
    mentionOptionsRef.current = mentionOptions;
  }, [mentionOptions]);

  useEffect(() => {
    leadUserIdRef.current = leadUserId;
  }, [leadUserId]);

  useEffect(() => {
    roomLockedRef.current = roomLocked;
  }, [roomLocked]);

  useEffect(() => {
    if (folderInputRef.current) {
      configureFolderInput(folderInputRef.current);
    }
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setPacificNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!authReady || bootstrappedRoomRef.current) {
      return;
    }
    bootstrappedRoomRef.current = true;

    const joinCode = getJoinCode();
    const savedSession = loadRoomSession();
    if (user.id && savedSession?.room?.code && (!joinCode || normalizeRoomCode(joinCode) === savedSession.room.code)) {
      openRoom(savedSession.room, savedSession.files, false, savedSession);
      void (async () => {
        try {
          await apiJoinRoom(savedSession.room.code);
          const freshRoom = await getRoom(savedSession.room.code);
          const roomFiles = await getRoomFiles(savedSession.room.code).catch(() => savedSession.files);
          openRoom(freshRoom, roomFiles.length > 0 ? roomFiles : savedSession.files, false, savedSession);
        } catch {
          showToast('Restored your room locally while the hosted services reconnect.');
        }
      })();
      return;
    }

    if (joinCode) {
      const code = normalizeRoomCode(joinCode);
      setLandingCode(code);
      requestRoomEntry('join', code);
    }
  }, [authReady, user.id]);

  useEffect(() => {
    if (!room) {
      return;
    }

    persistRoomSession({
      room,
      files,
      openFileIds,
      activeFileId,
      expandedFolderPaths: [...expandedFolders],
      cursorPosition,
      roomLocked,
      leadUserId,
      chatOpen,
      explorerOpen,
      landingCode,
      chatDraft
    });
  }, [activeFileId, chatDraft, chatOpen, cursorPosition, expandedFolders, explorerOpen, files, landingCode, leadUserId, openFileIds, room, roomLocked]);

  useEffect(() => {
    if (!room) {
      return;
    }

    let cancelled = false;
    listChatHistory(room.code)
      .then((history) => {
        if (!cancelled) {
          setMessages(history);
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [room]);

  useEffect(() => {
    if (!room || !activeFile || !isUuid(activeFile.id)) {
      setAnnotations([]);
      return;
    }

    let cancelled = false;
    listAnnotations(room.code, activeFile.id)
      .then((items) => {
        if (!cancelled) {
          setAnnotations(items);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAnnotations([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeFile, room]);

  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  const { client: stompClient, clientRef: stompRef, connected: stompConnected } = useRoomConnection(room?.code ?? null, {
    onChat: (message) => {
      const chatMessage = JSON.parse(message.body) as ChatMessage;
      const activeUser = userRef.current;
      if (chatMessage.userId !== activeUser.id && messageMentionsUser(chatMessage.content, activeUser, mentionOptionsRef.current)) {
        showToast(`${displayNameOrPear(chatMessage.displayName)} mentioned you`);
      }
      setMessages((current) => [...current, chatMessage].slice(-60));
    },
    onCursor: (message) => {
      const cursor = JSON.parse(message.body) as CursorMessage;
      if (cursor.userId !== userRef.current.id) {
        setCursors((current) => ({ ...current, [cursor.userId]: cursor }));
      }
    },
    onMember: (message, client) => handleMemberEvent(JSON.parse(message.body) as MemberRealtimeEvent, client),
    onAnnotation: (message) => {
      const annotation = JSON.parse(message.body) as AiAnnotation;
      setAnnotations((current) => upsertAnnotation(current, annotation).slice(-5));
    },
    onProjectSwitch: (message) => handleProjectSwitchEvent(JSON.parse(message.body) as ProjectSwitchEvent),
    onConnected: (client) => {
      const currentUser = userRef.current;
      client.publish({
        destination: `/app/room/${room!.code}/members`,
        body: JSON.stringify({
          type: 'joined', userId: currentUser.id, sessionId: currentUser.id, connectionId,
          displayName: currentUser.name, color: currentUser.color, avatarUrl: currentUser.avatarUrl,
          leadUserId: leadUserIdRef.current, locked: roomLockedRef.current, at: new Date().toISOString()
        })
      });
      flushPendingUploadSyncs(client);
    },
    onHeartbeat: (client) => {
      const currentUser = userRef.current;
      client.publish({
        destination: `/app/room/${room!.code}/members`,
        body: JSON.stringify({
          type: 'presence-sync', userId: currentUser.id, sessionId: currentUser.id, connectionId,
          displayName: currentUser.name, color: currentUser.color, avatarUrl: currentUser.avatarUrl,
          leadUserId: leadUserIdRef.current, locked: roomLockedRef.current, targetUserId: currentUser.id,
          at: new Date().toISOString()
        })
      });
    }
  });

  const { peerCount, syncStatus } = useCollaborativeDocument({
    editor: editorRef,
    editorMountVersion,
    file: activeFile,
    filesRef,
    onFilesChange: setFiles,
    realtimeToken,
    roomCode: room?.code ?? null,
    suppressEditorChange: suppressEditorChangeRef,
    user,
    yjsUrl: YJS_URL
  });

  useEffect(() => {
    const editor = editorRef.current as any;
    const monaco = monacoRef.current;
    if (!editor || !monaco || !activeFile) {
      return;
    }

    clearCursorWidgets(editor);
    for (const cursor of Object.values(cursors)) {
      if (cursor.userId === user.id || cursor.fileId !== activeFile.id) {
        continue;
      }
      const node = document.createElement('div');
      node.className = 'remote-cursor-widget';
      node.style.borderLeftColor = cursor.color;
      node.style.backgroundColor = `${cursor.color}1F`;
      node.textContent = cursor.displayName;

      const widget = {
        getId: () => `remote-cursor-${cursor.userId}`,
        getDomNode: () => node,
        getPosition: () => ({
          position: { lineNumber: Math.max(1, cursor.line), column: Math.max(1, cursor.col) },
          preference: [monaco.editor.ContentWidgetPositionPreference.ABOVE]
        })
      };
      editor.addContentWidget(widget);
      cursorWidgetsRef.current.set(cursor.userId, widget);
    }

    return () => clearCursorWidgets(editor);
  }, [activeFile, cursors, user.id]);

  useEffect(() => {
    const editor = editorRef.current as any;
    const monaco = monacoRef.current;
    if (!editor || !monaco || !activeFile) {
      return;
    }

    clearAnnotationWidgets(editor);
    for (const annotation of annotations.filter((item) => item.fileId === activeFile.id)) {
      const node = document.createElement('div');
      node.className = 'ai-annotation-widget';

      const header = document.createElement('div');
      header.className = 'ai-annotation-header';
      header.textContent = `AI - line ${annotation.line}`;

      const close = document.createElement('button');
      close.className = 'ai-annotation-close';
      close.type = 'button';
      close.textContent = 'x';
      close.title = 'Dismiss annotation';
      close.addEventListener('click', () => {
        setAnnotations((current) => current.filter((item) => item.id !== annotation.id));
        if (isUuid(annotation.id)) {
          void dismissAnnotation(annotation.id).catch(() => undefined);
        }
      });

      const body = document.createElement('p');
      body.textContent = annotation.content;

      header.appendChild(close);
      node.appendChild(header);
      node.appendChild(body);

      const widget = {
        getId: () => `ai-annotation-${annotation.id}`,
        getDomNode: () => node,
        getPosition: () => ({
          position: { lineNumber: Math.max(1, annotation.line), column: 1 },
          preference: [monaco.editor.ContentWidgetPositionPreference.BELOW]
        })
      };
      editor.addContentWidget(widget);
      annotationWidgetsRef.current.set(annotation.id, widget);
    }

    return () => clearAnnotationWidgets(editor);
  }, [activeFile, annotations]);

  if (!room) {
    return (
      <>
        <LandingPage
          backendWakeUrl={BACKEND_WAKE_URL}
          code={landingCode}
          creating={creatingRoom}
          error={landingError}
          joining={joiningRoom}
          notice={landingNotice}
          onCodeChange={setLandingCode}
          onCreate={() => requestRoomEntry('create')}
          onJoin={() => requestRoomEntry('join')}
          realtimeWakeUrl={REALTIME_WAKE_URL}
        />
        {entryProfileOpen && (
          <EntryProfileModal
            action={pendingRoomAction}
            avatarInputRef={entryAvatarInputRef}
            avatarUrl={entryProfileAvatar}
            color={user.color}
            error={entryProfileError}
            name={entryProfileName}
            onAvatarInput={handleEntryAvatarInput}
            onCancel={closeEntryProfile}
            onConfirm={() => void confirmEntryProfile()}
            onNameChange={setEntryProfileName}
          />
        )}
        <Toast message={toastMessage} />
      </>
    );
  }

  const hasApproved = pendingSwitch?.approvedUserIds.includes(user.id) ?? false;
  const workspaceClass = [
    'workspace-grid',
    explorerOpen ? '' : 'explorer-collapsed',
    chatOpen ? '' : 'chat-collapsed'
  ].filter(Boolean).join(' ');

  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="brand brand-link" onClick={() => returnToLanding()} type="button">
          <img alt="" className="brand-logo" src={pearLogoUrl} />
          <span>PearProgramming</span>
        </button>
        <div className="room-header-center">
          <button className="room-code-chip" onClick={copyRoomCode} title="Copy room code" type="button">
            <span>Room Code: {room.code}</span>
            <Copy size={13} />
          </button>
          <span className={`role-chip ${isLeadPear ? 'role-lead' : ''}`}>{roleLabel}</span>
        </div>
        <div className="topbar-actions">
          <div className="collaborators" aria-label="Collaborators">
            <span className="online-dot" />
            <span className="online-count">{Math.max(1, humanMembers.length)} online</span>
            {members.map((member) => member.id === user.id ? (
              <button
                className="avatar avatar-button"
                key={member.id}
                onClick={() => openProfileEditor(user)}
                style={{ backgroundColor: `${member.color}22`, color: member.color }}
                title="Edit profile"
                type="button"
              >
                {member.avatarUrl ? <img alt="" src={member.avatarUrl} /> : initials(member.name)}
              </button>
            ) : (
              <span
                className={`avatar ${member.ai ? 'avatar-ai' : ''}`}
                key={member.id}
                style={{ backgroundColor: member.ai ? '#EEEDFE' : `${member.color}22`, color: member.color }}
                title={member.name}
              >
                {member.ai ? <Bot size={13} /> : member.avatarUrl ? <img alt="" src={member.avatarUrl} /> : initials(member.name)}
              </span>
            ))}
          </div>
          <div className="pear-menu">
            <button
              aria-expanded={pearMenuOpen}
              className="topbar-button pear-menu-trigger"
              onClick={() => setPearMenuOpen((current) => !current)}
              type="button"
            >
              <span>Pear Menu</span>
            </button>
            {pearMenuOpen && (
              <div className="pear-menu-popover">
                {isLeadPear && (
                  <button onClick={runPearMenuAction(handleToggleRoomLock)} type="button">
                    {roomLocked ? 'Unlock Room' : 'Lock Room'}
                  </button>
                )}
                <button onClick={runPearMenuAction(handleLeaveRoom)} type="button">Leave Room</button>
                <button onClick={runPearMenuAction(() => void handleSignOut())} type="button">Sign Out</button>
                {isLeadPear && (
                  <button className="danger-menu-item" onClick={runPearMenuAction(handleCloseRoom)} type="button">
                    Close Room
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      <section className={workspaceClass}>
        {explorerOpen ? (
        <aside className="explorer">
          <div className="pane-title-row">
            <span className="pane-title">Explorer</span>
            <div className="icon-row">
              <button className="icon-button" onClick={handleNewFile} type="button" title="New file">
                <FilePlus2 size={15} />
              </button>
              <button className="icon-button" onClick={handleNewFolder} type="button" title="New folder">
                <FolderPlus size={15} />
              </button>
              <button className="icon-button" disabled={files.length === 0} onClick={exportWorkspace} type="button" title="Download project">
                <Download size={15} />
              </button>
              <button className="icon-button panel-minimize-button" onClick={() => setExplorerOpen(false)} type="button" title="Minimize explorer">
                -
              </button>
            </div>
          </div>
          <div className="upload-actions">
            <button className="upload-button" onClick={openUploadModal} type="button">
              <Upload size={14} />
              <span>Upload File</span>
            </button>
            <button className="upload-button" onClick={openUploadModal} type="button">
              <FolderPlus size={14} />
              <span>Upload Folder</span>
            </button>
          </div>
          {/* Hidden file input — individual files, no webkitdirectory */}
          <input
            className="hidden-file-input"
            multiple
            accept={UPLOAD_ACCEPT}
            onChange={(event) => void handleUploadInput(event.currentTarget, false)}
            ref={fileInputRef}
            type="file"
          />
          {/* Hidden folder input — sets webkitdirectory at click time */}
          <input className="hidden-file-input" multiple onChange={(event) => void handleUploadInput(event.currentTarget, true)} ref={folderInputRef} type="file" />
          {uploadNotice && (
            <div className="upload-notice" role="status">
              <span className="upload-notice-icon">
                <Check size={15} />
              </span>
              <p>{uploadNotice}</p>
              <button onClick={() => setUploadNotice('')} type="button" title="Dismiss upload notice">
                <X size={13} />
              </button>
            </div>
          )}
          <div className="tree"><FileTree activeFileId={activeFile?.id ?? ''} expandedFolders={expandedFolders} files={files}
            onDeletePath={deleteTreePath} onFileSelect={openFileTab} onToggleFolder={toggleFolder} /></div>
        </aside>
        ) : (
          <aside className="explorer-rail">
            <button className="chat-rail-button" onClick={() => setExplorerOpen(true)} title="Show explorer" type="button">
              <Folder size={17} />
            </button>
          </aside>
        )}

        <section className="editor-area">
          <div className="tabs">
            {openFiles.map((file) => (
              <div className={`tab ${file.id === activeFile?.id ? 'tab-active' : ''}`} key={file.id}>
                <button className="tab-main" onClick={() => setActiveFileId(file.id)} title={file.path} type="button">
                  <span className={`language-dot ${languageClass(file.language)}`} />
                  <span>{basename(file.path)}</span>
                </button>
                <button className="tab-close" onClick={() => closeFileTab(file.id)} title={`Close ${basename(file.path)}`} type="button">
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
          <ExecutionToolbar
            activeFile={Boolean(activeFile)}
            consoleOpen={executionPanelOpen}
            language={executionLanguage}
            onLanguageChange={setExecutionLanguage}
            onRun={() => void runActiveFile()}
            onToggleConsole={() => setExecutionPanelOpen((current) => !current)}
            submitting={executionSubmitting}
          />
          <div className="editor-frame">
            {activeFile ? (
              <Editor
                height="100%"
                language={activeFile.language}
                onMount={handleEditorMount}
                options={{
                  automaticLayout: true,
                  fontFamily: 'JetBrains Mono, Consolas, monospace',
                  fontSize: 14,
                  lineHeight: 22,
                  minimap: { enabled: false },
                  padding: { top: 14, bottom: 14 },
                  scrollBeyondLastLine: false,
                  tabSize: 2
                }}
                path={activeFile.path}
                theme="pear-github-dark"
                defaultValue={activeFile.content}
              />
            ) : (
              <div className="empty-editor">
                <div className="empty-editor-content">
                  <img alt="" className="empty-pear-idle" src={pearLogoUrl} />
                  <h1>Upload files or a project folder to start coding together.</h1>
                  <p>Your shared file tree will appear here after uploading.</p>
                  <div className="empty-editor-actions">
                    <button onClick={openUploadModal} type="button">
                      <Upload size={16} />
                      Upload Files
                    </button>
                    <button onClick={openUploadModal} type="button">
                      <FolderPlus size={16} />
                      Upload Folder
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
          {executionPanelOpen && (
            <ExecutionConsole
              error={executionError}
              onClear={clearExecutionConsole}
              onRerun={() => void runActiveFile()}
              onStdinChange={setExecutionStdin}
              result={executionResult}
              stdin={executionStdin}
              submitting={executionSubmitting}
            />
          )}
        </section>

        {chatOpen ? (
          <ChatPanel
            activeMentionIndex={mentionActiveIndex}
            draft={chatDraft}
            error={chatError}
            inputRef={chatInputRef}
            mentionOptions={filteredMentionOptions}
            messages={messages}
            nowLabel={formatPacificTime(pacificNow.toISOString())}
            onClose={() => setChatOpen(false)}
            onDraftInput={(input) => {
              setChatDraft(input.value);
              setChatError('');
              updateMentionState(input);
            }}
            onInsertMention={insertMentionIntoDraft}
            onMentionKeyDown={handleMentionKeyDown}
            onSend={sendChat}
            renderContent={(message) => renderMessageContent(message.content, mentionOptions, insertMentionIntoDraft)}
            user={user}
            messageMentionsUser={(message) => messageMentionsUser(message.content, user, mentionOptions)}
          />
        ) : (
          <aside className="chat-rail">
            <button className="chat-rail-button" onClick={() => setChatOpen(true)} title="Show chat" type="button">
              <MessageSquare size={17} />
            </button>
          </aside>
        )}
      </section>

      <footer className="statusbar">
        <span className="status-pill">{activeFile?.language ?? 'plaintext'}</span>
        <span>Ln {cursorPosition.line}, Col {cursorPosition.col}</span>
        <span className="sync-status">
          {stompConnected ? <Wifi size={13} /> : <WifiOff size={13} />}
          {syncStatus} - {peerCount} peers
        </span>
        <span>{saveStatusText(saveState, lastSavedAt)}</span>
        <span className="encoding">UTF-8 - LF</span>
      </footer>

      {uploadModalOpen && (
        <UploadModal
          dragging={uploadDragging}
          onCancel={closeUploadModal}
          onChooseFiles={chooseFilesFromUploadModal}
          onChooseFolder={chooseFolderFromUploadModal}
          onDragLeave={() => setUploadDragging(false)}
          onDragOver={() => setUploadDragging(true)}
          onDrop={(event) => void handleUploadDrop(event)}
        />
      )}

      {pendingSwitch && (
        <div className="modal-backdrop">
          <section className="confirm-modal" role="dialog" aria-modal="true" aria-label="Confirm project switch">
            <header>
              <h2>Switch project?</h2>
              <span>{pendingSwitch.approvedUserIds.length}/{pendingSwitch.requiredUserIds.length} agreed</span>
            </header>
            <p>
              Agree to switch from <strong>{pendingSwitch.currentFolder}</strong> to <strong>{pendingSwitch.newFolder}</strong>?
            </p>
            <div className="modal-actions">
              <button className="secondary-button" onClick={declineProjectSwitch} type="button">
                <X size={15} />
                Decline
              </button>
              <button className="primary-button" disabled={hasApproved} onClick={approveProjectSwitch} type="button">
                <Check size={15} />
                {hasApproved ? 'Agreed' : 'Agree'}
              </button>
            </div>
          </section>
        </div>
      )}

      {delegateOpen && (
        <div className="modal-backdrop">
          <section className="confirm-modal" role="dialog" aria-modal="true" aria-label="Choose new Lead Pear">
            <header>
              <h2>Delegate Lead Pear</h2>
            </header>
            <p>Select the participant who should own this room after you leave.</p>
            <label className="field-label">
              New Lead Pear
              <select onChange={(event) => setDelegateUserId(event.target.value)} value={delegateUserId}>
                {delegateCandidates.map((member) => (
                  <option key={member.id} value={member.id}>{member.name}</option>
                ))}
              </select>
            </label>
            <div className="modal-actions">
              <button className="secondary-button" onClick={() => setDelegateOpen(false)} type="button">Cancel</button>
              <button className="primary-button" disabled={!delegateUserId} onClick={confirmDelegateAndLeave} type="button">
                Transfer and leave
              </button>
            </div>
          </section>
        </div>
      )}

      {profileOpen && (
        <div className="modal-backdrop">
          <section className="profile-modal" role="dialog" aria-modal="true" aria-label="Profile">
            <header>
              <h2>Profile</h2>
              <button className="icon-button" onClick={() => setProfileOpen(false)} title="Close profile" type="button">
                <X size={14} />
              </button>
            </header>
            <div className="profile-preview">
              <span className="profile-avatar" style={{ backgroundColor: `${user.color}22`, color: user.color }}>
                {profileDraftAvatar ? <img alt="" src={profileDraftAvatar} /> : <UserRound size={22} />}
              </span>
              <button className="secondary-button" onClick={() => avatarInputRef.current?.click()} type="button">
                <ImagePlus size={15} />
                Upload photo
              </button>
              <input accept=".jpg,.jpeg,.png,.webp" className="hidden-file-input" onChange={(event) => void handleAvatarInput(event.currentTarget)} ref={avatarInputRef} type="file" />
            </div>
            <label className="field-label">
              Display name
              <input onChange={(event) => setProfileDraftName(event.target.value)} value={profileDraftName} />
            </label>
            <div className="modal-actions">
              <button className="secondary-button" onClick={() => setProfileOpen(false)} type="button">Cancel</button>
              <button className="primary-button" onClick={saveProfile} type="button">Save</button>
            </div>
          </section>
        </div>
      )}
      {createItemKind && (
        <CreateItemModal
          error={createItemError}
          kind={createItemKind}
          name={createItemName}
          onCancel={closeCreateItemModal}
          onConfirm={confirmCreateItem}
          onNameChange={setCreateItemName}
        />
      )}
      <Toast message={toastMessage} />
    </main>
  );

  function requestRoomEntry(action: PendingRoomAction, codeOverride = landingCode) {
    if (action === 'join') {
      const code = normalizeRoomCode(codeOverride);
      if (!isValidRoomCode(code)) {
        setLandingError('Please enter in a valid pear room code');
        return;
      }
      setLandingCode(code);
    }

    setPendingRoomAction(action);
    setEntryProfileName(user.name === 'You' ? '' : user.name);
    setEntryProfileAvatar(user.avatarUrl);
    setEntryProfileError('');
    setEntryProfileOpen(true);
  }

  function closeEntryProfile() {
    setEntryProfileOpen(false);
    setPendingRoomAction(null);
    setEntryProfileError('');
  }

  async function handleEntryAvatarInput(input: HTMLInputElement) {
    const file = input.files?.[0];
    input.value = '';
    if (!file) {
      return;
    }

    if (!isAllowedProfileImage(file)) {
      setEntryProfileError('Profile picture must be a JPG, PNG, or WEBP image.');
      return;
    }

    setEntryProfileError('');
    setEntryProfileAvatar(await fileToDataUrl(file));
  }

  async function confirmEntryProfile() {
    const displayName = entryProfileName.trim();
    if (!displayName) {
      setEntryProfileError('Display name is required.');
      return;
    }

    const action = pendingRoomAction;
    try {
      await signIn(displayName, entryProfileAvatar);
    } catch {
      setEntryProfileError('Could not create a secure session. Try again.');
      return;
    }
    setEntryProfileOpen(false);
    setPendingRoomAction(null);
    setEntryProfileError('');

    if (action === 'create') {
      await handleCreateRoom();
      return;
    }

    if (action === 'join') {
      await handleJoinRoom(landingCode, displayName);
    }
  }

  function openRoom(nextRoom: Room, nextFiles: WorkspaceFile[], replaceUrl: boolean, restoredState?: RoomSessionState) {
    const sortedFiles = nextFiles.sort(sortByPath);
    const restoredOpenFileIds = restoredState?.openFileIds ?? [];
    const nextOpenFileIds = restoredOpenFileIds.filter((fileId) => sortedFiles.some((file) => file.id === fileId));
    const fallbackOpenFileId = sortedFiles[0]?.id ?? null;
    const nextActiveFileId = restoredState?.activeFileId && sortedFiles.some((file) => file.id === restoredState.activeFileId)
      ? restoredState.activeFileId
      : nextOpenFileIds[0] ?? fallbackOpenFileId;
    filesRef.current = sortedFiles;
    openFileIdsRef.current = nextOpenFileIds.length > 0 ? nextOpenFileIds : nextActiveFileId ? [nextActiveFileId] : [];
    activeFileIdRef.current = nextActiveFileId;
    setRoom(nextRoom);
    setFiles(sortedFiles);
    setOpenFileIds(openFileIdsRef.current);
    setActiveFileId(nextActiveFileId);
    setExpandedFolders(restoredState ? new Set(restoredState.expandedFolderPaths) : foldersForPaths(sortedFiles.map((file) => file.path)));
    setMessages([]);
    setAnnotations([]);
    setCursors({});
    setPresenceMembers({});
    setLeadUserId(nextRoom.leadUserId);
    setRoomLocked(nextRoom.locked);
    setPearMenuOpen(false);
    setExplorerOpen(restoredState?.explorerOpen ?? true);
    setChatOpen(restoredState?.chatOpen ?? true);
    setDelegateOpen(false);
    setDelegateUserId('');
    setUploadNotice('');
    setLandingCode(restoredState?.landingCode ?? nextRoom.code);
    setLandingNotice('');
    setChatDraft(restoredState?.chatDraft ?? '');
    setCursorPosition(restoredState?.cursorPosition ?? { line: 1, col: 1 });
    setSaveState(sortedFiles.length > 0 ? 'saved' : 'idle');
    setLastSavedAt(null);
    clearExecutionConsole();
    if (replaceUrl) {
      window.history.replaceState(null, '', `/join/${nextRoom.code}`);
    }
  }

  function sendChat() {
    const content = chatDraft.trim();
    if (!content || !room) {
      return;
    }

    const invalidMentions = invalidMentionLabels(content, mentionOptions);
    if (invalidMentions.length > 0) {
      setChatError(`Unknown username: @${invalidMentions[0]}`);
      return;
    }

    setMentionState((current) => ({ ...current, open: false }));
    setChatError('');
    const mentionsAi = content.toUpperCase().includes('@AI');
    if (stompClient?.connected) {
      stompClient.publish({
        destination: `/app/room/${room.code}/chat`,
        body: JSON.stringify({
          userId: user.id,
          displayName: user.name,
          content,
          currentFileId: activeFile?.id,
          currentFile: activeFile?.path,
          currentLine: cursorPosition.line,
          currentFileContent: mentionsAi ? activeFileContextForAi(activeFile, cursorPosition.line, editorRef.current) : undefined
        })
      });
    } else {
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          userId: user.id,
          displayName: user.name,
          content,
          ai: false,
          createdAt: new Date().toISOString()
        },
        ...(mentionsAi
          ? [{
              id: crypto.randomUUID(),
              userId: null,
              displayName: 'AI',
              content: 'PearAI is unavailable because realtime chat is disconnected. Reconnect to the room and try again.',
              ai: true,
              createdAt: new Date().toISOString()
            }]
          : [])
      ].slice(-60));
    }

    setChatDraft('');
  }

  async function runActiveFile() {
    const currentRoom = roomRef.current;
    const currentFile = activeFileRef.current;
    if (!currentRoom || !currentFile || executionSubmitting) {
      return;
    }

    setExecutionPanelOpen(true);
    await submitActiveExecution(createExecutionInput({
      editor: editorRef.current as { getValue?: () => string } | null,
      fallbackSourceCode: currentFile.content,
      roomCode: currentRoom.code,
      language: executionLanguage,
      stdin: executionStdin
    }));
  }

  function updateMentionState(input: HTMLInputElement) {
    const cursor = input.selectionStart ?? input.value.length;
    const fragment = mentionFragmentAt(input.value, cursor);
    if (!fragment) {
      setMentionState((current) => ({ ...current, open: false, query: '', start: cursor, end: cursor }));
      setMentionActiveIndex(0);
      return;
    }

    setMentionState({ open: true, query: fragment.query, start: fragment.start, end: cursor });
    setMentionActiveIndex(0);
  }

  function handleMentionKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!mentionState.open || filteredMentionOptions.length === 0) {
      return false;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setMentionActiveIndex((current) => (current + 1) % filteredMentionOptions.length);
      return true;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setMentionActiveIndex((current) => (current - 1 + filteredMentionOptions.length) % filteredMentionOptions.length);
      return true;
    }

    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      insertMentionIntoDraft(filteredMentionOptions[Math.min(mentionActiveIndex, filteredMentionOptions.length - 1)]);
      return true;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      setMentionState((current) => ({ ...current, open: false }));
      return true;
    }

    return false;
  }

  function insertMentionIntoDraft(option: MentionOption) {
    const input = chatInputRef.current;
    const start = mentionState.open ? mentionState.start : chatDraft.length;
    const end = mentionState.open ? mentionState.end : chatDraft.length;
    const prefix = chatDraft.slice(0, start);
    const suffix = chatDraft.slice(end);
    const needsLeadingSpace = prefix.length > 0 && !/\s$/.test(prefix);
    const nextPrefix = `${prefix}${needsLeadingSpace ? ' ' : ''}@${option.label} `;
    const nextDraft = `${nextPrefix}${suffix.replace(/^\s+/, '')}`;
    const nextCursor = nextPrefix.length;
    setChatDraft(nextDraft);
    setChatError('');
    setMentionState({ open: false, query: '', start: nextCursor, end: nextCursor });
    window.setTimeout(() => {
      input?.focus();
      input?.setSelectionRange(nextCursor, nextCursor);
    }, 0);
  }

  function copyRoomCode() {
    const currentRoom = roomRef.current;
    if (currentRoom) {
      void navigator.clipboard.writeText(currentRoom.code);
    }
  }

  function showToast(message: string) {
    setToastMessage(message);
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => setToastMessage(''), 3600);
  }

  function runPearMenuAction(action: () => void) {
    return () => {
      setPearMenuOpen(false);
      action();
    };
  }

  function addSystemMessage(content: string) {
    setMessages((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        userId: null,
        displayName: 'System',
        content,
        ai: false,
        system: true,
        createdAt: new Date().toISOString()
      }
    ].slice(-60));
  }

  function openUploadModal() {
    setUploadModalOpen(true);
    setUploadDragging(false);
  }

  function closeUploadModal() {
    setUploadModalOpen(false);
    setUploadDragging(false);
  }

  function chooseFilesFromUploadModal() {
    openFilePicker();
  }

  function chooseFolderFromUploadModal() {
    openFolderPicker();
  }

  function openFilePicker() {
    const input = fileInputRef.current;
    if (!input) {
      return;
    }

    // Ensure webkitdirectory is NOT set for individual file selection
    input.removeAttribute('webkitdirectory');
    input.removeAttribute('directory');
    input.value = '';
    input.click();
  }

  function openFolderPicker() {
    const input = folderInputRef.current;
    if (!input) {
      return;
    }

    input.value = '';
    configureFolderInput(input);
    input.click();
  }

  async function handleUploadDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    setUploadDragging(false);

    if (!event.dataTransfer || (event.dataTransfer.files.length === 0 && event.dataTransfer.items.length === 0)) {
      return;
    }

    const uploadResult = await readDroppedUploadCandidates(event.dataTransfer);
    await processUploadResult(uploadResult);
  }

  function openFileTab(fileId: string) {
    setOpenFileIds((current) => (current.includes(fileId) ? current : [...current, fileId]));
    setActiveFileId(fileId);
  }

  function closeFileTab(fileId: string) {
    setOpenFileIds((current) => {
      const index = current.indexOf(fileId);
      const next = current.filter((id) => id !== fileId);
      if (activeFileId === fileId) {
        setActiveFileId(next[index] ?? next[index - 1] ?? null);
      }
      return next;
    });
  }

  function returnToLanding(notice = '') {
    clearExecutionConsole();
    if (contentSyncTimerRef.current) {
      window.clearTimeout(contentSyncTimerRef.current);
      contentSyncTimerRef.current = null;
    }
    pendingContentSyncRef.current = null;
    setRoom(null);
    setFiles([]);
    setOpenFileIds([]);
    setActiveFileId(null);
    setMessages([]);
    setAnnotations([]);
    setCursors({});
    setPresenceMembers({});
    setLeadUserId(null);
    setRoomLocked(false);
    setPearMenuOpen(false);
    setExplorerOpen(true);
    setChatOpen(true);
    setDelegateOpen(false);
    setDelegateUserId('');
    setPendingSwitch(null);
    setUploadNotice('');
    setSaveState('idle');
    setLastSavedAt(null);
    setLandingCode('');
    setLandingError('');
    setLandingNotice(notice);
    clearRoomSession();
    window.history.replaceState(null, '', '/');
  }

  function handleLeaveRoom() {
    if (!isLeadPear) {
      publishLeftMemberEvent();
      returnToLanding();
      return;
    }

    if (delegateCandidates.length > 0) {
      setDelegateUserId(delegateCandidates[0].id);
      setDelegateOpen(true);
      return;
    }

    publishMemberEvent({
      type: 'room-closed',
      userId: user.id,
      sessionId: user.id,
      connectionId,
      displayName: user.name,
      color: user.color,
      avatarUrl: user.avatarUrl,
      leadUserId: user.id,
      at: new Date().toISOString()
    });
    returnToLanding();
  }

  async function handleSignOut() {
    publishLeftMemberEvent();
    try {
      await signOut();
    } finally {
      returnToLanding('Signed out.');
    }
  }

  function handleCloseRoom() {
    if (!isLeadPear || !window.confirm('Close this room for everyone?')) {
      return;
    }

    publishMemberEvent({
      type: 'room-closed',
      userId: user.id,
      sessionId: user.id,
      connectionId,
      displayName: user.name,
      color: DEFAULT_COLOR,
      avatarUrl: user.avatarUrl,
      leadUserId: user.id,
      at: new Date().toISOString()
    });
    returnToLanding('Room closed.');
  }

  function handleToggleRoomLock() {
    if (!isLeadPear) {
      return;
    }

    const nextLocked = !roomLocked;
    setRoomLocked(nextLocked);
    publishMemberEvent({
      type: 'lock-changed',
      userId: user.id,
      sessionId: user.id,
      connectionId,
      displayName: user.name,
      color: DEFAULT_COLOR,
      avatarUrl: user.avatarUrl,
      leadUserId: user.id,
      locked: nextLocked,
      at: new Date().toISOString()
    });
  }

  function confirmDelegateAndLeave() {
    const nextLead = delegateCandidates.find((member) => member.id === delegateUserId);
    if (!nextLead) {
      return;
    }

    publishMemberEvent({
      type: 'lead-transferred',
      userId: user.id,
      sessionId: user.id,
      connectionId,
      displayName: user.name,
      color: DEFAULT_COLOR,
      avatarUrl: user.avatarUrl,
      leadUserId: nextLead.id,
      targetUserId: nextLead.id,
      targetUserName: nextLead.name,
      at: new Date().toISOString()
    });
    publishLeftMemberEvent();
    returnToLanding();
  }

  async function handleNewFile() {
    openCreateItemModal('file');
  }

  async function handleNewFolder() {
    openCreateItemModal('folder');
  }

  function openCreateItemModal(kind: 'file' | 'folder') {
    setCreateItemKind(kind);
    setCreateItemName(kind === 'file' ? 'new-file' : 'new-folder');
    setCreateItemError('');
  }

  function closeCreateItemModal() {
    setCreateItemKind(null);
    setCreateItemName('');
    setCreateItemError('');
  }

  async function confirmCreateItem() {
    const currentKind = createItemKind;
    const name = createItemName.trim();
    const existingPaths = files.map((file) => file.path);

    if (!currentKind) {
      return;
    }

    const target = resolveCreateItemTarget(currentKind, name, existingPaths);
    if ('error' in target && target.error) {
      setCreateItemError(target.error);
      return;
    }

    setCreateItemError('');
    const resolvedPath = target.path;
    if (!resolvedPath) {
      setCreateItemError('Name is required.');
      return;
    }

    const currentRoom = roomRef.current;
    if (!currentRoom) {
      setCreateItemError('Join a room before creating files.');
      return;
    }
    try {
      const workspaceId = currentRoom.workspaceId;
      if (currentKind === 'file') {
        const local = await createWorkspaceFile(workspaceId, resolvedPath, '', user.id);
        const nextFiles = applyUploadedFiles([local], false, true);
        persistRoomFilesSnapshot(nextFiles);
        queueOrPublishProjectSwitch(createFileTreeEvent(nextFiles, false, false));
        openFileTab(local.id);
        expandForPath(resolvedPath);
      } else {
        const local = await createWorkspaceFile(workspaceId, `${resolvedPath}/.gitkeep`, '', user.id);
        const nextFiles = applyUploadedFiles([local], false, false);
        persistRoomFilesSnapshot(nextFiles);
        queueOrPublishProjectSwitch(createFileTreeEvent(nextFiles, false, false));
        expandForPath(resolvedPath);
      }
    } catch {
      setCreateItemError('Could not create this item in your authenticated workspace.');
      return;
    }

    closeCreateItemModal();
  }

  async function handleUploadInput(input: HTMLInputElement, isFolder: boolean) {
    if (!input.files || input.files.length === 0) {
      return;
    }

    if (isFolder) {
      // Folder picker: require webkitRelativePath so structure is preserved
      const hasFolderPaths = Array.from(input.files).some(
        (file) => Boolean((file as File & { webkitRelativePath?: string }).webkitRelativePath)
      );
      if (!hasFolderPaths) {
        input.value = '';
        setUploadNotice('Please choose a folder so PearProgramming can preserve the project structure.');
        setSaveState('error');
        return;
      }
    }

    const uploadResult = await readUploadCandidates(input.files);
    input.value = '';
    await processUploadResult(uploadResult);
  }

  async function processUploadResult(uploadResult: UploadReadResult) {
    const candidates = uploadResult.candidates;
    setUploadNotice(uploadNoticeText(uploadResult));
    if (candidates.length === 0) {
      setSaveState('error');
      return;
    }

    closeUploadModal();
    const newFolder = projectNameForPaths(candidates.map((file) => file.path));
    const isSwitch = files.length > 0;
    const openUploaded = uploadResult.source === 'files' && candidates.length === 1;
    const requiredUserIds = humanMembers.map((member) => member.id);

    if (isSwitch && requiredUserIds.length > 1 && stompRef.current?.connected) {
      const proposalId = crypto.randomUUID();
      const proposal: PendingSwitch = {
        proposalId,
        currentFolder: activeProjectName,
        newFolder,
        proposerId: user.id,
        proposerName: user.name,
        requiredUserIds,
        approvedUserIds: [user.id]
      };
      pendingUploadRef.current = { proposalId, candidates, newFolder, openUploaded };
      setPendingSwitch(proposal);
      publishProjectSwitch({
        type: 'proposed',
        ...proposal,
        at: new Date().toISOString()
      });
      return;
    }

    void persistUploadCandidates(candidates, isSwitch, openUploaded).then((localFiles) => {
      if (localFiles.length === 0) {
        return;
      }

      const fileTreeEvent: ProjectSwitchEvent = {
        type: 'files-updated',
        proposalId: crypto.randomUUID(),
        currentFolder: activeProjectName,
        newFolder,
        proposerId: user.id,
        proposerName: user.name,
        files: localFiles,
        replaceExisting: isSwitch,
        openUploaded: false,
        at: new Date().toISOString()
      };

      queueOrPublishProjectSwitch(fileTreeEvent);
    });
  }

  async function createWorkspaceFile(workspaceId: string, path: string, content: string, createdById: string) {
    setSaveState('saving');
    try {
      const saved = await createFile(workspaceId, path, content, inferLanguage(path));
      setSaveState('saved');
      setLastSavedAt(new Date().toISOString());
      return { ...saved, createdById };
    } catch {
      setSaveState('offline');
      return createLocalFile(path, workspaceId, createdById);
    }
  }

  async function persistUploadCandidates(candidates: UploadCandidate[], replaceExisting: boolean, openUploaded = true) {
    const currentRoom = roomRef.current;
    if (!currentRoom) {
      return [];
    }

    setSaveState('saving');
    const workspaceId = currentRoom.workspaceId;
    try {
      const persisted = await uploadWorkspaceFiles(workspaceId, candidates, replaceExisting);
      const uploaded = persisted.length > 0
        ? persisted.map((file) => ({ ...file, createdById: user.id }))
        : candidates.map((candidate) => createLocalFileFromCandidate(candidate, workspaceId, user.id));
      const nextFiles = applyUploadedFiles(uploaded, replaceExisting, openUploaded);
      persistRoomFilesSnapshot(nextFiles);
      await seedYjsDocuments(uploaded);
      setSaveState('saved');
      setLastSavedAt(new Date().toISOString());
      return nextFiles;
    } catch {
      const local = candidates.map((candidate) => createLocalFileFromCandidate(candidate, workspaceId, user.id));
      const nextFiles = applyUploadedFiles(local, replaceExisting, openUploaded);
      persistRoomFilesSnapshot(nextFiles);
      await seedYjsDocuments(local);
      setSaveState('offline');
      setLastSavedAt(new Date().toISOString());
      return nextFiles;
    }
  }

  function applyUploadedFiles(uploaded: WorkspaceFile[], replaceExisting: boolean, openUploaded = true) {
    const next = (replaceExisting ? uploaded : mergeFiles(filesRef.current, uploaded)).sort(sortByPath);
    const nextFileIds = new Set(next.map((file) => file.id));
    const uploadedIds = uploaded.map((file) => file.id).filter((fileId) => nextFileIds.has(fileId));
    const retainedOpenIds = openFileIdsRef.current.filter((fileId) => nextFileIds.has(fileId));
    const nextOpenIds = openUploaded
      ? replaceExisting
        ? uploadedIds
        : uniqueStrings([...retainedOpenIds, ...uploadedIds])
      : retainedOpenIds;
    const fallbackOpenIds = openUploaded && nextOpenIds.length === 0 && next[0] ? [next[0].id] : nextOpenIds;
    const nextActiveId = openUploaded
      ? uploadedIds[0] ?? fallbackOpenIds[0] ?? null
      : fallbackOpenIds.includes(activeFileIdRef.current ?? '') ? activeFileIdRef.current : fallbackOpenIds[0] ?? null;
    filesRef.current = next;
    openFileIdsRef.current = fallbackOpenIds;
    activeFileIdRef.current = nextActiveId;
    setFiles(next);
    setOpenFileIds(fallbackOpenIds);
    setActiveFileId(nextActiveId);
    setExpandedFolders(foldersForPaths(next.map((file) => file.path)));
    return next;
  }

  function applyRemoteFileContentUpdates(incomingFiles: WorkspaceFile[]) {
    if (incomingFiles.length === 0) {
      return;
    }

    const incomingById = new Map(incomingFiles.map((file) => [file.id, file]));
    const incomingByPath = new Map(incomingFiles.map((file) => [file.path, file]));
    const appliedIncomingIds = new Set<string>();
    const activeId = activeFileIdRef.current;
    const hasRecentLocalEdit = Date.now() - lastLocalEditAtRef.current < 750;
    let activeContent: string | null = null;
    let changed = false;

    const nextFiles = filesRef.current.map((file) => {
      const incoming = incomingById.get(file.id) ?? incomingByPath.get(file.path);
      if (!incoming) {
        return file;
      }

      appliedIncomingIds.add(incoming.id);
      if (file.id === activeId && hasRecentLocalEdit) {
        return file;
      }

      const nextFile = {
        ...file,
        ...incoming,
        id: file.id,
        workspaceId: file.workspaceId,
        path: incoming.path || file.path,
        language: incoming.language || file.language,
        content: incoming.content ?? file.content,
        updatedAt: incoming.updatedAt || new Date().toISOString()
      };
      if (nextFile.content !== file.content || nextFile.updatedAt !== file.updatedAt || nextFile.path !== file.path) {
        changed = true;
      }
      if (file.id === activeId) {
        activeContent = nextFile.content;
      }
      return nextFile;
    });

    const existingIds = new Set(filesRef.current.map((file) => file.id));
    for (const incoming of incomingFiles) {
      if (!existingIds.has(incoming.id) && !appliedIncomingIds.has(incoming.id)) {
        nextFiles.push(incoming);
        changed = true;
      }
    }

    if (!changed) {
      return;
    }

    const sorted = nextFiles.sort(sortByPath);
    filesRef.current = sorted;
    setFiles(sorted);
    if (activeContent !== null) {
      replaceActiveEditorContent(activeContent);
    }
  }

  function persistRoomFilesSnapshot(nextFiles: WorkspaceFile[]) {
    const currentRoom = roomRef.current;
    if (!currentRoom || currentRoom.code === FALLBACK_ROOM.code) {
      return;
    }

    void saveRoomFiles(currentRoom.code, nextFiles).catch((error) => {
      console.warn('Room file snapshot save failed', { roomCode: currentRoom.code, error });
    });
  }

  async function seedYjsDocuments(uploaded: WorkspaceFile[]) {
    const currentRoom = roomRef.current;
    if (!currentRoom || currentRoom.code === FALLBACK_ROOM.code || !YJS_URL) {
      return;
    }

    const filesToSeed = uploaded.filter((file) => isUuid(file.id) && file.content.length > 0);
    for (let index = 0; index < filesToSeed.length; index += 8) {
      const batch = filesToSeed.slice(index, index + 8);
      await Promise.all(batch.map((file) => seedYjsDocument(currentRoom.code, file)));
    }
  }

  function seedYjsDocument(roomCode: string, file: WorkspaceFile) {
    seedingFileIdsRef.current.add(file.id);
    return new Promise<void>((resolve) => {
      const ydoc = new Y.Doc();
      const provider = new WebsocketProvider(YJS_URL, `${roomCode}/${file.id}`, ydoc, {
        params: { access_token: realtimeToken }
      });
      const yText = ydoc.getText('monaco');
      const yMeta = ydoc.getMap('meta');
      let finished = false;

      const cleanup = () => {
        if (finished) {
          return;
        }
        finished = true;
        provider.off('sync', seedWhenSynced);
        provider.destroy();
        ydoc.destroy();
        seedingFileIdsRef.current.delete(file.id);
        resolve();
      };

      const seedWhenSynced = (synced: boolean) => {
        if (!synced) {
          return;
        }
        ydoc.transact(() => {
          if (!yMeta.get('initialized') && yText.length === 0 && file.content) {
            yText.insert(0, file.content);
          }
          yMeta.set('initialized', true);
        }, 'pear-upload-seed');
        window.setTimeout(cleanup, 150);
      };

      provider.on('sync', seedWhenSynced);
      window.setTimeout(cleanup, 4000);
    });
  }

  function handleProjectSwitchEvent(event: ProjectSwitchEvent) {
    if (!event.proposalId) {
      return;
    }

    if (event.type === 'proposed') {
      setPendingSwitch({
        proposalId: event.proposalId,
        currentFolder: event.currentFolder,
        newFolder: event.newFolder,
        proposerId: event.proposerId,
        proposerName: event.proposerName,
        requiredUserIds: event.requiredUserIds ?? [],
        approvedUserIds: event.approvedUserIds ?? []
      });
      return;
    }

    if (event.type === 'vote') {
      setPendingSwitch((current) => {
        if (!current || current.proposalId !== event.proposalId || !event.voterId) {
          return current;
        }
        const next = {
          ...current,
          approvedUserIds: uniqueStrings([...current.approvedUserIds, event.voterId])
        };
        maybeCommitApprovedSwitch(next);
        return next;
      });
      return;
    }

    if (event.type === 'sync') {
      if (event.targetUserId === user.id && Array.isArray(event.files)) {
        const nextFiles = applyUploadedFiles(event.files, event.replaceExisting ?? true, event.openUploaded ?? false);
        persistRoomFilesSnapshot(nextFiles);
      }
      return;
    }

    if (event.type === 'files-updated') {
      if (event.proposerId !== user.id && Array.isArray(event.files)) {
        applyUploadedFiles(event.files, event.replaceExisting ?? true, event.openUploaded ?? false);
        setSaveState('saved');
        setLastSavedAt(new Date().toISOString());
      }
      return;
    }

    if (event.type === 'file-content-updated') {
      if (event.proposerId !== user.id && Array.isArray(event.files)) {
        applyRemoteFileContentUpdates(event.files);
        setSaveState('saved');
        setLastSavedAt(new Date().toISOString());
      }
      return;
    }

    if (event.type === 'accepted') {
      if (Array.isArray(event.files) && event.proposerId !== user.id) {
        const nextFiles = applyUploadedFiles(event.files, event.replaceExisting ?? true, event.openUploaded ?? false);
        persistRoomFilesSnapshot(nextFiles);
      }
      pendingUploadRef.current = null;
      committingProposalRef.current = null;
      setPendingSwitch(null);
      return;
    }

    if (event.type === 'declined') {
      pendingUploadRef.current = null;
      committingProposalRef.current = null;
      setPendingSwitch(null);
    }
  }

  function approveProjectSwitch() {
    if (!pendingSwitch || pendingSwitch.approvedUserIds.includes(user.id)) {
      return;
    }

    const next = {
      ...pendingSwitch,
      approvedUserIds: uniqueStrings([...pendingSwitch.approvedUserIds, user.id])
    };
    setPendingSwitch(next);
    publishProjectSwitch({
      type: 'vote',
      ...next,
      voterId: user.id,
      voterName: user.name,
      at: new Date().toISOString()
    });
    maybeCommitApprovedSwitch(next);
  }

  function declineProjectSwitch() {
    if (!pendingSwitch) {
      return;
    }

    publishProjectSwitch({
      type: 'declined',
      ...pendingSwitch,
      voterId: user.id,
      voterName: user.name,
      at: new Date().toISOString()
    });
    pendingUploadRef.current = null;
    committingProposalRef.current = null;
    setPendingSwitch(null);
  }

  function maybeCommitApprovedSwitch(proposal: PendingSwitch) {
    const upload = pendingUploadRef.current;
    if (!upload || upload.proposalId !== proposal.proposalId || proposal.proposerId !== user.id) {
      return;
    }

    const approved = new Set(proposal.approvedUserIds);
    const allApproved = proposal.requiredUserIds.length > 0 && proposal.requiredUserIds.every((id) => approved.has(id));
    if (!allApproved || committingProposalRef.current === proposal.proposalId) {
      return;
    }

    committingProposalRef.current = proposal.proposalId;
    void persistUploadCandidates(upload.candidates, true, upload.openUploaded)
      .then((uploaded) => {
        publishProjectSwitch({
          type: 'accepted',
          ...proposal,
          approvedUserIds: proposal.requiredUserIds,
          files: uploaded,
          replaceExisting: true,
          openUploaded: false,
          at: new Date().toISOString()
        });
      })
      .catch(() => {
        publishProjectSwitch({
          type: 'declined',
          ...proposal,
          voterId: user.id,
          voterName: user.name,
          at: new Date().toISOString()
        });
      })
      .finally(() => {
        pendingUploadRef.current = null;
        committingProposalRef.current = null;
        setPendingSwitch(null);
      });
  }

  function publishProjectSwitch(event: ProjectSwitchEvent) {
    const currentRoom = roomRef.current;
    const client = stompRef.current;
    if (!currentRoom || !client?.connected) {
      return;
    }
    client.publish({
      destination: `/app/room/${currentRoom.code}/project-switch`,
      body: JSON.stringify(event)
    });
  }

  function queueOrPublishProjectSwitch(event: ProjectSwitchEvent) {
    if (stompRef.current?.connected) {
      publishProjectSwitch(event);
      return;
    }

    if (event.type === 'file-content-updated') {
      const fileId = event.files?.[0]?.id;
      pendingUploadSyncRef.current = pendingUploadSyncRef.current.filter((pending) => (
        pending.type !== 'file-content-updated' || pending.files?.[0]?.id !== fileId
      ));
    }
    pendingUploadSyncRef.current.push(event);
  }

  function scheduleContentBroadcast(fileId: string, content: string, updatedAt: string) {
    const currentRoom = roomRef.current;
    if (!currentRoom || currentRoom.code === FALLBACK_ROOM.code || !isUuid(fileId)) {
      return;
    }

    pendingContentSyncRef.current = { fileId, content, updatedAt };
    if (contentSyncTimerRef.current) {
      return;
    }

    contentSyncTimerRef.current = window.setTimeout(() => {
      contentSyncTimerRef.current = null;
      flushContentBroadcast();
    }, CONTENT_SYNC_DELAY_MS);
  }

  function flushContentBroadcast() {
    const pending = pendingContentSyncRef.current;
    pendingContentSyncRef.current = null;
    const currentRoom = roomRef.current;
    if (!pending || !currentRoom || currentRoom.code === FALLBACK_ROOM.code) {
      return;
    }

    const file = filesRef.current.find((item) => item.id === pending.fileId);
    if (!file) {
      return;
    }

    const projectName = filesRef.current.length > 0 ? projectNameForPaths(filesRef.current.map((item) => item.path)) : 'Empty room';
    queueOrPublishProjectSwitch({
      type: 'file-content-updated',
      proposalId: crypto.randomUUID(),
      currentFolder: projectName,
      newFolder: projectName,
      proposerId: userRef.current.id,
      proposerName: userRef.current.name,
      files: [{ ...file, content: pending.content, updatedAt: pending.updatedAt }],
      replaceExisting: false,
      openUploaded: false,
      at: new Date().toISOString()
    });
  }

  function replaceActiveEditorContent(content: string) {
    const editor = editorRef.current as any;
    const model = editor?.getModel?.();
    if (!model || model.getValue() === content) {
      return;
    }

    suppressEditorChangeRef.current = true;
    model.setValue(content);
    window.setTimeout(() => {
      suppressEditorChangeRef.current = false;
    }, 0);
  }

  function createFileTreeEvent(nextFiles: WorkspaceFile[], replaceExisting: boolean, openUploaded: boolean): ProjectSwitchEvent {
    const projectName = nextFiles.length > 0 ? projectNameForPaths(nextFiles.map((file) => file.path)) : activeProjectName;
    return {
      type: 'files-updated',
      proposalId: crypto.randomUUID(),
      currentFolder: activeProjectName,
      newFolder: projectName,
      proposerId: user.id,
      proposerName: user.name,
      files: nextFiles,
      replaceExisting,
      openUploaded,
      at: new Date().toISOString()
    };
  }

  function flushPendingUploadSyncs(client = stompRef.current) {
    if (!client?.connected) {
      return;
    }

    const currentRoom = roomRef.current;
    if (!currentRoom || pendingUploadSyncRef.current.length === 0) {
      return;
    }

    const pendingEvents = [...pendingUploadSyncRef.current];
    pendingUploadSyncRef.current = [];
    for (const event of pendingEvents) {
      client.publish({
        destination: `/app/room/${currentRoom.code}/project-switch`,
        body: JSON.stringify(event)
      });
    }
  }

  function publishMemberEvent(event: MemberRealtimeEvent) {
    const currentRoom = roomRef.current;
    const client = stompRef.current;
    if (!currentRoom || !client?.connected) {
      return;
    }

    client.publish({
      destination: `/app/room/${currentRoom.code}/members`,
      body: JSON.stringify(event)
    });
  }

  function publishLeftMemberEvent() {
    publishMemberEvent({
      type: 'left',
      userId: userRef.current.id,
      sessionId: userRef.current.id,
      connectionId,
      displayName: userRef.current.name,
      color: userRef.current.color,
      avatarUrl: userRef.current.avatarUrl,
      leadUserId: leadUserIdRef.current ?? undefined,
      locked: roomLockedRef.current,
      at: new Date().toISOString()
    });
  }

  function handleMemberEvent(event: MemberRealtimeEvent, client: Client) {
    if (!event.userId) {
      return;
    }

    if (event.type === 'room-closed') {
      if (event.userId !== user.id) {
        returnToLanding('The Lead Pear closed this room.');
        showToast('The Lead Pear closed this room.');
      }
      return;
    }

    if (typeof event.locked === 'boolean') {
      setRoomLocked(event.locked);
    }

    if (event.type === 'lead-transferred' || event.type === 'lead-sync' || event.type === 'lead-removed') {
      if (event.type === 'lead-removed') {
        setLeadUserId(null);
        addSystemMessage(`${displayNameOrPear(event.displayName)} removed ${displayNameOrPear(event.targetUserName)} from Lead Pear`);
        return;
      }
      if (!event.targetUserId || event.targetUserId === user.id || event.type === 'lead-transferred') {
        setLeadUserId(event.leadUserId ?? event.targetUserId ?? event.userId);
      }
      if (event.type === 'lead-transferred') {
        addSystemMessage(`${displayNameOrPear(event.displayName)} designated ${displayNameOrPear(event.targetUserName)} as Lead Pear`);
        if (event.targetUserName) {
          addSystemMessage(`${displayNameOrPear(event.targetUserName)} is now the Lead Pear`);
        }
      }
      return;
    }

    if (event.type === 'lock-changed') {
      addSystemMessage(event.locked ? `${displayNameOrPear(event.displayName)} has locked the room` : `${displayNameOrPear(event.displayName)} has unlocked the room`);
      return;
    }

    if (event.type === 'left') {
      if (event.leadUserId) {
        setLeadUserId(event.leadUserId);
      }
      if (event.userId !== user.id) {
        addSystemMessage(`${displayNameOrPear(event.displayName)} has left the room`);
      }
      setPresenceMembers((current) => {
        const next = { ...current };
        delete next[event.userId];
        return next;
      });
      setCursors((current) => {
        const next = { ...current };
        delete next[event.userId];
        return next;
      });
      return;
    }

    if (event.leadUserId && !leadUserIdRef.current) {
      setLeadUserId(event.leadUserId);
    }

    if (event.userId !== user.id && (event.type === 'joined' || event.type === 'presence-sync')) {
      setPresenceMembers((current) => ({
        ...current,
        [event.userId]: {
          id: event.userId,
          name: event.displayName || 'Guest',
          color: event.color || '#378ADD',
          avatarUrl: event.avatarUrl
        }
      }));
    }

    if (event.type === 'joined' && event.userId !== user.id) {
      addSystemMessage(`${displayNameOrPear(event.displayName)} has joined the room`);
      const currentRoom = roomRef.current;
      if (!currentRoom) {
        return;
      }

      client.publish({
        destination: `/app/room/${currentRoom.code}/members`,
        body: JSON.stringify({
          type: 'presence-sync',
          userId: user.id,
          sessionId: user.id,
          connectionId,
          displayName: user.name,
          color: user.color,
          avatarUrl: user.avatarUrl,
          leadUserId: leadUserIdRef.current,
          locked: roomLockedRef.current,
          targetUserId: event.userId,
          at: new Date().toISOString()
        })
      });

      if (leadUserIdRef.current === user.id && filesRef.current.length > 0) {
        const projectName = filesRef.current.length > 0 ? projectNameForPaths(filesRef.current.map((file) => file.path)) : activeProjectName;
        client.publish({
          destination: `/app/room/${currentRoom.code}/project-switch`,
          body: JSON.stringify({
            type: 'sync',
            proposalId: crypto.randomUUID(),
            currentFolder: projectName,
            newFolder: projectName,
            proposerId: user.id,
            proposerName: user.name,
            targetUserId: event.userId,
            files: filesRef.current,
            replaceExisting: true,
            openUploaded: false,
            at: new Date().toISOString()
          })
        });
      }

      if (leadUserIdRef.current === user.id) {
        client.publish({
          destination: `/app/room/${currentRoom.code}/members`,
          body: JSON.stringify({
            type: 'lead-sync',
            userId: user.id,
            sessionId: user.id,
            connectionId,
            displayName: user.name,
            color: user.color,
            avatarUrl: user.avatarUrl,
            leadUserId: user.id,
            locked: roomLockedRef.current,
            targetUserId: event.userId,
            at: new Date().toISOString()
          })
        });
      }
    }
  }

  function toggleFolder(path: string) {
    setExpandedFolders((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }

  function deleteTreePath(path: string, kind: 'file' | 'folder') {
    const currentFiles = filesRef.current;
    const nextFiles = currentFiles.filter((file) => (
      kind === 'folder' ? file.path !== path && !file.path.startsWith(`${path}/`) : file.path !== path
    ));
    if (nextFiles.length === currentFiles.length) {
      return;
    }

    const label = kind === 'folder' ? path : basename(path);
    if (!window.confirm(`Delete ${kind} "${label}" from this room?`)) {
      return;
    }

    const next = applyUploadedFiles(nextFiles, true, false);
    persistRoomFilesSnapshot(next);
    queueOrPublishProjectSwitch(createFileTreeEvent(next, true, false));
    setSaveState('saved');
    setLastSavedAt(new Date().toISOString());
  }

  function expandForPath(path: string) {
    const parts = path.split('/').filter(Boolean);
    setExpandedFolders((current) => {
      const next = new Set(current);
      let folder = '';
      for (let index = 0; index < parts.length - 1; index += 1) {
        folder = folder ? `${folder}/${parts[index]}` : parts[index];
        next.add(folder);
      }
      return next;
    });
  }

  function exportWorkspace() {
    const exportable = filesRef.current.filter((file) => basename(file.path) !== '.gitkeep');
    if (exportable.length === 0) {
      return;
    }

    const blob = createZipBlob(exportable);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${safeDownloadName(projectNameForPaths(exportable.map((file) => file.path)))}.zip`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function clearCursorWidgets(editor: any) {
    for (const widget of cursorWidgetsRef.current.values()) {
      editor.removeContentWidget(widget);
    }
    cursorWidgetsRef.current.clear();
  }

  function clearAnnotationWidgets(editor: any) {
    for (const widget of annotationWidgetsRef.current.values()) {
      editor.removeContentWidget(widget);
    }
    annotationWidgetsRef.current.clear();
  }

  function openProfileEditor(member: Member) {
    setProfileDraftName(member.name);
    setProfileDraftAvatar(member.avatarUrl);
    setProfileOpen(true);
  }

  async function handleAvatarInput(input: HTMLInputElement) {
    const file = input.files?.[0];
    input.value = '';
    if (!file) {
      return;
    }

    if (!isAllowedProfileImage(file)) {
      showToast('Profile picture must be a JPG, PNG, or WEBP image.');
      return;
    }

    setProfileDraftAvatar(await fileToDataUrl(file));
  }

  async function saveProfile() {
    try {
      await updateProfile(profileDraftName.trim() || user.name, profileDraftAvatar);
    } catch {
      showToast('Could not update your server profile.');
      return;
    }
    const updated = userRef.current;
    setProfileOpen(false);

    const currentRoom = roomRef.current;
    const client = stompRef.current;
    if (currentRoom && client?.connected) {
      client.publish({
        destination: `/app/room/${currentRoom.code}/members`,
        body: JSON.stringify({
          type: 'presence-sync',
          userId: updated.id,
          sessionId: updated.id,
          connectionId,
          displayName: updated.name,
          color: updated.color,
          avatarUrl: updated.avatarUrl,
          leadUserId: leadUserIdRef.current,
          locked: roomLockedRef.current,
          at: new Date().toISOString()
        })
      });
    }
  }

}

function LandingPage({
  backendWakeUrl,
  code,
  creating,
  error,
  joining,
  notice,
  onCodeChange,
  onCreate,
  onJoin,
  realtimeWakeUrl
}: {
  backendWakeUrl: string;
  code: string;
  creating: boolean;
  error: string;
  joining: boolean;
  notice: string;
  onCodeChange: (code: string) => void;
  onCreate: () => void;
  onJoin: () => void;
  realtimeWakeUrl: string;
}) {
  return (
    <main className="landing-shell">
      <div className="render-tier-banner" role="status">
        <span className="render-tier-message">
          <strong>Render free tier wake-up:</strong>
          <span>First room creation can take 1-2 minutes while the backend and realtime services start.</span>
        </span>
        <span className="render-tier-instruction">Please click both links below to start the instances.</span>
        <span className="render-tier-links">
          {backendWakeUrl && <a href={backendWakeUrl} rel="noreferrer" target="_blank">{backendWakeUrl}</a>}
          {realtimeWakeUrl && <a href={realtimeWakeUrl} rel="noreferrer" target="_blank">{realtimeWakeUrl}</a>}
        </span>
      </div>
      <img alt="" className="landing-chibi" src={pearChibiUrl} />
      <section className="landing-hero">
        <div className="landing-hero-grid">
          <div className="landing-copy">
            <div className="landing-brand landing-brand-hero">
              <img alt="" className="brand-logo brand-logo-large" src={pearLogoUrl} />
              <h1>Pear Programming</h1>
            </div>
            <p className="landing-subheading">Pair Program Together. Real-time Coding Rooms.</p>
            <h1>Code with others in a <strong>pear-ly</strong> friendly browser IDE in real time.</h1>
            <p>
              Pear Programming is a collaborative coding platform where teams can write code together in real time, chat alongside their work, and stay in sync in a shared browser IDE. Rooms are limited to 5 pears for smooth collaboration.
      <br/>
      <br/>
      <b> What makes Pear Programming special?</b>
      <br/>
      <br/>
        Meet <b>PearAI</b>—your context-aware coding assistant that understands your file, edits, cursors, and conversations to help you move faster.
        PearAI will live in your room, ready to assist whenever you need it. Just mention @AI in chat to get started.

              <br />
              <br></br>
              Now, go <strong>get pearing</strong>.
            </p>
 
          </div>
          <section className="landing-panel" id="room-actions">
            <div className="room-card-heading">
              <span>Create or Join a Room</span>
              <small>Start empty, then upload your project</small>
            </div>
            <div className="landing-actions">
              <button className="primary-button create-room-button" disabled={creating} onClick={onCreate} type="button">
                {creating ? 'Creating...' : 'Create Pear Room'}
              </button>
              <form
                className="join-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  onJoin();
                }}
              >
                <input
                  autoCapitalize="characters"
                  onChange={(event) => onCodeChange(event.target.value)}
                  placeholder="Enter Room Code"
                  value={code}
                />
                <button className="secondary-button" disabled={joining} type="submit">
                  {joining ? 'Joining...' : 'Join Pear Room'}
                </button>
              </form>
            </div>
            {notice && <p className="landing-notice">{notice}</p>}
            {error && <p className="landing-error">{error}</p>}
          </section>
        </div>
      </section>
    </main>
  );
}

function UploadModal({
  dragging,
  onCancel,
  onChooseFiles,
  onChooseFolder,
  onDragLeave,
  onDragOver,
  onDrop
}: {
  dragging: boolean;
  onCancel: () => void;
  onChooseFiles: () => void;
  onChooseFolder: () => void;
  onDragLeave: () => void;
  onDragOver: () => void;
  onDrop: (event: DragEvent<HTMLElement>) => void;
}) {
  return (
    <div
      className="modal-backdrop modal-backdrop-animated"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onCancel();
        }
      }}
      role="presentation"
    >
      <section
        aria-label="Upload files or folders"
        aria-modal="true"
        className={`upload-modal ${dragging ? 'upload-modal-dragging' : ''}`}
        onDragEnter={(event) => {
          event.preventDefault();
          onDragOver();
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          const nextTarget = event.relatedTarget;
          if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
            onDragLeave();
          }
        }}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
          onDragOver();
        }}
        onDrop={onDrop}
        role="dialog"
      >
        <header>
          <div>
            <span className="upload-modal-kicker">Pear upload</span>
            <h2>Upload project files</h2>
          </div>
          <button className="icon-button" onClick={onCancel} title="Close upload panel" type="button">
            <X size={14} />
          </button>
        </header>
        <div className="upload-dropzone">
          <span className="upload-dropzone-icon">
            <Upload size={22} />
          </span>
          <strong>{dragging ? 'Drop to upload' : 'Drop files or folders here'}</strong>
          <span>Nested folders and supported code files stay together.</span>
        </div>
        <div className="upload-modal-actions">
          <button autoFocus className="secondary-button" onClick={onChooseFiles} type="button">
            <Upload size={15} />
            Choose Files
          </button>
          <button className="primary-button" onClick={onChooseFolder} type="button">
            <FolderPlus size={15} />
            Choose Folder
          </button>
        </div>
      </section>
    </div>
  );
}

function EntryProfileModal({
  action,
  avatarInputRef,
  avatarUrl,
  color,
  error,
  name,
  onAvatarInput,
  onCancel,
  onConfirm,
  onNameChange
}: {
  action: PendingRoomAction | null;
  avatarInputRef: RefObject<HTMLInputElement>;
  avatarUrl?: string;
  color: string;
  error: string;
  name: string;
  onAvatarInput: (input: HTMLInputElement) => void;
  onCancel: () => void;
  onConfirm: () => void;
  onNameChange: (name: string) => void;
}) {
  return (
    <div className="modal-backdrop">
      <section className="profile-modal entry-profile-modal" role="dialog" aria-modal="true" aria-label="Set up profile">
        <header>
          <h2>{action === 'create' ? 'Create your pear profile' : 'Join with your pear profile'}</h2>
          <button className="icon-button" onClick={onCancel} title="Cancel" type="button">
            <X size={14} />
          </button>
        </header>
        <div className="profile-preview">
          <span className="profile-avatar" style={{ backgroundColor: `${color}22`, color }}>
            {avatarUrl ? <img alt="" src={avatarUrl} /> : <UserRound size={22} />}
          </span>
          <button className="secondary-button" onClick={() => avatarInputRef.current?.click()} type="button">
            <ImagePlus size={15} />
            Upload Photo
          </button>
          <input accept=".jpg,.jpeg,.png,.webp" className="hidden-file-input" onChange={(event) => onAvatarInput(event.currentTarget)} ref={avatarInputRef} type="file" />
        </div>
        <label className="field-label">
          Display name
          <input autoFocus onChange={(event) => onNameChange(event.target.value)} placeholder="Your display name" value={name} />
        </label>
        {error && <p className="profile-error">{error}</p>}
        <div className="modal-actions">
          <button className="secondary-button" onClick={onCancel} type="button">Cancel</button>
          <button className="primary-button" onClick={onConfirm} type="button">Continue</button>
        </div>
      </section>
    </div>
  );
}

function CreateItemModal({
  error,
  kind,
  name,
  onCancel,
  onConfirm,
  onNameChange
}: {
  error: string;
  kind: 'file' | 'folder';
  name: string;
  onCancel: () => void;
  onConfirm: () => void;
  onNameChange: (value: string) => void;
}) {
  const isFolder = kind === 'folder';

  return (
    <div className="modal-backdrop modal-backdrop-animated" onKeyDown={(event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        onConfirm();
      }
    }} role="presentation">
      <section className="confirm-modal create-item-modal" aria-describedby="create-item-help" aria-label={isFolder ? 'Create folder' : 'Create file'} aria-modal="true" role="dialog">
        <header>
          <h2>{isFolder ? 'Create Folder' : 'Create File'}</h2>
          <button className="icon-button" onClick={onCancel} title="Cancel" type="button">
            <X size={14} />
          </button>
        </header>
        <p id="create-item-help">
          {isFolder
            ? 'Enter a folder name. PearProgramming will create the folder and preserve its structure.'
            : 'Enter a file name. You can include an extension like .ts or .md.'}
        </p>
        <label className="field-label">
          {isFolder ? 'Folder name' : 'File name'}
          <input
            autoFocus
            onChange={(event) => onNameChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                onConfirm();
              }
            }}
            placeholder={isFolder ? 'components' : 'notes.md'}
            value={name}
          />
        </label>
        {error && <p className="profile-error">{error}</p>}
        <div className="create-item-preview">
          <span className="create-item-chip">{isFolder ? 'Folder' : 'File'}</span>
          <span className="create-item-hint">Duplicate names are auto-renamed to keep the tree stable.</span>
        </div>
        <div className="modal-actions">
          <button className="secondary-button" onClick={onCancel} type="button">Cancel</button>
          <button className="primary-button" onClick={onConfirm} type="button">Create</button>
        </div>
      </section>
    </div>
  );
}

function getJoinCode() {
  const match = window.location.pathname.match(/^\/(?:join|room)\/([^/]+)/);
  return match?.[1] ?? null;
}

function getOrCreateConnectionId() {
  const stored = sessionStorage.getItem(CONNECTION_SESSION_STORAGE_KEY);
  if (stored) {
    return stored;
  }

  const id = crypto.randomUUID();
  sessionStorage.setItem(CONNECTION_SESSION_STORAGE_KEY, id);
  return id;
}

function loadRoomSession(): RoomSessionState | null {
  const stored = sessionStorage.getItem(ROOM_SESSION_STORAGE_KEY);
  if (!stored) {
    return null;
  }

  try {
    const parsed = JSON.parse(stored) as RoomSessionState;
    if (!parsed.room || !parsed.room.code) {
      return null;
    }
    return parsed;
  } catch {
    sessionStorage.removeItem(ROOM_SESSION_STORAGE_KEY);
    return null;
  }
}

function persistRoomSession(state: RoomSessionState) {
  sessionStorage.setItem(ROOM_SESSION_STORAGE_KEY, JSON.stringify(state));
}

function clearRoomSession() {
  sessionStorage.removeItem(ROOM_SESSION_STORAGE_KEY);
}

function buildWakeUrl(baseUrl: string, path: string) {
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

function webSocketToHttpUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol === 'wss:') {
      url.protocol = 'https:';
    } else if (url.protocol === 'ws:') {
      url.protocol = 'http:';
    }
    return url.toString().replace(/\/+$/, '');
  } catch {
    return value;
  }
}

function resolveCreateItemTarget(kind: 'file' | 'folder', rawName: string, existingPaths: string[]) {
  if (!rawName) {
    return { error: `${kind === 'folder' ? 'Folder' : 'File'} name is required.` };
  }

  if (/[\\/]/.test(rawName)) {
    return { error: 'Use a single name without path separators.' };
  }

  if (kind === 'folder') {
    const path = uniqueFolderPath(existingPaths, rawName);
    return { path };
  }

  const { baseName, extension } = splitFileName(rawName);
  const path = uniqueFilePath(existingPaths, baseName || 'new-file', extension || 'txt');
  return { path };
}

function splitFileName(value: string) {
  const trimmed = value.trim();
  const lastDot = trimmed.lastIndexOf('.');
  if (lastDot <= 0 || lastDot === trimmed.length - 1) {
    return { baseName: trimmed, extension: '' };
  }

  return {
    baseName: trimmed.slice(0, lastDot),
    extension: trimmed.slice(lastDot + 1)
  };
}

function buildMentionOptions(members: Member[]): MentionOption[] {
  const baseCounts = new Map<string, number>();
  for (const member of members) {
    const base = mentionBaseLabel(member);
    baseCounts.set(base, (baseCounts.get(base) ?? 0) + 1);
  }

  return members.map((member) => {
    const base = mentionBaseLabel(member);
    return {
      id: member.id,
      name: member.name,
      label: baseCounts.get(base) === 1 ? base : `${base}-${member.id.slice(0, 4)}`,
      color: member.color,
      ai: member.ai
    };
  });
}

function mentionBaseLabel(member: Member) {
  if (member.ai) {
    return 'AI';
  }

  const normalized = member.name
    .trim()
    .replace(/\s+/g, '')
    .replace(/[^A-Za-z0-9_-]/g, '');
  return normalized || `user-${member.id.slice(0, 4)}`;
}

function mentionMatches(option: MentionOption, query: string) {
  const normalizedQuery = query.toLowerCase();
  return option.label.toLowerCase().includes(normalizedQuery) || option.name.toLowerCase().includes(normalizedQuery);
}

function mentionFragmentAt(value: string, cursor: number) {
  const prefix = value.slice(0, cursor);
  const match = prefix.match(/(^|\s)@([A-Za-z0-9_-]*)$/);
  if (!match) {
    return null;
  }

  const query = match[2] ?? '';
  return {
    query,
    start: cursor - query.length - 1
  };
}

function invalidMentionLabels(content: string, options: MentionOption[]) {
  const validLabels = new Set(options.map((option) => option.label.toLowerCase()));
  const invalid: string[] = [];
  for (const match of content.matchAll(/(^|\s)@([A-Za-z0-9_-]+)/g)) {
    const label = match[2];
    if (!validLabels.has(label.toLowerCase())) {
      invalid.push(label);
    }
  }
  return invalid;
}

function messageMentionsUser(content: string, user: Member, options: MentionOption[]) {
  const userOption = options.find((option) => option.id === user.id);
  if (!userOption) {
    return false;
  }

  for (const match of content.matchAll(/(^|\s)@([A-Za-z0-9_-]+)/g)) {
    if (match[2].toLowerCase() === userOption.label.toLowerCase()) {
      return true;
    }
  }

  return false;
}

function renderMessageContent(content: string, options: MentionOption[], onMentionClick: (option: MentionOption) => void) {
  const nodes = [];
  let lastIndex = 0;
  for (const match of content.matchAll(/(^|\s)@([A-Za-z0-9_-]+)/g)) {
    const matchIndex = match.index ?? 0;
    const leading = match[1] ?? '';
    const label = match[2];
    const mentionIndex = matchIndex + leading.length;
    if (mentionIndex > lastIndex) {
      nodes.push(content.slice(lastIndex, mentionIndex));
    }

    const option = options.find((item) => item.label.toLowerCase() === label.toLowerCase());
    if (option) {
      nodes.push(
        <button className="mention-token" key={`${label}-${mentionIndex}`} onClick={() => onMentionClick(option)} type="button">
          @{option.label}
        </button>
      );
    } else {
      nodes.push(`@${label}`);
    }
    lastIndex = mentionIndex + label.length + 1;
  }

  if (lastIndex < content.length) {
    nodes.push(content.slice(lastIndex));
  }

  return nodes;
}

function uniqueMembers(members: Member[]) {
  const byId = new Map<string, Member>();
  for (const member of members) {
    byId.set(member.id, member);
  }
  return [...byId.values()];
}

function uniqueStrings(values: string[]) {
  return [...new Set(values)];
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function basename(path: string) {
  const parts = path.split('/');
  return parts[parts.length - 1] ?? path;
}

function displayNameOrPear(name?: string) {
  return name?.trim() || 'A pear';
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function upsertAnnotation(current: AiAnnotation[], annotation: AiAnnotation) {
  return [...current.filter((item) => item.id !== annotation.id), annotation];
}

function createLocalFile(path: string, workspaceId: string, createdById?: string): WorkspaceFile {
  return {
    id: crypto.randomUUID(),
    workspaceId,
    path,
    language: inferLanguage(path),
    content: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdById
  };
}

function createLocalFileFromCandidate(candidate: UploadCandidate, workspaceId: string, createdById?: string): WorkspaceFile {
  return {
    id: crypto.randomUUID(),
    workspaceId,
    path: candidate.path,
    language: candidate.language,
    content: candidate.content,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdById
  };
}

function mergeFiles(current: WorkspaceFile[], incoming: WorkspaceFile[]) {
  const byPath = new Map<string, WorkspaceFile>();
  for (const file of current) {
    byPath.set(file.path, file);
  }
  for (const file of incoming) {
    byPath.set(file.path, file);
  }
  return [...byPath.values()];
}

function sortByPath(a: WorkspaceFile, b: WorkspaceFile) {
  return a.path.localeCompare(b.path);
}

function foldersForPaths(paths: string[]) {
  const folders = new Set<string>();
  for (const path of paths) {
    const parts = path.split('/').filter(Boolean);
    let folder = '';
    for (let index = 0; index < parts.length - 1; index += 1) {
      folder = folder ? `${folder}/${parts[index]}` : parts[index];
      folders.add(folder);
    }
  }
  return folders;
}

function uniqueFilePath(existingPaths: string[], basenameWithoutExtension: string, extension: string) {
  const existing = new Set(existingPaths);
  const suffix = extension ? `.${extension.replace(/^\./, '')}` : '';
  let candidate = `${basenameWithoutExtension}${suffix}`;
  let index = 2;
  while (existing.has(candidate)) {
    candidate = `${basenameWithoutExtension}-${index}${suffix}`;
    index += 1;
  }
  return candidate;
}

function uniqueFolderPath(existingPaths: string[], basename: string) {
  const existingFolders = foldersForPaths(existingPaths);
  let candidate = basename;
  let index = 2;
  while (existingFolders.has(candidate) || existingPaths.some((path) => path === candidate || path.startsWith(`${candidate}/`))) {
    candidate = `${basename}-${index}`;
    index += 1;
  }
  return candidate;
}

function normalizeRoomCode(value: string) {
  return value.trim().toUpperCase().replace(/[\s-]+/g, '');
}

function activeFileContextForAi(activeFile: WorkspaceFile | null, cursorLine: number, editor: any) {
  const content = typeof editor?.getValue === 'function' ? editor.getValue() : activeFile?.content ?? '';
  if (!content.trim()) {
    return '';
  }

  const maxChars = 12_000;
  if (content.length <= maxChars) {
    return content;
  }

  const lines = content.split(/\r?\n/);
  const cursorIndex = Math.max(0, Math.min(lines.length - 1, cursorLine - 1));
  const selected: string[] = [];
  let total = 0;
  let before = cursorIndex;
  let after = cursorIndex + 1;

  while (total < maxChars && (before >= 0 || after < lines.length)) {
    if (before >= 0) {
      const line = lines[before];
      selected.unshift(line);
      total += line.length + 1;
      before -= 1;
    }
    if (total >= maxChars) {
      break;
    }
    if (after < lines.length) {
      const line = lines[after];
      selected.push(line);
      total += line.length + 1;
      after += 1;
    }
  }

  const prefix = before >= 0 ? '...[earlier lines truncated]\n' : '';
  const suffix = after < lines.length ? '\n...[later lines truncated]' : '';
  return `${prefix}${selected.join('\n')}${suffix}`;
}

function isValidRoomCode(value: string) {
  return /^[A-Z0-9]{6}$/.test(value);
}

function formatRoomNameDate(date: Date) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(date);
}

function formatPacificTime(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/Los_Angeles',
    timeZoneName: 'short'
  }).format(new Date(value));
}

function saveStatusText(state: SaveState, lastSavedAt: string | null) {
  if (state === 'saving') {
    return 'Autosaving...';
  }
  if (state === 'saved') {
    return lastSavedAt ? `Autosaved ${formatPacificTime(lastSavedAt)}` : 'Autosaved';
  }
  if (state === 'offline') {
    return 'Local changes';
  }
  if (state === 'error') {
    return 'Autosave retrying';
  }
  return 'Autosave ready';
}

function uploadNoticeText(result: UploadReadResult) {
  const renamedCount = result.renamedCount;
  const renameText = renamedCount > 0
    ? ` Renamed ${renamedCount} duplicate file${renamedCount === 1 ? '' : 's'} to avoid overwriting existing files.`
    : '';

  if (result.skipped.length === 0) {
    const base = result.candidates.length === 1
      ? 'Selected 1 supported file.'
      : `Selected ${result.candidates.length} supported files.`;
    return `${base}${renameText}`;
  }

  const examples = result.skipped
    .slice(0, 3)
    .map((item) => basename(item.path))
    .join(', ');
  const suffix = result.skipped.length > 3 ? ', and more' : '';
  const skippedText = `Skipped ${result.skipped.length} unsupported file${result.skipped.length === 1 ? '' : 's'}${examples ? `: ${examples}${suffix}` : ''}.`;

  if (result.candidates.length === 0) {
    return `No supported code files found. ${skippedText}`;
  }

  return `Selected ${result.candidates.length} supported file${result.candidates.length === 1 ? '' : 's'}. ${skippedText}${renameText}`;
}

function configureFolderInput(input: HTMLInputElement) {
  const folderInput = input as HTMLInputElement & { webkitdirectory?: boolean; directory?: boolean };
  folderInput.webkitdirectory = true;
  folderInput.directory = true;
  input.setAttribute('webkitdirectory', '');
  input.setAttribute('directory', '');
  input.setAttribute('mozdirectory', '');
  input.setAttribute('msdirectory', '');
  input.setAttribute('odirectory', '');
}

let cachedCrc32Table: Uint32Array | null = null;

function createZipBlob(files: WorkspaceFile[]) {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = encoder.encode(normalizeZipPath(file.path));
    const data = contentBytes(file.content);
    const crc = crc32(data);

    const localHeader = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(localHeader.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x0800, true);
    localView.setUint16(8, 0, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, data.length, true);
    localView.setUint32(22, data.length, true);
    localView.setUint16(26, nameBytes.length, true);
    localHeader.set(nameBytes, 30);
    localParts.push(localHeader, data);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(centralHeader.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x0800, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, data.length, true);
    centralView.setUint32(24, data.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint32(42, offset, true);
    centralHeader.set(nameBytes, 46);
    centralParts.push(centralHeader);

    offset += localHeader.length + data.length;
  }

  const centralOffset = offset;
  const centralSize = centralParts.reduce((total, part) => total + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, centralOffset, true);

  return new Blob([...localParts, ...centralParts, end], { type: 'application/zip' });
}

function normalizeZipPath(path: string) {
  return path.replace(/\\/g, '/').replace(/^\/+/, '').split('/').filter(Boolean).join('/');
}

function contentBytes(content: string) {
  const dataUrlMatch = content.match(/^data:.*?(;base64)?,(.*)$/);
  if (!dataUrlMatch) {
    return new TextEncoder().encode(content);
  }

  const payload = dataUrlMatch[2] ?? '';
  if (dataUrlMatch[1]) {
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }

  return new TextEncoder().encode(decodeURIComponent(payload));
}

function crc32(data: Uint8Array) {
  const table = getCrc32Table();
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = (crc >>> 8) ^ table[(crc ^ byte) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function getCrc32Table() {
  if (cachedCrc32Table) {
    return cachedCrc32Table;
  }

  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  cachedCrc32Table = table;
  return table;
}

function safeDownloadName(value: string) {
  return value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'pearprogram-project';
}

function Toast({ message }: { message: string }) {
  if (!message) {
    return null;
  }

  return (
    <div className="toast" role="status" aria-live="polite">
      {message}
    </div>
  );
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(String(reader.result ?? '')));
    reader.addEventListener('error', () => reject(reader.error));
    reader.readAsDataURL(file);
  });
}

function isAllowedProfileImage(file: File) {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  const typeAllowed = !file.type || ['image/jpeg', 'image/png', 'image/webp'].includes(file.type);
  return typeAllowed && ['jpg', 'jpeg', 'png', 'webp'].includes(extension);
}

function hash(value: string) {
  let total = 0;
  for (let index = 0; index < value.length; index += 1) {
    total = (total << 5) - total + value.charCodeAt(index);
    total |= 0;
  }
  return total;
}
