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
  LogIn,
  MessageSquare,
  Send,
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
import type { UploadCandidate } from './uploads';
import { projectNameForPaths, readUploadCandidates } from './uploads';
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

type SaveState = 'idle' | 'saving' | 'saved' | 'offline' | 'error';

export default function App() {
  const [room, setRoom] = useState<Room | null>(null);
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
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
  const [creatingRoom, setCreatingRoom] = useState(false);
  const [joiningRoom, setJoiningRoom] = useState(false);
  const [chatOpen, setChatOpen] = useState(true);
  const [pacificNow, setPacificNow] = useState(() => new Date());
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [pendingSwitch, setPendingSwitch] = useState<PendingSwitch | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileDraftName, setProfileDraftName] = useState('');
  const [profileDraftAvatar, setProfileDraftAvatar] = useState<string | undefined>();
  const [user, setUser] = useState<Member>(() => getOrCreateLocalUser());

  const activeFile = files.find((file) => file.id === activeFileId) ?? files[0] ?? null;
  const activeProjectName = files.length > 0 ? projectNameForPaths(files.map((file) => file.path)) : 'Empty room';
  const remoteMembers = Object.values(cursors)
    .filter((cursor) => cursor.userId !== user.id)
    .map<Member>((cursor) => ({ id: cursor.userId, name: cursor.displayName, color: cursor.color }));
  const humanMembers = uniqueMembers([user, ...Object.values(presenceMembers), ...remoteMembers]);
  const members = uniqueMembers([...humanMembers, { id: 'ai', name: 'AI', color: '#8B5CF6', ai: true }]);

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
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);

  const joinRoom = useCallback(async (rawCode: string, replaceUrl = true) => {
    const code = normalizeRoomCode(rawCode);
    if (!code) {
      setLandingError('Enter a room code to join.');
      return;
    }

    setJoiningRoom(true);
    setLandingError('');
    try {
      const joinedRoom = await getRoom(code);
      const joinedFiles = await listFiles(joinedRoom.workspaceId);
      openRoom(joinedRoom, joinedFiles, replaceUrl);
    } catch {
      setLandingError(`Could not find room ${code}.`);
    } finally {
      setJoiningRoom(false);
    }
  }, []);

  const handleCreateRoom = useCallback(async () => {
    setCreatingRoom(true);
    setLandingError('');
    try {
      const workspace = await createWorkspace(`Pear room ${formatRoomNameDate(new Date())}`);
      const createdRoom = await createRoom(workspace.id);
      openRoom(createdRoom, [], true);
    } catch {
      const fallbackRoom = { ...FALLBACK_ROOM, code: randomRoomCode() };
      openRoom(fallbackRoom, [], true);
      setLandingError('Backend is offline, so this room is local-only for now.');
    } finally {
      setCreatingRoom(false);
    }
  }, []);

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
    folderInputRef.current?.setAttribute('webkitdirectory', '');
    folderInputRef.current?.setAttribute('directory', '');
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
          const event = JSON.parse(message.body) as { type: string; userId: string; displayName?: string; color?: string; avatarUrl?: string };
          if (event.type === 'left') {
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
          if (event.type === 'joined' && event.userId !== user.id) {
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
          body: JSON.stringify({ type: 'left', userId: user.id, displayName: user.name, color: user.color, at: new Date().toISOString() })
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
      <LandingPage
        code={landingCode}
        creating={creatingRoom}
        error={landingError}
        joining={joiningRoom}
        onCodeChange={setLandingCode}
        onCreate={handleCreateRoom}
        onJoin={() => void joinRoom(landingCode)}
      />
    );
  }

  const tree = buildTree(files);
  const hasApproved = pendingSwitch?.approvedUserIds.includes(user.id) ?? false;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">Pear</span>
          <span>PearProgram</span>
        </div>
        <div className="project-label">
          <span>{activeProjectName}</span>
        </div>
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
              <span>Upload files</span>
            </button>
            <button className="upload-button" onClick={() => folderInputRef.current?.click()} type="button">
              <FolderPlus size={14} />
              <span>Upload folder</span>
            </button>
          </div>
          <input className="hidden-file-input" multiple onChange={(event) => void handleUploadInput(event.currentTarget, false)} ref={fileInputRef} type="file" />
          <input className="hidden-file-input" multiple onChange={(event) => void handleUploadInput(event.currentTarget, true)} ref={folderInputRef} type="file" />
          <div className="tree">
            {tree.length > 0 ? tree.map((node) => (
              <TreeRow
                activeFileId={activeFile?.id ?? ''}
                expandedFolders={expandedFolders}
                key={node.path}
                node={node}
                onFileSelect={setActiveFileId}
                onToggleFolder={toggleFolder}
              />
            )) : (
              <div className="empty-tree">No files yet</div>
            )}
          </div>
        </aside>

        <section className="editor-area">
          <div className="tabs">
            {files.map((file) => (
              <button
                className={`tab ${file.id === activeFile?.id ? 'tab-active' : ''}`}
                key={file.id}
                onClick={() => setActiveFileId(file.id)}
                type="button"
              >
                <span className={`language-dot ${languageClass(file.language)}`} />
                <span>{basename(file.path)}</span>
              </button>
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
                      Upload files
                    </button>
                    <button onClick={() => folderInputRef.current?.click()} type="button">
                      <FolderPlus size={16} />
                      Upload folder
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
                <article className={`message ${message.ai ? 'message-ai' : ''}`} key={message.id}>
                  <div className="message-meta">
                    <span>{message.displayName}</span>
                    <span>{formatPacificTime(message.createdAt)}</span>
                  </div>
                  <p>{message.content}</p>
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

      <button className="room-code-float" onClick={copyRoomCode} title="Copy room code" type="button">
        <span>Room Code: {room.code}</span>
        <Copy size={13} />
      </button>

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
    </main>
  );

  function openRoom(nextRoom: Room, nextFiles: WorkspaceFile[], replaceUrl: boolean) {
    setRoom(nextRoom);
    setFiles(nextFiles.sort(sortByPath));
    setActiveFileId(nextFiles[0]?.id ?? null);
    setExpandedFolders(foldersForPaths(nextFiles.map((file) => file.path)));
    setMessages([]);
    setAnnotations([]);
    setCursors({});
    setPresenceMembers({});
    setSaveState(nextFiles.length > 0 ? 'saved' : 'idle');
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
      setActiveFileId(created.id);
      expandForPath(path);
    } catch {
      const local = createLocalFile(path, currentRoom.workspaceId);
      setFiles((current) => mergeFiles(current, [local]).sort(sortByPath));
      setActiveFileId(local.id);
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
      setActiveFileId(created.id);
      expandForPath(markerPath);
    } catch {
      const local = createLocalFile(markerPath, currentRoom.workspaceId);
      setFiles((current) => mergeFiles(current, [local]).sort(sortByPath));
      setActiveFileId(local.id);
      expandForPath(markerPath);
    }
  }

  async function handleUploadInput(input: HTMLInputElement, folderUpload: boolean) {
    if (!input.files || input.files.length === 0) {
      return;
    }

    const candidates = await readUploadCandidates(input.files);
    input.value = '';
    if (candidates.length === 0) {
      setSaveState('error');
      return;
    }

    const newFolder = projectNameForPaths(candidates.map((file) => file.path));
    const isSwitch = files.length > 0 && (folderUpload || newFolder !== activeProjectName);
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
      setActiveFileId(next[0]?.id ?? null);
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
  onCodeChange,
  onCreate,
  onJoin
}: {
  code: string;
  creating: boolean;
  error: string;
  joining: boolean;
  onCodeChange: (code: string) => void;
  onCreate: () => void;
  onJoin: () => void;
}) {
  return (
    <main className="landing-shell">
      <section className="landing-panel">
        <div className="landing-brand">
          <span className="brand-mark">Pear</span>
          <span>PearProgram</span>
        </div>
        <h1>Create or join a coding room</h1>
        <div className="landing-actions">
          <button className="primary-button create-room-button" disabled={creating} onClick={onCreate} type="button">
            <Upload size={16} />
            {creating ? 'Creating...' : 'Create empty room'}
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
              placeholder="Enter room code"
              value={code}
            />
            <button className="secondary-button" disabled={joining} type="submit">
              <LogIn size={15} />
              {joining ? 'Joining...' : 'Join'}
            </button>
          </form>
        </div>
        {error && <p className="landing-error">{error}</p>}
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
