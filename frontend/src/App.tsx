import Editor, { type OnMount } from '@monaco-editor/react';
import { Client, type IMessage } from '@stomp/stompjs';
import {
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  FilePlus2,
  Folder,
  FolderPlus,
  ImagePlus,
  Lock,
  LogOut,
  MessageSquare,
  Send,
  Trash2,
  Unlock,
  Upload,
  UserRound,
  Wifi,
  WifiOff,
  X
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import SockJS from 'sockjs-client';
import * as Y from 'yjs';
import { MonacoBinding } from 'y-monaco';
import { WebsocketProvider } from 'y-websocket';
import {
  createFile,
  createRoom,
  createWorkspace,
  dismissAnnotation,
  getRoom,
  getRoomAccess,
  issueDevToken,
  listAnnotations,
  listChatHistory,
  listFiles,
  STOMP_URL,
  updateFileContent,
  uploadWorkspaceFiles,
  YJS_URL
} from './api';
import { inferLanguage, languageClass } from './language';
import pearLogoUrl from '../assets/favicon.png';
import pearChibiUrl from '../assets/pear_chibi.jpg';
import type { UploadCandidate, UploadReadResult } from './uploads';
import { projectNameForPaths, readUploadCandidates, UPLOAD_ACCEPT } from './uploads';
import type { AiAnnotation, ChatMessage, CursorMessage, Member, ProjectSwitchEvent, Room, WorkspaceFile } from './types';

const USER_COLORS = ['#378ADD', '#1D9E75', '#F59E0B', '#D946EF', '#EF4444'];

const FALLBACK_ROOM: Room = {
  id: 'local-room',
  code: 'LOCAL1',
  workspaceId: 'local-workspace',
  active: true,
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
};

type TreeNode = {
  name: string;
  path: string;
  children: TreeNode[];
  file?: WorkspaceFile;
};

type MutableTreeNode = {
  name: string;
  path: string;
  children: Map<string, MutableTreeNode>;
  file?: WorkspaceFile;
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
  type: 'joined' | 'left' | 'presence-sync' | 'lead-sync' | 'lead-transferred' | 'lock-changed' | 'room-closed';
  userId: string;
  displayName?: string;
  color?: string;
  avatarUrl?: string;
  leadUserId?: string;
  targetUserId?: string;
  targetUserName?: string;
  locked?: boolean;
  at?: string;
};

type DisplayChatMessage = ChatMessage & { system?: boolean };

type SaveState = 'idle' | 'saving' | 'saved' | 'offline' | 'error';

export default function App() {
  const [room, setRoom] = useState<Room | null>(null);
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [openFileIds, setOpenFileIds] = useState<string[]>([]);
  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const [messages, setMessages] = useState<DisplayChatMessage[]>([]);
  const [annotations, setAnnotations] = useState<AiAnnotation[]>([]);
  const [cursors, setCursors] = useState<Record<string, CursorMessage>>({});
  const [presenceMembers, setPresenceMembers] = useState<Record<string, Member>>({});
  const [stompClient, setStompClient] = useState<Client | null>(null);
  const [stompConnected, setStompConnected] = useState(false);
  const [syncStatus, setSyncStatus] = useState('Yjs offline');
  const [peerCount, setPeerCount] = useState(1);
  const [chatDraft, setChatDraft] = useState('');
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [cursorPosition, setCursorPosition] = useState({ line: 1, col: 1 });
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => new Set());
  const [landingCode, setLandingCode] = useState('');
  const [landingError, setLandingError] = useState('');
  const [landingNotice, setLandingNotice] = useState('');
  const [creatingRoom, setCreatingRoom] = useState(false);
  const [joiningRoom, setJoiningRoom] = useState(false);
  const [chatOpen, setChatOpen] = useState(true);
  const [pacificNow, setPacificNow] = useState(() => new Date());
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [pendingSwitch, setPendingSwitch] = useState<PendingSwitch | null>(null);
  const [uploadNotice, setUploadNotice] = useState('');
  const [leadUserId, setLeadUserId] = useState<string | null>(null);
  const [roomLocked, setRoomLocked] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [delegateOpen, setDelegateOpen] = useState(false);
  const [delegateUserId, setDelegateUserId] = useState('');
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileDraftName, setProfileDraftName] = useState('');
  const [profileDraftAvatar, setProfileDraftAvatar] = useState<string | undefined>();
  const [user, setUser] = useState<Member>(() => getOrCreateLocalUser());

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
  const isLeadPear = leadUserId === user.id;
  const roleLabel = isLeadPear ? 'Lead Pear' : 'Junior Pear';
  const delegateCandidates = humanMembers.filter((member) => member.id !== user.id);

  const editorRef = useRef<unknown>(null);
  const monacoRef = useRef<any>(null);
  const bindingRef = useRef<MonacoBinding | null>(null);
  const providerRef = useRef<WebsocketProvider | null>(null);
  const ydocRef = useRef<Y.Doc | null>(null);
  const cursorWidgetsRef = useRef<Map<string, any>>(new Map());
  const annotationWidgetsRef = useRef<Map<string, any>>(new Map());
  const cursorSentAtRef = useRef(0);
  const saveTimerRef = useRef<number | null>(null);
  const pendingUploadRef = useRef<{ proposalId: string; candidates: UploadCandidate[]; newFolder: string } | null>(null);
  const committingProposalRef = useRef<string | null>(null);
  const roomRef = useRef<Room | null>(null);
  const activeFileRef = useRef<WorkspaceFile | null>(null);
  const stompRef = useRef<Client | null>(null);
  const leadUserIdRef = useRef<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);

  const joinRoom = useCallback(async (rawCode: string, replaceUrl = true) => {
    const code = normalizeRoomCode(rawCode);
    if (!isValidRoomCode(code)) {
      setLandingError('Please enter in a valid pear room code');
      return;
    }

    setJoiningRoom(true);
    setLandingError('');
    setLandingNotice('');
    try {
      const access = await getRoomAccess(code, user.id);
      if (!access.canJoin) {
        showToast(access.reason === 'locked'
          ? 'Room is Locked. Contact the room owner if this is a mistake.'
          : 'Room is Full.');
        return;
      }
      const joinedRoom = await getRoom(code);
      const joinedFiles = await listFiles(joinedRoom.workspaceId);
      openRoom(joinedRoom, joinedFiles, replaceUrl, access.leadUserId, access.locked);
    } catch {
      setLandingError(`Could not find room ${code}.`);
    } finally {
      setJoiningRoom(false);
    }
  }, [user.id]);

  const handleCreateRoom = useCallback(async () => {
    setCreatingRoom(true);
    setLandingError('');
    setLandingNotice('');
    try {
      const workspace = await createWorkspace(`Pear room ${formatRoomNameDate(new Date())}`);
      const createdRoom = await createRoom(workspace.id);
      openRoom(createdRoom, [], true, user.id, false);
    } catch {
      const fallbackRoom = { ...FALLBACK_ROOM, code: randomRoomCode() };
      openRoom(fallbackRoom, [], true, user.id, false);
      setLandingError('Backend is offline, so this room is local-only for now.');
    } finally {
      setCreatingRoom(false);
    }
  }, [user.id]);

  const scheduleAutosave = useCallback((fileId: string, content: string) => {
    const currentRoom = roomRef.current;
    if (!currentRoom || currentRoom.id === FALLBACK_ROOM.id || !isUuid(fileId)) {
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
      const currentFile = activeFileRef.current;
      if (!currentFile) {
        return;
      }
      const content = editor.getValue();
      setFiles((current) => current.map((file) => (
        file.id === currentFile.id ? { ...file, content, updatedAt: new Date().toISOString() } : file
      )));
      scheduleAutosave(currentFile.id, content);
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
          color: user.color,
          sentAt: now
        })
      });
    });
  }, [scheduleAutosave, user.color, user.id, user.name]);

  useEffect(() => {
    roomRef.current = room;
  }, [room]);

  useEffect(() => {
    activeFileRef.current = activeFile;
  }, [activeFile]);

  useEffect(() => {
    stompRef.current = stompClient;
  }, [stompClient]);

  useEffect(() => {
    leadUserIdRef.current = leadUserId;
  }, [leadUserId]);

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
    const joinCode = getJoinCode();
    if (joinCode) {
      void joinRoom(joinCode, false);
    }
  }, [joinRoom]);

  useEffect(() => {
    let cancelled = false;
    issueDevToken(user.id, user.name)
      .then((token) => {
        if (!cancelled) {
          setAuthToken(token);
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [user.id, user.name]);

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
    if (!room) {
      return;
    }

    const client = new Client({
      connectHeaders: authToken ? { Authorization: `Bearer ${authToken}` } : {},
      reconnectDelay: 2000,
      webSocketFactory: () => new SockJS(STOMP_URL),
      onConnect: () => {
        setStompConnected(true);
        client.subscribe(`/topic/room/${room.code}/chat`, (message: IMessage) => {
          setMessages((current) => [...current, JSON.parse(message.body) as ChatMessage].slice(-60));
        });
        client.subscribe(`/topic/room/${room.code}/cursors`, (message: IMessage) => {
          const cursor = JSON.parse(message.body) as CursorMessage;
          if (cursor.userId === user.id) {
            return;
          }
          setCursors((current) => ({ ...current, [cursor.userId]: cursor }));
        });
        client.subscribe(`/topic/room/${room.code}/members`, (message: IMessage) => {
          handleMemberEvent(JSON.parse(message.body) as MemberRealtimeEvent, client);
        });
        client.subscribe(`/topic/room/${room.code}/annotations`, (message: IMessage) => {
          const annotation = JSON.parse(message.body) as AiAnnotation;
          setAnnotations((current) => upsertAnnotation(current, annotation).slice(-5));
        });
        client.subscribe(`/topic/room/${room.code}/project-switch`, (message: IMessage) => {
          handleProjectSwitchEvent(JSON.parse(message.body) as ProjectSwitchEvent);
        });
        client.publish({
          destination: `/app/room/${room.code}/members`,
          body: JSON.stringify({
            type: 'joined',
            userId: user.id,
            displayName: user.name,
            color: user.color,
            avatarUrl: user.avatarUrl,
            leadUserId: leadUserIdRef.current,
            locked: roomLocked,
            at: new Date().toISOString()
          })
        });
      },
      onWebSocketClose: () => setStompConnected(false),
      onStompError: () => setStompConnected(false)
    });

    client.activate();
    setStompClient(client);

    return () => {
      if (client.connected) {
        client.publish({
          destination: `/app/room/${room.code}/members`,
          body: JSON.stringify({
            type: 'left',
            userId: user.id,
            displayName: user.name,
            color: user.color,
            avatarUrl: user.avatarUrl,
            leadUserId: leadUserIdRef.current,
            locked: roomLocked,
            at: new Date().toISOString()
          })
        });
      }
      void client.deactivate();
      setStompConnected(false);
      setStompClient(null);
    };
  }, [authToken, room, user.avatarUrl, user.color, user.id, user.name]);

  useEffect(() => {
    const editor = editorRef.current as any;
    if (!editor || !room || !activeFile) {
      return;
    }

    bindingRef.current?.destroy();
    providerRef.current?.destroy();
    ydocRef.current?.destroy();

    const ydoc = new Y.Doc();
    const provider = new WebsocketProvider(YJS_URL, `${room.code}/${activeFile.id}`, ydoc, authToken ? { params: { token: authToken } } : undefined);
    const yText = ydoc.getText('monaco');
    if (yText.length === 0 && activeFile.content) {
      yText.insert(0, activeFile.content);
    }

    const model = editor.getModel();
    if (model && model.getValue() !== activeFile.content) {
      model.setValue(activeFile.content);
    }

    const binding = new MonacoBinding(yText, model, new Set([editor]), provider.awareness);
    provider.awareness.setLocalStateField('user', { name: user.name, color: user.color });
    provider.on('status', ({ status }: { status: string }) => {
      setSyncStatus(status === 'connected' ? 'Yjs synced' : 'Yjs reconnecting');
    });
    provider.awareness.on('change', () => setPeerCount(provider.awareness.getStates().size));

    bindingRef.current = binding;
    providerRef.current = provider;
    ydocRef.current = ydoc;

    return () => {
      binding.destroy();
      provider.destroy();
      ydoc.destroy();
    };
  }, [activeFile, authToken, room, user.color, user.name]);

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
          code={landingCode}
          creating={creatingRoom}
          error={landingError}
          joining={joiningRoom}
          notice={landingNotice}
          onCodeChange={setLandingCode}
          onCreate={handleCreateRoom}
          onJoin={() => void joinRoom(landingCode)}
        />
        <Toast message={toastMessage} />
      </>
    );
  }

  const tree = buildTree(files);
  const hasApproved = pendingSwitch?.approvedUserIds.includes(user.id) ?? false;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <img alt="" className="brand-logo" src={pearLogoUrl} />
          <span>PearProgramming</span>
        </div>
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
          {isLeadPear && (
            <button className="topbar-button" onClick={handleToggleRoomLock} type="button">
              {roomLocked ? <Unlock size={14} /> : <Lock size={14} />}
              <span>{roomLocked ? 'Unlock Room' : 'Lock Room'}</span>
            </button>
          )}
          <button className="topbar-button" onClick={handleLeaveRoom} type="button">
            <LogOut size={14} />
            <span>Leave Room</span>
          </button>
          {isLeadPear && (
            <button className="topbar-button danger-button" onClick={handleCloseRoom} type="button">
              <Trash2 size={14} />
              <span>Close Room</span>
            </button>
          )}
        </div>
      </header>

      <section className={`workspace-grid ${chatOpen ? '' : 'chat-collapsed'}`}>
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
            </div>
          </div>
          <div className="upload-actions">
            <button className="upload-button" onClick={() => fileInputRef.current?.click()} type="button">
              <Upload size={14} />
              <span>Upload File</span>
            </button>
            <button className="upload-button" onClick={openFolderPicker} type="button">
              <FolderPlus size={14} />
              <span>Upload Folder</span>
            </button>
          </div>
          <input accept={UPLOAD_ACCEPT} className="hidden-file-input" multiple onChange={(event) => void handleUploadInput(event.currentTarget, false)} ref={fileInputRef} type="file" />
          <input accept={UPLOAD_ACCEPT} className="hidden-file-input" multiple onChange={(event) => void handleUploadInput(event.currentTarget, true)} ref={folderInputRef} type="file" />
          {uploadNotice && <p className="upload-notice">{uploadNotice}</p>}
          <div className="tree">
            {tree.length > 0 ? tree.map((node) => (
              <TreeRow
                activeFileId={activeFile?.id ?? ''}
                expandedFolders={expandedFolders}
                key={node.path}
                node={node}
                onFileSelect={openFileTab}
                onToggleFolder={toggleFolder}
              />
            )) : (
              <div className="empty-tree">No files yet</div>
            )}
          </div>
        </aside>

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
                value={activeFile.content}
              />
            ) : (
              <div className="empty-editor">
                <div>
                  <h1>Start with your files</h1>
                  <p>Create a file, upload files, or upload a folder to begin editing in this room.</p>
                  <div className="empty-editor-actions">
                    <button onClick={() => fileInputRef.current?.click()} type="button">
                      <Upload size={16} />
                      Upload File
                    </button>
                    <button onClick={openFolderPicker} type="button">
                      <FolderPlus size={16} />
                      Upload Folder
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>

        {chatOpen ? (
          <aside className="chat">
            <div className="pane-title-row chat-title-row">
              <span className="pane-title">Room chat</span>
              <div className="chat-title-tools">
                <span className="shared-label">{formatPacificTime(pacificNow.toISOString())}</span>
                <button className="icon-button" onClick={() => setChatOpen(false)} title="Hide chat" type="button">
                  <X size={14} />
                </button>
              </div>
            </div>
            <div className="messages">
              {messages.map((message) => (
                <article className={`message ${message.ai ? 'message-ai' : ''} ${message.system ? 'message-system' : ''}`} key={message.id}>
                  {message.system ? (
                    <p>{message.content}</p>
                  ) : (
                    <>
                      <div className="message-meta">
                        <span>{message.displayName}</span>
                        <span>{formatPacificTime(message.createdAt)}</span>
                      </div>
                      <p>{message.content}</p>
                    </>
                  )}
                </article>
              ))}
            </div>
            <div className="chat-input">
              <input
                onChange={(event) => setChatDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    sendChat();
                  }
                }}
                placeholder="Message or @AI..."
                value={chatDraft}
              />
              <button className="send-button" onClick={sendChat} title="Send message" type="button">
                <Send size={16} />
              </button>
            </div>
          </aside>
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
              <input accept="image/*" className="hidden-file-input" onChange={(event) => void handleAvatarInput(event.currentTarget)} ref={avatarInputRef} type="file" />
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
      <Toast message={toastMessage} />
    </main>
  );

  function openRoom(nextRoom: Room, nextFiles: WorkspaceFile[], replaceUrl: boolean, nextLeadUserId: string | null, locked: boolean) {
    const sortedFiles = nextFiles.sort(sortByPath);
    const firstFileId = sortedFiles[0]?.id ?? null;
    setRoom(nextRoom);
    setFiles(sortedFiles);
    setOpenFileIds(firstFileId ? [firstFileId] : []);
    setActiveFileId(firstFileId);
    setExpandedFolders(foldersForPaths(sortedFiles.map((file) => file.path)));
    setMessages([]);
    setAnnotations([]);
    setCursors({});
    setPresenceMembers({});
    setLeadUserId(nextLeadUserId);
    setRoomLocked(locked);
    setDelegateOpen(false);
    setDelegateUserId('');
    setUploadNotice('');
    setLandingNotice('');
    setSaveState(sortedFiles.length > 0 ? 'saved' : 'idle');
    setLastSavedAt(null);
    if (replaceUrl) {
      window.history.replaceState(null, '', `/join/${nextRoom.code}`);
    }
  }

  function sendChat() {
    const content = chatDraft.trim();
    if (!content || !room) {
      return;
    }

    if (stompClient?.connected) {
      stompClient.publish({
        destination: `/app/room/${room.code}/chat`,
        body: JSON.stringify({
          userId: user.id,
          displayName: user.name,
          content,
          currentFileId: activeFile?.id,
          currentFile: activeFile?.path,
          currentLine: cursorPosition.line
        })
      });
    } else {
      const localAiAnnotation = content.toUpperCase().includes('@AI') && activeFile
        ? createLocalAnnotation(activeFile.id, cursorPosition.line, user.name, room.code)
        : null;
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
        ...(content.toUpperCase().includes('@AI')
          ? [{
              id: crypto.randomUUID(),
              userId: null,
              displayName: 'AI',
              content: `Placeholder AI: I can see ${activeFile?.path ?? 'the active file'} and your cursor near line ${cursorPosition.line}.`,
              ai: true,
              createdAt: new Date().toISOString()
            }]
          : [])
      ].slice(-60));
      if (localAiAnnotation) {
        setAnnotations((current) => upsertAnnotation(current, localAiAnnotation).slice(-5));
      }
    }

    setChatDraft('');
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

  function openFolderPicker() {
    const input = folderInputRef.current;
    if (!input) {
      return;
    }

    configureFolderInput(input);
    input.click();
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
    setDelegateOpen(false);
    setDelegateUserId('');
    setPendingSwitch(null);
    setUploadNotice('');
    setSaveState('idle');
    setLastSavedAt(null);
    setLandingCode('');
    setLandingError('');
    setLandingNotice(notice);
    window.history.replaceState(null, '', '/');
  }

  function handleLeaveRoom() {
    if (!isLeadPear) {
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
      displayName: user.name,
      color: user.color,
      avatarUrl: user.avatarUrl,
      leadUserId: user.id,
      at: new Date().toISOString()
    });
    returnToLanding();
  }

  function handleCloseRoom() {
    if (!isLeadPear || !window.confirm('Close this room for everyone?')) {
      return;
    }

    publishMemberEvent({
      type: 'room-closed',
      userId: user.id,
      displayName: user.name,
      color: user.color,
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
      displayName: user.name,
      color: user.color,
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
      displayName: user.name,
      color: user.color,
      avatarUrl: user.avatarUrl,
      leadUserId: nextLead.id,
      targetUserId: nextLead.id,
      targetUserName: nextLead.name,
      at: new Date().toISOString()
    });
    returnToLanding();
  }

  async function handleNewFile() {
    const currentRoom = roomRef.current;
    if (!currentRoom) {
      return;
    }

    const path = window.prompt('New file path', 'index.js')?.trim();
    if (!path) {
      return;
    }

    try {
      const created = await createFile(currentRoom.workspaceId, path, '', inferLanguage(path));
      setFiles((current) => mergeFiles(current, [created]).sort(sortByPath));
      openFileTab(created.id);
      expandForPath(path);
    } catch {
      const local = createLocalFile(path, currentRoom.workspaceId);
      setFiles((current) => mergeFiles(current, [local]).sort(sortByPath));
      openFileTab(local.id);
      expandForPath(path);
    }
  }

  async function handleNewFolder() {
    const currentRoom = roomRef.current;
    if (!currentRoom) {
      return;
    }

    const path = window.prompt('New folder path', 'new-folder')?.trim();
    if (!path) {
      return;
    }

    const markerPath = `${path.replace(/\/$/, '')}/.gitkeep`;
    try {
      const created = await createFile(currentRoom.workspaceId, markerPath, '', 'plaintext');
      setFiles((current) => mergeFiles(current, [created]).sort(sortByPath));
      openFileTab(created.id);
      expandForPath(markerPath);
    } catch {
      const local = createLocalFile(markerPath, currentRoom.workspaceId);
      setFiles((current) => mergeFiles(current, [local]).sort(sortByPath));
      openFileTab(local.id);
      expandForPath(markerPath);
    }
  }

  async function handleUploadInput(input: HTMLInputElement, folderUpload: boolean) {
    if (!input.files || input.files.length === 0) {
      return;
    }

    const uploadResult = await readUploadCandidates(input.files);
    input.value = '';
    const { candidates, renamedCount } = folderUpload
      ? { candidates: uploadResult.candidates, renamedCount: 0 }
      : safeUploadPaths(uploadResult.candidates, files.map((file) => file.path));
    setUploadNotice(uploadNoticeText(uploadResult, renamedCount));
    if (candidates.length === 0) {
      setSaveState('error');
      return;
    }

    const newFolder = projectNameForPaths(candidates.map((file) => file.path));
    const isSwitch = files.length > 0 && folderUpload;
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
        approvedUserIds: []
      };
      pendingUploadRef.current = { proposalId, candidates, newFolder };
      setPendingSwitch(proposal);
      publishProjectSwitch({
        type: 'proposed',
        ...proposal,
        at: new Date().toISOString()
      });
      return;
    }

    void persistUploadCandidates(candidates, isSwitch);
  }

  async function persistUploadCandidates(candidates: UploadCandidate[], replaceExisting: boolean) {
    const currentRoom = roomRef.current;
    if (!currentRoom) {
      return [];
    }

    setSaveState('saving');
    try {
      const uploaded = currentRoom.id === FALLBACK_ROOM.id
        ? candidates.map((candidate) => createLocalFileFromCandidate(candidate, currentRoom.workspaceId))
        : await uploadWorkspaceFiles(currentRoom.workspaceId, candidates, replaceExisting);
      applyUploadedFiles(uploaded, replaceExisting);
      setSaveState(currentRoom.id === FALLBACK_ROOM.id ? 'offline' : 'saved');
      setLastSavedAt(new Date().toISOString());
      return uploaded;
    } catch {
      const local = candidates.map((candidate) => createLocalFileFromCandidate(candidate, currentRoom.workspaceId));
      applyUploadedFiles(local, replaceExisting);
      setSaveState('offline');
      return local;
    }
  }

  function applyUploadedFiles(uploaded: WorkspaceFile[], replaceExisting: boolean) {
    setFiles((current) => {
      const next = (replaceExisting ? uploaded : mergeFiles(current, uploaded)).sort(sortByPath);
      const nextFileIds = new Set(next.map((file) => file.id));
      const uploadedIds = uploaded.map((file) => file.id).filter((fileId) => nextFileIds.has(fileId));
      const nextOpenIds = replaceExisting
        ? uploadedIds
        : uniqueStrings([...openFileIds.filter((fileId) => nextFileIds.has(fileId)), ...uploadedIds]);
      const fallbackOpenIds = nextOpenIds.length > 0 ? nextOpenIds : next[0] ? [next[0].id] : [];
      setOpenFileIds(fallbackOpenIds);
      setActiveFileId(uploadedIds[0] ?? fallbackOpenIds[0] ?? null);
      setExpandedFolders(foldersForPaths(next.map((file) => file.path)));
      return next;
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

    if (event.type === 'accepted') {
      if (event.files?.length) {
        applyUploadedFiles(event.files, true);
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
    void persistUploadCandidates(upload.candidates, true)
      .then((uploaded) => {
        publishProjectSwitch({
          type: 'accepted',
          ...proposal,
          approvedUserIds: proposal.requiredUserIds,
          files: uploaded,
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

    if (event.type === 'lead-transferred' || event.type === 'lead-sync') {
      if (!event.targetUserId || event.targetUserId === user.id || event.type === 'lead-transferred') {
        setLeadUserId(event.leadUserId ?? event.targetUserId ?? event.userId);
      }
      return;
    }

    if (event.type === 'lock-changed') {
      return;
    }

    if (event.type === 'left') {
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

    if (event.userId !== user.id && (event.type === 'joined' || (event.type === 'presence-sync' && event.targetUserId === user.id))) {
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
          displayName: user.name,
          color: user.color,
          avatarUrl: user.avatarUrl,
          leadUserId: leadUserIdRef.current,
          locked: roomLocked,
          targetUserId: event.userId,
          at: new Date().toISOString()
        })
      });

      if (leadUserIdRef.current === user.id) {
        client.publish({
          destination: `/app/room/${currentRoom.code}/members`,
          body: JSON.stringify({
            type: 'lead-sync',
            userId: user.id,
            displayName: user.name,
            color: user.color,
            avatarUrl: user.avatarUrl,
            leadUserId: user.id,
            locked: roomLocked,
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
    if (!file || !file.type.startsWith('image/') || file.size > 512 * 1024) {
      return;
    }
    setProfileDraftAvatar(await fileToDataUrl(file));
  }

  function saveProfile() {
    const updated = {
      ...user,
      name: profileDraftName.trim() || 'You',
      avatarUrl: profileDraftAvatar
    };
    setUser(updated);
    localStorage.setItem('pearprogram-user', JSON.stringify(updated));
    setProfileOpen(false);

    const currentRoom = roomRef.current;
    const client = stompRef.current;
    if (currentRoom && client?.connected) {
      client.publish({
        destination: `/app/room/${currentRoom.code}/members`,
        body: JSON.stringify({
          type: 'joined',
          userId: updated.id,
          displayName: updated.name,
          color: updated.color,
          avatarUrl: updated.avatarUrl,
          leadUserId: leadUserIdRef.current,
          locked: roomLocked,
          at: new Date().toISOString()
        })
      });
    }
  }
}

function LandingPage({
  code,
  creating,
  error,
  joining,
  notice,
  onCodeChange,
  onCreate,
  onJoin
}: {
  code: string;
  creating: boolean;
  error: string;
  joining: boolean;
  notice: string;
  onCodeChange: (code: string) => void;
  onCreate: () => void;
  onJoin: () => void;
}) {
  return (
    <main className="landing-shell">
      <img alt="" className="landing-chibi" src={pearChibiUrl} />
      <section className="landing-hero">
        <div className="landing-hero-grid">
          <div className="landing-copy">
            <div className="landing-brand landing-brand-hero">
              <img alt="" className="brand-logo brand-logo-large" src={pearLogoUrl} />
              <span>PearProgramming</span>
            </div>
            <p className="landing-subheading">Pair Program Together. Real-time Coding Rooms.</p>
            <h1>Code together in a pear-ly friendly browser IDE in real time.</h1>
          
            <p>
              PearProgramming is a real-time collaborative coding platform where teams can write code together, chat alongside their work, and stay in sync in a shared browser IDE. Rooms are limited to 5 pears for smooth collaboration. 
              </p>
                <p>
            <b>What's makes PearProgramming different? </b> 
            </p>
              <p> PearProgramming offers <b>PearAI</b>, your context-aware coding assistant that understands your code, project structure, edits, and conversations to help you and your team move faster.
        </p>
              <br />
              <b>Get Pearing.</b>
 
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

function TreeRow({
  node,
  activeFileId,
  expandedFolders,
  onFileSelect,
  onToggleFolder,
  depth = 0
}: {
  node: TreeNode;
  activeFileId: string;
  expandedFolders: Set<string>;
  onFileSelect: (fileId: string) => void;
  onToggleFolder: (path: string) => void;
  depth?: number;
}) {
  if (node.file) {
    return (
      <button
        className={`tree-row file-row ${activeFileId === node.file.id ? 'file-row-active' : ''}`}
        onClick={() => onFileSelect(node.file!.id)}
        style={{ paddingLeft: 10 + depth * 14 }}
        type="button"
      >
        <span className={`language-dot ${languageClass(node.file.language)}`} />
        <span>{node.name}</span>
      </button>
    );
  }

  const expanded = expandedFolders.has(node.path);
  return (
    <div>
      <button className="tree-row folder-row" onClick={() => onToggleFolder(node.path)} style={{ paddingLeft: 8 + depth * 14 }} type="button">
        {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <Folder size={14} />
        <span>{node.name}</span>
      </button>
      {expanded && node.children.map((child) => (
        <TreeRow
          activeFileId={activeFileId}
          depth={depth + 1}
          expandedFolders={expandedFolders}
          key={child.path}
          node={child}
          onFileSelect={onFileSelect}
          onToggleFolder={onToggleFolder}
        />
      ))}
    </div>
  );
}

function buildTree(files: WorkspaceFile[]): TreeNode[] {
  const root: MutableTreeNode = { name: '', path: '', children: new Map() };

  for (const file of files) {
    const parts = file.path.split('/').filter(Boolean);
    let cursor = root;
    let currentPath = '';

    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index];
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      const isFile = index === parts.length - 1;
      if (!cursor.children.has(part)) {
        cursor.children.set(part, { name: part, path: currentPath, children: new Map() });
      }
      cursor = cursor.children.get(part)!;
      if (isFile) {
        cursor.file = file;
      }
    }
  }

  return [...root.children.values()].map(toTreeNode);
}

function toTreeNode(node: MutableTreeNode): TreeNode {
  return {
    name: node.name,
    path: node.path,
    file: node.file,
    children: [...node.children.values()]
      .sort((a, b) => Number(Boolean(a.file)) - Number(Boolean(b.file)) || a.name.localeCompare(b.name))
      .map(toTreeNode)
  };
}

function getJoinCode() {
  const match = window.location.pathname.match(/^\/(?:join|room)\/([^/]+)/);
  return match?.[1] ?? null;
}

function getOrCreateLocalUser(): Member {
  const stored = localStorage.getItem('pearprogram-user');
  if (stored) {
    try {
      return JSON.parse(stored) as Member;
    } catch {
      localStorage.removeItem('pearprogram-user');
    }
  }

  const id = crypto.randomUUID();
  const user: Member = {
    id,
    name: 'You',
    color: USER_COLORS[Math.abs(hash(id)) % USER_COLORS.length]
  };
  localStorage.setItem('pearprogram-user', JSON.stringify(user));
  return user;
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

function createLocalAnnotation(fileId: string, line: number, userName: string, roomCode: string): AiAnnotation {
  return {
    id: crypto.randomUUID(),
    fileId,
    roomCode,
    triggeredBy: userName,
    line: Math.max(1, line),
    content: `${userName} is working near line ${Math.max(1, line)}. Placeholder AI would compare this against recent diffs before making a concrete suggestion.`,
    createdAt: new Date().toISOString()
  };
}

function createLocalFile(path: string, workspaceId: string): WorkspaceFile {
  return {
    id: crypto.randomUUID(),
    workspaceId,
    path,
    language: inferLanguage(path),
    content: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function createLocalFileFromCandidate(candidate: UploadCandidate, workspaceId: string): WorkspaceFile {
  return {
    id: crypto.randomUUID(),
    workspaceId,
    path: candidate.path,
    language: candidate.language,
    content: candidate.content,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
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

function normalizeRoomCode(value: string) {
  return value.trim().toUpperCase();
}

function isValidRoomCode(value: string) {
  return /^[A-Z0-9]{6}$/.test(value);
}

function randomRoomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let index = 0; index < 6; index += 1) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
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

function uploadNoticeText(result: UploadReadResult, renamedCount = 0) {
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

function safeUploadPaths(candidates: UploadCandidate[], existingPaths: string[]) {
  const usedPaths = new Set(existingPaths);
  let renamedCount = 0;
  const safeCandidates = candidates.map((candidate) => {
    if (!usedPaths.has(candidate.path)) {
      usedPaths.add(candidate.path);
      return candidate;
    }

    renamedCount += 1;
    const path = uniqueCopyPath(candidate.path, usedPaths);
    usedPaths.add(path);
    return { ...candidate, path, language: inferLanguage(path) };
  });

  return { candidates: safeCandidates, renamedCount };
}

function uniqueCopyPath(path: string, usedPaths: Set<string>) {
  const slashIndex = path.lastIndexOf('/');
  const directory = slashIndex >= 0 ? `${path.slice(0, slashIndex + 1)}` : '';
  const filename = slashIndex >= 0 ? path.slice(slashIndex + 1) : path;
  const dotIndex = filename.lastIndexOf('.');
  const base = dotIndex > 0 ? filename.slice(0, dotIndex) : filename;
  const extension = dotIndex > 0 ? filename.slice(dotIndex) : '';

  let suffix = 'copy';
  let candidate = `${directory}${base}-${suffix}${extension}`;
  let index = 2;
  while (usedPaths.has(candidate)) {
    suffix = `copy-${index}`;
    candidate = `${directory}${base}-${suffix}${extension}`;
    index += 1;
  }
  return candidate;
}

function configureFolderInput(input: HTMLInputElement) {
  const folderInput = input as HTMLInputElement & { webkitdirectory?: boolean; directory?: boolean };
  folderInput.webkitdirectory = true;
  folderInput.directory = true;
  input.setAttribute('webkitdirectory', '');
  input.setAttribute('directory', '');
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

function hash(value: string) {
  let total = 0;
  for (let index = 0; index < value.length; index += 1) {
    total = (total << 5) - total + value.charCodeAt(index);
    total |= 0;
  }
  return total;
}
