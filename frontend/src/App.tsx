import Editor, { type OnMount } from '@monaco-editor/react';
import { Client, type IMessage } from '@stomp/stompjs';
import {
  Bot,
  ChevronDown,
  ChevronRight,
  Copy,
  FileCode2,
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
import { bootstrapDemoRoom, getRoom, listFiles, STOMP_URL, YJS_URL } from './api';
import type { ChatMessage, CursorMessage, Member, Room, WorkspaceFile } from './types';

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
  const [cursors, setCursors] = useState<Record<string, CursorMessage>>({});
  const [stompClient, setStompClient] = useState<Client | null>(null);
  const [stompConnected, setStompConnected] = useState(false);
  const [syncStatus, setSyncStatus] = useState('Yjs offline');
  const [peerCount, setPeerCount] = useState(1);
  const [chatDraft, setChatDraft] = useState('');
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

    const client = new Client({
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
  }, [room, user.color, user.id, user.name]);

  useEffect(() => {
    const editor = editorRef.current as any;
    if (!editor || !room || !activeFile) {
      return;
    }

    bindingRef.current?.destroy();
    providerRef.current?.destroy();
    ydocRef.current?.destroy();

    const ydoc = new Y.Doc();
    const provider = new WebsocketProvider(YJS_URL, `${room.code}/${activeFile.id}`, ydoc);
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
  }, [activeFile, room, user.color, user.name]);

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
        body: JSON.stringify({ userId: user.id, displayName: user.name, content })
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
        ...(content.toUpperCase().includes('@AI')
          ? [{
              id: crypto.randomUUID(),
              userId: null,
              displayName: 'AI',
              content: 'AI is unavailable, try again',
              ai: true,
              createdAt: new Date().toISOString()
            }]
          : [])
      ].slice(-60));
    }

    setChatDraft('');
  }, [chatDraft, room, stompClient, user.id, user.name]);

  const copyRoomLink = useCallback(() => {
    if (!room) {
      return;
    }
    void navigator.clipboard.writeText(`${window.location.origin}/join/${room.code}`);
  }, [room]);

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
              <button className="icon-button" type="button" title="New file">
                <FilePlus2 size={15} />
              </button>
              <button className="icon-button" type="button" title="New folder">
                <FolderPlus size={15} />
              </button>
            </div>
          </div>
          <button className="github-button" type="button">
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
        <span>Ln 1, Col 1</span>
        <span className="sync-status">
          {stompConnected ? <Wifi size={13} /> : <WifiOff size={13} />}
          {syncStatus} · {peerCount} peers
        </span>
        <span className="encoding">UTF-8 · LF</span>
      </footer>
    </main>
  );

  function clearCursorWidgets(editor: any) {
    for (const widget of cursorWidgetsRef.current.values()) {
      editor.removeContentWidget(widget);
    }
    cursorWidgetsRef.current.clear();
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

function hash(value: string) {
  let total = 0;
  for (let index = 0; index < value.length; index += 1) {
    total = (total << 5) - total + value.charCodeAt(index);
    total |= 0;
  }
  return total;
}
