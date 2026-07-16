import { type OnMount } from '@monaco-editor/react';
import {
  Check,
  PanelRightOpen,
  Wifi,
  WifiOff,
  X
} from 'lucide-react';
import { type DragEvent, useCallback, useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import {
  API_BASE_URL,
  createFile,
  dismissAnnotation,
  listAnnotations,
  saveRoomFiles,
  updateFileContent,
  uploadWorkspaceFiles,
  YJS_URL
} from '../api';
import { executionLanguageForEditorLanguage, inferLanguage, type ExecutionLanguage } from '../language';
import { useExecution } from '../execution/useExecution';
import { createExecutionInput } from '../execution/input';
import { useAuthSession } from '../auth/useAuthSession';
import { useRoomConnection } from '../collaboration/useRoomConnection';
import { useCollaborativeDocument } from '../collaboration/useCollaborativeDocument';
import { ChatPanel } from '../components/chat/ChatPanel';
import { LandingPage } from '../components/landing/LandingPage';
import { CreateItemModal, EntryProfileModal, Toast, UploadModal } from '../components/ide/IDEModals';
import { IDEHeader } from '../components/ide/IDEHeader';
import { ExplorerPanel } from '../components/ide/ExplorerPanel';
import { EditorWorkspace } from '../components/ide/EditorWorkspace';
import { ProfileMenu } from '../components/ide/ProfileMenu';
import { MIN_CONSOLE_HEIGHT, useConsoleLayout } from './useConsoleLayout';
import { reconcileEditorTabs, restoreEditorTabs, useEditorTabs } from './useEditorTabs';
import {
  buildWakeUrl,
  clearRoomSession,
  getOrCreateConnectionId,
  persistRoomSession,
  saveStatusText,
  type SaveState
} from './roomSession';
import {
  buildMentionOptions,
  messageMentionsUser,
  renderMessageContent,
  uniqueMembers,
  type MemberRealtimeEvent
} from './presence';
import { useRoomChat } from './useRoomChat';
import {
  basename,
  configureFolderInput,
  createLocalFile,
  createLocalFileFromCandidate,
  filterTombstonedFileUpdates,
  foldersForPaths,
  isUuid,
  mergeFiles,
  removeTreePath,
  resolveCreateItemTarget,
  sortByPath,
  uniqueStrings,
  uploadNoticeText
} from './workspaceFiles';
import { createZipBlob, safeDownloadName } from './workspaceDownload';
import { useRoomEntry } from './useRoomEntry';
import { useRoomPresence } from './useRoomPresence';
import type { UploadCandidate, UploadReadResult } from '../uploads';
import { projectNameForPaths, readDroppedUploadCandidates, readUploadCandidates } from '../uploads';
import type { AiAnnotation, ChatMessage, CursorMessage, Member, ProjectSwitchEvent, Room, RoomSessionState, WorkspaceFile } from '../types';

const DEFAULT_COLOR = '#000000';
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

export function IDEApplication() {
  const [room, setRoom] = useState<Room | null>(null);
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [annotations, setAnnotations] = useState<AiAnnotation[]>([]);
  const [cursors, setCursors] = useState<Record<string, CursorMessage>>({});
  const [cursorPosition, setCursorPosition] = useState({ line: 1, col: 1 });
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => new Set());
  const [chatOpen, setChatOpen] = useState(true);
  const [explorerOpen, setExplorerOpen] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [pendingSwitch, setPendingSwitch] = useState<PendingSwitch | null>(null);
  const [uploadNotice, setUploadNotice] = useState('');
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [uploadDragging, setUploadDragging] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [pearMenuOpen, setPearMenuOpen] = useState(false);
  const [explorerCreateOpen, setExplorerCreateOpen] = useState(false);
  const [delegateOpen, setDelegateOpen] = useState(false);
  const [delegateUserId, setDelegateUserId] = useState('');
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileDraftName, setProfileDraftName] = useState('');
  const [createItemKind, setCreateItemKind] = useState<'file' | 'folder' | null>(null);
  const [createItemName, setCreateItemName] = useState('');
  const [createItemError, setCreateItemError] = useState('');
  const { ready: authReady, realtimeToken, signIn, signOut, updateProfile, user, userRef } = useAuthSession();
  const [connectionId] = useState(() => getOrCreateConnectionId());
  const [editorMountVersion, setEditorMountVersion] = useState(0);
  const [executionLanguage, setExecutionLanguage] = useState<ExecutionLanguage>('javascript');
  const addSystemMessageRef = useRef<(message: string) => void>(() => undefined);
  const {
    consoleHeight,
    consoleMaximumHeight,
    consoleResizing,
    editorStackRef,
    executionPanelOpen,
    handleConsoleResizeKeyDown,
    handleConsoleResizeStart,
    setConsoleHeight,
    setExecutionPanelOpen
  } = useConsoleLayout();

  const {
    activeFile,
    activeFileId,
    activeFileIdRef,
    applyTabState,
    closeFileTab,
    openFileIds,
    openFileIdsRef,
    openFiles,
    openFileTab,
    setActiveFileId
  } = useEditorTabs(files);
  const {
    handleConnected,
    handleHeartbeat,
    handleMemberEvent,
    leadUserId,
    leadUserIdRef,
    presenceMembers,
    publishLeftMemberEvent,
    publishMemberEvent,
    resetPresence,
    roomLocked,
    roomLockedRef,
    setRoomLocked
  } = useRoomPresence({
    addSystemMessage: (message) => addSystemMessageRef.current(message),
    connectionId,
    files,
    getClient: () => stompRef.current,
    onConnected: (client) => flushPendingUploadSyncs(client),
    onCursorLeft: (userId) => {
      setCursors((current) => {
        const next = { ...current };
        delete next[userId];
        return next;
      });
    },
    onRoomClosed: (notice) => {
      returnToLanding(notice);
      showToast(notice);
    },
    onSnapshot: (activeUserIds) => {
      setCursors((current) => Object.fromEntries(
        Object.entries(current).filter(([userId]) => activeUserIds.has(userId))
      ));
    },
    room,
    user,
    userRef
  });
  const activeProjectName = files.length > 0 ? projectNameForPaths(files.map((file) => file.path)) : 'Empty room';
  const humanMembers = uniqueMembers([user, ...Object.values(presenceMembers)]);
  const members = uniqueMembers([...humanMembers, { id: 'ai', name: 'AI', color: '#8B5CF6', ai: true }]);
  const mentionOptions = buildMentionOptions(members);
  const isLeadPear = leadUserId === user.id;
  const roleLabel = isLeadPear ? 'Lead Pear' : 'Junior Pear';
  const delegateCandidates = humanMembers.filter((member) => member.id !== user.id);
  const visibleMembers = members.slice(0, 4);
  const hiddenMemberCount = Math.max(0, members.length - visibleMembers.length);

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
  const activeFileRef = useRef<WorkspaceFile | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const contentSyncTimerRef = useRef<number | null>(null);
  const pendingContentSyncRef = useRef<{ fileId: string; content: string; updatedAt: string } | null>(null);
  const lastLocalEditAtRef = useRef(0);
  const seedingFileIdsRef = useRef<Set<string>>(new Set());
  const deletedFileIdsRef = useRef<Set<string>>(new Set());
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const {
    addSystemMessage,
    chatDraft,
    chatError,
    chatInputRef,
    insertMentionIntoDraft,
    messages,
    nowLabel,
    receiveChatMessage,
    resetRoomChat,
    sendChat,
    setChatDraft,
    setChatError
  } = useRoomChat({
    activeFile,
    cursorLine: cursorPosition.line,
    editorRef,
    mentionOptions,
    onMention: showToast,
    room,
    user
  });
  addSystemMessageRef.current = addSystemMessage;
  const {
    closeEntryProfile,
    confirmEntryProfile,
    creatingRoom,
    entryAvatarInputRef,
    entryProfileAvatar,
    entryProfileError,
    entryProfileName,
    entryProfileOpen,
    handleEntryAvatarInput,
    joiningRoom,
    landingCode,
    landingError,
    landingNotice,
    pendingRoomAction,
    requestRoomEntry,
    resetLanding,
    setEntryProfileName,
    setLandingCode,
    setLandingNotice
  } = useRoomEntry({ authReady, onOpenRoom: openRoom, onToast: showToast, signIn, user });
  const {
    clear: clearExecutionConsole,
    error: executionError,
    result: executionResult,
    run: submitActiveExecution,
    submitting: executionSubmitting
  } = useExecution(room && activeFile ? `${room.code}:${activeFile.id}` : null, room?.code ?? null);


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
        'editor.background': '#1a1c18',
        'editorGutter.background': '#1a1c18',
        'editorLineNumber.foreground': '#77796e',
        'editorCursor.foreground': '#58a6ff',
        'editor.selectionBackground': '#3d5261'
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
    if (folderInputRef.current) {
      configureFolderInput(folderInputRef.current);
    }
  }, []);

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
    onChat: (message) => receiveChatMessage(JSON.parse(message.body) as ChatMessage),
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
    onConnected: handleConnected,
    onHeartbeat: handleHeartbeat
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
      <IDEHeader
        hiddenMemberCount={hiddenMemberCount}
        humanMemberCount={humanMembers.length}
        isLead={isLeadPear}
        members={visibleMembers}
        onCloseRoom={runPearMenuAction(handleCloseRoom)}
        onCopyRoomCode={copyRoomCode}
        onLeaveRoom={runPearMenuAction(handleLeaveRoom)}
        onOpenProfile={() => openProfileEditor(user)}
        onReturnToLanding={() => returnToLanding()}
        onSignOut={runPearMenuAction(() => void handleSignOut())}
        onToggleMenu={() => setPearMenuOpen((current) => !current)}
        onToggleRoomLock={runPearMenuAction(handleToggleRoomLock)}
        pearMenuOpen={pearMenuOpen}
        roleLabel={roleLabel}
        roomCode={room.code}
        roomLocked={roomLocked}
        user={user}
      />

      <section className={workspaceClass}>
        <ExplorerPanel
          activeFileId={activeFile?.id ?? ''}
          activeProjectName={activeProjectName}
          createMenuOpen={explorerCreateOpen}
          expandedFolders={expandedFolders}
          fileInputRef={fileInputRef}
          files={files}
          folderInputRef={folderInputRef}
          onCreateMenuChange={setExplorerCreateOpen}
          onDeletePath={deleteTreePath}
          onDownload={exportWorkspace}
          onFileSelect={openFileTab}
          onFolderUploadInput={(input) => void handleUploadInput(input, true)}
          onHide={() => setExplorerOpen(false)}
          onNewFile={() => void handleNewFile()}
          onNewFolder={() => void handleNewFolder()}
          onOpenFilePicker={openFilePicker}
          onOpenFolderPicker={openFolderPicker}
          onShow={() => setExplorerOpen(true)}
          onToggleFolder={toggleFolder}
          onUploadDrop={(event) => void handleUploadDrop(event)}
          onUploadInput={(input) => void handleUploadInput(input, false)}
          onUploadNoticeChange={setUploadNotice}
          onUploadDraggingChange={setUploadDragging}
          open={explorerOpen}
          uploadDragging={uploadDragging}
          uploadModalOpen={uploadModalOpen}
          uploadNotice={uploadNotice}
        />

        <EditorWorkspace
          activeFile={activeFile}
          consoleHeight={consoleHeight}
          consoleMaximumHeight={consoleMaximumHeight()}
          consoleMinimumHeight={MIN_CONSOLE_HEIGHT}
          consoleOpen={executionPanelOpen}
          consoleResizing={consoleResizing}
          editorStackRef={editorStackRef}
          executionError={executionError}
          executionLanguage={executionLanguage}
          executionResult={executionResult}
          executionSubmitting={executionSubmitting}
          onActiveFileChange={setActiveFileId}
          onClearConsole={clearExecutionConsole}
          onCloseFile={closeFileTab}
          onConsoleHeightChange={setConsoleHeight}
          onConsoleResizeKeyDown={handleConsoleResizeKeyDown}
          onConsoleResizeStart={handleConsoleResizeStart}
          onEditorMount={handleEditorMount}
          onLanguageChange={setExecutionLanguage}
          onOpenUpload={openUploadModal}
          onRun={() => void runActiveFile()}
          onToggleConsole={() => setExecutionPanelOpen((current) => !current)}
          openFiles={openFiles}
        />

        {chatOpen ? (
          <ChatPanel
            draft={chatDraft}
            error={chatError}
            inputRef={chatInputRef}
            mentionOptions={mentionOptions}
            messages={messages}
            nowLabel={nowLabel}
            onClose={() => setChatOpen(false)}
            onDraftChange={(value) => {
              setChatDraft(value);
              setChatError('');
            }}
            onSend={() => sendChat(stompClient)}
            renderContent={(message) => renderMessageContent(message.content, mentionOptions, insertMentionIntoDraft)}
            user={user}
            messageMentionsUser={(message) => messageMentionsUser(message.content, user, mentionOptions)}
          />
        ) : (
          <aside className="chat-rail">
            <button aria-controls="room-chat" aria-expanded="false" aria-label="Show room chat" className="panel-rail-button" onClick={() => setChatOpen(true)} title="Show room chat" type="button">
              <PanelRightOpen size={18} />
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
        <ProfileMenu
          draftName={profileDraftName}
          onClose={() => setProfileOpen(false)}
          onDraftNameChange={setProfileDraftName}
          onSave={() => void saveProfile()}
          roleLabel={roleLabel}
          user={user}
        />
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


  function openRoom(nextRoom: Room, nextFiles: WorkspaceFile[], replaceUrl: boolean, restoredState?: RoomSessionState) {
    const sortedFiles = nextFiles.sort(sortByPath);
    const tabState = restoreEditorTabs(sortedFiles, restoredState?.openFileIds, restoredState?.activeFileId);
    filesRef.current = sortedFiles;
    deletedFileIdsRef.current.clear();
    setRoom(nextRoom);
    setFiles(sortedFiles);
    applyTabState(tabState);
    setExpandedFolders(restoredState ? new Set(restoredState.expandedFolderPaths) : foldersForPaths(sortedFiles.map((file) => file.path)));
    resetRoomChat(restoredState?.chatDraft ?? '');
    setAnnotations([]);
    setCursors({});
    resetPresence(nextRoom);
    setPearMenuOpen(false);
    setExplorerOpen(restoredState?.explorerOpen ?? true);
    setChatOpen(restoredState?.chatOpen ?? true);
    setDelegateOpen(false);
    setDelegateUserId('');
    setUploadNotice('');
    setLandingCode(restoredState?.landingCode ?? nextRoom.code);
    setLandingNotice('');
    setCursorPosition(restoredState?.cursorPosition ?? { line: 1, col: 1 });
    setSaveState(sortedFiles.length > 0 ? 'saved' : 'idle');
    setLastSavedAt(null);
    clearExecutionConsole();
    if (replaceUrl) {
      window.history.replaceState(null, '', `/join/${nextRoom.code}`);
    }
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
      stdin: ''
    }));
  }



  function copyRoomCode() {
    const currentRoom = roomRef.current;
    if (currentRoom) {
      void navigator.clipboard.writeText(currentRoom.code)
        .then(() => showToast('Room code copied'))
        .catch(() => showToast(`Room code: ${currentRoom.code}`));
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

  function returnToLanding(notice = '') {
    clearExecutionConsole();
    if (contentSyncTimerRef.current) {
      window.clearTimeout(contentSyncTimerRef.current);
      contentSyncTimerRef.current = null;
    }
    pendingContentSyncRef.current = null;
    setRoom(null);
    setFiles([]);
    applyTabState({ activeFileId: null, openFileIds: [] });
    resetRoomChat();
    setAnnotations([]);
    setCursors({});
    resetPresence();
    setPearMenuOpen(false);
    setExplorerOpen(true);
    setChatOpen(true);
    setDelegateOpen(false);
    setDelegateUserId('');
    setPendingSwitch(null);
    setUploadNotice('');
    setSaveState('idle');
    setLastSavedAt(null);
    resetLanding(notice);
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
    const safeUploaded = filterTombstonedFileUpdates(uploaded, deletedFileIdsRef.current);
    const next = (replaceExisting ? safeUploaded : mergeFiles(filesRef.current, safeUploaded)).sort(sortByPath);
    if (replaceExisting) {
      const nextIds = new Set(next.map((file) => file.id));
      for (const currentFile of filesRef.current) {
        if (!nextIds.has(currentFile.id)) {
          deletedFileIdsRef.current.add(currentFile.id);
        }
      }
    }
    const tabState = reconcileEditorTabs({
      currentActiveFileId: activeFileIdRef.current,
      currentOpenFileIds: openFileIdsRef.current,
      nextFiles: next,
      openUploaded,
      replaceExisting,
      uploadedFiles: safeUploaded
    });
    filesRef.current = next;
    setFiles(next);
    applyTabState(tabState);
    setExpandedFolders(foldersForPaths(next.map((file) => file.path)));
    return next;
  }

  function applyRemoteFileContentUpdates(incomingFiles: WorkspaceFile[]) {
    const safeIncomingFiles = filterTombstonedFileUpdates(incomingFiles, deletedFileIdsRef.current);
    if (safeIncomingFiles.length === 0) {
      return;
    }

    const incomingById = new Map(safeIncomingFiles.map((file) => [file.id, file]));
    const incomingByPath = new Map(safeIncomingFiles.map((file) => [file.path, file]));
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
    for (const incoming of safeIncomingFiles) {
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

  async function deleteTreePath(path: string, kind: 'file' | 'folder') {
    const currentFiles = filesRef.current;
    const deletion = removeTreePath(currentFiles, path, kind);
    if (deletion.removed.length === 0) {
      return;
    }

    const detail = kind === 'folder'
      ? `folder "${path}" and ${deletion.removed.length} ${deletion.removed.length === 1 ? 'file' : 'files'}`
      : `file "${path}"`;
    if (!window.confirm(`Delete ${detail} from this room? This cannot be undone.`)) {
      return;
    }

    const currentRoom = roomRef.current;
    setSaveState('saving');
    try {
      const persisted = currentRoom && currentRoom.code !== FALLBACK_ROOM.code
        ? await saveRoomFiles(currentRoom.code, deletion.files)
        : deletion.files;
      deletion.removed.forEach((file) => deletedFileIdsRef.current.add(file.id));
      const next = applyUploadedFiles(persisted, true, false);
      queueOrPublishProjectSwitch(createFileTreeEvent(next, true, false));
      setSaveState('saved');
      setLastSavedAt(new Date().toISOString());
      showToast(`${kind === 'folder' ? 'Folder' : 'File'} deleted: ${path}`);
    } catch (error) {
      console.warn('Workspace deletion failed', { kind, path, roomCode: currentRoom?.code, error });
      setSaveState('error');
      showToast(`Could not delete ${kind} "${path}". Your files were not changed.`);
    }
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
    setProfileOpen(true);
  }

  async function saveProfile() {
    try {
      await updateProfile(profileDraftName.trim() || user.name, user.avatarUrl);
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



function upsertAnnotation(current: AiAnnotation[], annotation: AiAnnotation) {
  return [...current.filter((item) => item.id !== annotation.id), annotation];
}
