import Editor, { type OnMount } from '@monaco-editor/react';
import { Client, type IMessage } from '@stomp/stompjs';
import {
  Bot,
  ChevronDown,
  ChevronRight,
  Copy,
  FilePlus2,
  Folder,
  FolderPlus,
  Github,
  Send,
  Wifi,
  WifiOff
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import SockJS from 'sockjs-client';
import * as Y from 'yjs';
import { MonacoBinding } from 'y-monaco';
import { WebsocketProvider } from 'y-websocket';
import {
  bootstrapDemoRoom,
  createFile,
  dismissAnnotation,
  getRoom,
  issueDevToken,
  importPlaceholderRepository,
  listAnnotations,
  listChatHistory,
  listFiles,
  STOMP_URL,
  YJS_URL
} from './api';
import type { AiAnnotation, ChatMessage, CursorMessage, Member, Room, WorkspaceFile } from './types';

const USER_COLORS = ['#378ADD', '#1D9E75', '#F59E0B', '#D946EF', '#EF4444'];

const FALLBACK_ROOM: Room = {
  id: 'local-room',
  code: 'XK7-29F',
  workspaceId: 'local-workspace',
  active: true,
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
};

const FALLBACK_FILE: WorkspaceFile = {
  id: 'local-room-controller',
  workspaceId: 'local-workspace',
  path: 'src/main/java/RoomController.java',
  language: 'java',
  content: `package com.pearprogram.rooms;

import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/rooms")
public class RoomController {
    private final RoomService roomService;

    public RoomController(RoomService roomService) {
        this.roomService = roomService;
    }

    @PostMapping
    public RoomDto createRoom(CreateRoomRequest request) {
        return roomService.createRoom(request.workspaceId());
    }
}
`,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
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

export default function App() {
  const [room, setRoom] = useState<Room | null>(null);
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [annotations, setAnnotations] = useState<AiAnnotation[]>([]);
  const [cursors, setCursors] = useState<Record<string, CursorMessage>>({});
  const [stompClient, setStompClient] = useState<Client | null>(null);
  const [stompConnected, setStompConnected] = useState(false);
  const [syncStatus, setSyncStatus] = useState('Yjs offline');
  const [peerCount, setPeerCount] = useState(1);
  const [chatDraft, setChatDraft] = useState('');
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [cursorPosition, setCursorPosition] = useState({ line: 1, col: 1 });
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => new Set(['src', 'src/main', 'src/main/java']));

  const user = useMemo(getOrCreateLocalUser, []);
  const activeFile = files.find((file) => file.id === activeFileId) ?? files[0] ?? null;
  const remoteMembers = Object.values(cursors)
    .filter((cursor) => cursor.userId !== user.id)
    .map<Member>((cursor) => ({ id: cursor.userId, name: cursor.displayName, color: cursor.color }));
  const members = uniqueMembers([user, ...remoteMembers, { id: 'ai', name: 'AI', color: '#8B5CF6', ai: true }]);

  const editorRef = useRef<unknown>(null);
  const monacoRef = useRef<any>(null);
  const bindingRef = useRef<MonacoBinding | null>(null);
  const providerRef = useRef<WebsocketProvider | null>(null);
  const ydocRef = useRef<Y.Doc | null>(null);
  const cursorWidgetsRef = useRef<Map<string, any>>(new Map());
  const annotationWidgetsRef = useRef<Map<string, any>>(new Map());
  const cursorSentAtRef = useRef(0);
  const roomRef = useRef<Room | null>(null);
  const activeFileRef = useRef<WorkspaceFile | null>(null);
  const stompRef = useRef<Client | null>(null);

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
    let cancelled = false;

    async function loadRoom() {
      try {
        const joinCode = getJoinCode();
        if (joinCode) {
          const joinedRoom = await getRoom(joinCode);
          const joinedFiles = await listFiles(joinedRoom.workspaceId);
          if (!cancelled) {
            setRoom(joinedRoom);
            setFiles(joinedFiles.length > 0 ? joinedFiles : [FALLBACK_FILE]);
            setActiveFileId(joinedFiles[0]?.id ?? FALLBACK_FILE.id);
          }
          return;
        }

        const bootstrapped = await bootstrapDemoRoom();
        if (!cancelled) {
          setRoom(bootstrapped.room);
          setFiles(bootstrapped.files.length > 0 ? bootstrapped.files : [FALLBACK_FILE]);
          setActiveFileId(bootstrapped.files[0]?.id ?? FALLBACK_FILE.id);
        }
      } catch {
        if (!cancelled) {
          setRoom(FALLBACK_ROOM);
          setFiles([FALLBACK_FILE]);
          setActiveFileId(FALLBACK_FILE.id);
          setMessages([
            {
              id: 'local-system',
              userId: null,
              displayName: 'AI',
              content: 'AI is unavailable, try again',
              ai: true,
              createdAt: new Date().toISOString()
            }
          ]);
        }
      }
    }

    loadRoom();
    return () => {
      cancelled = true;
    };
  }, []);

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
          const event = JSON.parse(message.body) as { type: string; userId: string };
          if (event.type === 'left') {
            setCursors((current) => {
              const next = { ...current };
              delete next[event.userId];
              return next;
            });
          }
        });
        client.subscribe(`/topic/room/${room.code}/annotations`, (message: IMessage) => {
          const annotation = JSON.parse(message.body) as AiAnnotation;
          setAnnotations((current) => upsertAnnotation(current, annotation).slice(-5));
        });
        client.publish({
          destination: `/app/room/${room.code}/members`,
          body: JSON.stringify({ type: 'joined', userId: user.id, displayName: user.name, color: user.color, at: new Date().toISOString() })
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
  }, [authToken, room, user.color, user.id, user.name]);

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
  }, [user.color, user.id, user.name]);

  const sendChat = useCallback(() => {
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
        ? createLocalAnnotation(activeFile.id, cursorPosition.line, user.name)
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
              content: `Placeholder AI: I can see ${activeFile?.path ?? 'the active file'} and your cursor near line ${cursorPosition.line}. I would use recent diffs and room cursors before giving a concrete suggestion.`,
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
  }, [activeFile, chatDraft, cursorPosition.line, room, stompClient, user.id, user.name]);

  const copyRoomLink = useCallback(() => {
    if (!room) {
      return;
    }
    void navigator.clipboard.writeText(`${window.location.origin}/join/${room.code}`);
  }, [room]);

  const handleNewFile = useCallback(async () => {
    if (!room) {
      return;
    }

    const path = window.prompt('New file path', 'src/main/java/NewFile.java')?.trim();
    if (!path) {
      return;
    }

    try {
      const created = await createFile(room.workspaceId, path);
      setFiles((current) => [...current.filter((file) => file.id !== created.id), created].sort(sortByPath));
      setActiveFileId(created.id);
      expandForPath(path);
    } catch {
      const local = createLocalFile(path);
      setFiles((current) => [...current, local].sort(sortByPath));
      setActiveFileId(local.id);
      expandForPath(path);
    }
  }, [room]);

  const handleNewFolder = useCallback(async () => {
    if (!room) {
      return;
    }

    const path = window.prompt('New folder path', 'src/main/java/newfolder')?.trim();
    if (!path) {
      return;
    }

    const markerPath = `${path.replace(/\/$/, '')}/.gitkeep`;
    try {
      const created = await createFile(room.workspaceId, markerPath);
      setFiles((current) => [...current.filter((file) => file.id !== created.id), created].sort(sortByPath));
      setActiveFileId(created.id);
      expandForPath(markerPath);
    } catch {
      const local = createLocalFile(markerPath);
      setFiles((current) => [...current, local].sort(sortByPath));
      setActiveFileId(local.id);
      expandForPath(markerPath);
    }
  }, [room]);

  const handleImportGitHub = useCallback(async () => {
    if (!room) {
      return;
    }

    const repoInput = window.prompt('GitHub repo', 'sample-org/pearprogram-import')?.trim();
    if (!repoInput) {
      return;
    }
    const [owner = 'sample-org', repo = 'pearprogram-import'] = repoInput.split('/');
    const branch = window.prompt('Branch', 'main')?.trim() || 'main';

    try {
      const imported = await importPlaceholderRepository(room.workspaceId, owner, repo, branch);
      setFiles((current) => mergeFiles(current, imported.files).sort(sortByPath));
      setActiveFileId(imported.files[0]?.id ?? activeFileId);
      imported.files.forEach((file) => expandForPath(file.path));
    } catch {
      const imported = createLocalGitHubFiles(owner, repo, branch);
      setFiles((current) => mergeFiles(current, imported).sort(sortByPath));
      setActiveFileId(imported[0]?.id ?? activeFileId);
      imported.forEach((file) => expandForPath(file.path));
    }
  }, [activeFileId, room]);

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

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">Pear</span>
          <span>PearProgram</span>
        </div>
        <button className="room-pill" onClick={copyRoomLink} title="Copy room link" type="button">
          <span>{room?.code ?? '...'}</span>
          <Copy size={13} />
        </button>
        <div className="collaborators" aria-label="Collaborators">
          <span className="online-dot" />
          <span className="online-count">{Math.max(1, members.length - 1)} online</span>
          {members.map((member) => (
            <span
              className={`avatar ${member.ai ? 'avatar-ai' : ''}`}
              key={member.id}
              style={{ backgroundColor: member.ai ? '#EEEDFE' : `${member.color}22`, color: member.color }}
              title={member.name}
            >
              {member.ai ? <Bot size={13} /> : initials(member.name)}
            </span>
          ))}
        </div>
      </header>

      <section className="workspace-grid">
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
          <button className="github-button" onClick={handleImportGitHub} type="button">
            <Github size={15} />
            <span>Import from GitHub</span>
          </button>
          <div className="tree">
            {buildTree(files).map((node) => (
              <TreeRow
                activeFileId={activeFile?.id ?? ''}
                expandedFolders={expandedFolders}
                key={node.path}
                node={node}
                onFileSelect={setActiveFileId}
                onToggleFolder={toggleFolder}
              />
            ))}
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
            <Editor
              height="100%"
              language={activeFile?.language ?? 'java'}
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
              path={activeFile?.path}
              theme="pear-github-dark"
              value={activeFile?.content ?? ''}
            />
          </div>
        </section>

        <aside className="chat">
          <div className="pane-title-row chat-title-row">
            <span className="pane-title">Room chat</span>
            <span className="shared-label">shared</span>
          </div>
          <div className="messages">
            {messages.map((message) => (
              <article className={`message ${message.ai ? 'message-ai' : ''}`} key={message.id}>
                <div className="message-meta">
                  <span>{message.displayName}</span>
                  <span>{relativeTime(message.createdAt)}</span>
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
      </section>

      <footer className="statusbar">
        <span className="status-pill">{activeFile?.language ?? 'plaintext'}</span>
        <span>Ln {cursorPosition.line}, Col {cursorPosition.col}</span>
        <span className="sync-status">
          {stompConnected ? <Wifi size={13} /> : <WifiOff size={13} />}
          {syncStatus} - {peerCount} peers
        </span>
        <span className="encoding">UTF-8 - LF</span>
      </footer>
    </main>
  );

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
  const match = window.location.pathname.match(/^\/join\/([^/]+)/);
  return match?.[1] ?? null;
}

function getOrCreateLocalUser(): Member {
  const stored = localStorage.getItem('pearprogram-user');
  if (stored) {
    return JSON.parse(stored) as Member;
  }

  const id = crypto.randomUUID();
  const user: Member = {
    id,
    name: `You`,
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

function languageClass(language: string) {
  if (language === 'java' || language === 'typescript') {
    return 'dot-blue';
  }
  if (language === 'javascript') {
    return 'dot-amber';
  }
  if (language === 'python') {
    return 'dot-green';
  }
  return 'dot-neutral';
}

function relativeTime(value: string) {
  const diffMs = Date.now() - new Date(value).getTime();
  const minutes = Math.max(0, Math.round(diffMs / 60_000));
  if (minutes === 0) {
    return 'now';
  }
  return `${minutes}m`;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function upsertAnnotation(current: AiAnnotation[], annotation: AiAnnotation) {
  return [...current.filter((item) => item.id !== annotation.id), annotation];
}

function createLocalAnnotation(fileId: string, line: number, userName: string): AiAnnotation {
  return {
    id: crypto.randomUUID(),
    fileId,
    roomCode: FALLBACK_ROOM.code,
    triggeredBy: userName,
    line: Math.max(1, line),
    content: `${userName} is working near line ${Math.max(1, line)}. Placeholder AI would compare this against recent diffs before making a concrete suggestion.`,
    createdAt: new Date().toISOString()
  };
}

function createLocalFile(path: string): WorkspaceFile {
  return {
    id: crypto.randomUUID(),
    workspaceId: FALLBACK_ROOM.workspaceId,
    path,
    language: inferLanguage(path),
    content: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function createLocalGitHubFiles(owner: string, repo: string, branch: string): WorkspaceFile[] {
  const now = new Date().toISOString();
  return [
    {
      id: crypto.randomUUID(),
      workspaceId: FALLBACK_ROOM.workspaceId,
      path: `${repo}/README.md`,
      language: 'markdown',
      content: `# ${repo}\n\nPlaceholder GitHub import from ${owner}/${repo}@${branch}.\n`,
      createdAt: now,
      updatedAt: now
    },
    {
      id: crypto.randomUUID(),
      workspaceId: FALLBACK_ROOM.workspaceId,
      path: `${repo}/src/ImportedEditor.tsx`,
      language: 'typescript',
      content: `export function ImportedEditor() {\n  return <section>PearProgram imported this placeholder file from GitHub.</section>;\n}\n`,
      createdAt: now,
      updatedAt: now
    }
  ];
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

function inferLanguage(path: string) {
  const lower = path.toLowerCase();
  if (lower.endsWith('.java')) {
    return 'java';
  }
  if (lower.endsWith('.ts') || lower.endsWith('.tsx')) {
    return 'typescript';
  }
  if (lower.endsWith('.js') || lower.endsWith('.jsx')) {
    return 'javascript';
  }
  if (lower.endsWith('.py')) {
    return 'python';
  }
  if (lower.endsWith('.md')) {
    return 'markdown';
  }
  return 'plaintext';
}

function hash(value: string) {
  let total = 0;
  for (let index = 0; index < value.length; index += 1) {
    total = (total << 5) - total + value.charCodeAt(index);
    total |= 0;
  }
  return total;
}
