import Editor, { type OnMount } from '@monaco-editor/react';
import { Braces, FolderPlus, Upload, UsersRound, X } from 'lucide-react';
import type { KeyboardEvent, PointerEvent as ReactPointerEvent, RefObject } from 'react';
import { languageClass, type ExecutionLanguage } from '../../language';
import type { ExecutionResult, WorkspaceFile } from '../../types';
import { ExecutionConsole } from '../execution/ExecutionConsole';
import { ExecutionToolbar } from '../execution/ExecutionToolbar';

type EditorWorkspaceProps = {
  activeFile: WorkspaceFile | null;
  consoleHeight: number;
  consoleMaximumHeight: number;
  consoleMinimumHeight: number;
  consoleOpen: boolean;
  consoleResizing: boolean;
  editorStackRef: RefObject<HTMLDivElement>;
  executionError: string;
  executionLanguage: ExecutionLanguage;
  executionResult: ExecutionResult | null;
  executionSubmitting: boolean;
  onActiveFileChange: (fileId: string) => void;
  onClearConsole: () => void;
  onCloseFile: (fileId: string) => void;
  onConsoleHeightChange: (height: number) => void;
  onConsoleResizeKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  onConsoleResizeStart: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onEditorMount: OnMount;
  onLanguageChange: (language: ExecutionLanguage) => void;
  onOpenUpload: () => void;
  onRun: () => void;
  onToggleConsole: () => void;
  openFiles: WorkspaceFile[];
};

export function EditorWorkspace({
  activeFile,
  consoleHeight,
  consoleMaximumHeight,
  consoleMinimumHeight,
  consoleOpen,
  consoleResizing,
  editorStackRef,
  executionError,
  executionLanguage,
  executionResult,
  executionSubmitting,
  onActiveFileChange,
  onClearConsole,
  onCloseFile,
  onConsoleHeightChange,
  onConsoleResizeKeyDown,
  onConsoleResizeStart,
  onEditorMount,
  onLanguageChange,
  onOpenUpload,
  onRun,
  onToggleConsole,
  openFiles
}: EditorWorkspaceProps) {
  return (
    <section className={`editor-area ${consoleResizing ? 'console-resizing' : ''}`}>
      <ExecutionToolbar
        activeFile={Boolean(activeFile)}
        consoleOpen={consoleOpen}
        language={executionLanguage}
        onLanguageChange={onLanguageChange}
        onRun={onRun}
        onToggleConsole={onToggleConsole}
        submitting={executionSubmitting}
      />
      <EditorTabs activeFileId={activeFile?.id ?? null} files={openFiles} onActivate={onActiveFileChange} onClose={onCloseFile} />
      <div className="editor-stack" ref={editorStackRef}>
        <div className="editor-frame">
          {activeFile ? (
            <Editor
              height="100%"
              language={activeFile.language}
              onMount={onEditorMount}
              options={{
                automaticLayout: true,
                fontFamily: 'JetBrains Mono, Consolas, monospace',
                fontSize: 14,
                lineHeight: 22,
                minimap: { enabled: false },
                padding: { top: 14, bottom: 14 },
                scrollbar: { horizontalScrollbarSize: 10, verticalScrollbarSize: 10 },
                scrollBeyondLastLine: false,
                tabSize: 2
              }}
              path={activeFile.path}
              theme="pear-github-dark"
              defaultValue={activeFile.content}
            />
          ) : (
            <EmptyEditorState onOpenUpload={onOpenUpload} />
          )}
        </div>
        <div
          aria-hidden={!consoleOpen}
          className={`console-region ${consoleOpen ? '' : 'console-region-collapsed'}`}
          style={{ flexBasis: consoleOpen ? `${consoleHeight}px` : '0px' }}
        >
          <div
            aria-controls="execution-console"
            aria-label="Resize console"
            aria-orientation="horizontal"
            aria-valuemax={consoleMaximumHeight}
            aria-valuemin={consoleMinimumHeight}
            aria-valuenow={Math.min(consoleHeight, consoleMaximumHeight)}
            className="console-resize-handle"
            onDoubleClick={() => onConsoleHeightChange(250)}
            onKeyDown={onConsoleResizeKeyDown}
            onPointerDown={onConsoleResizeStart}
            role="separator"
            tabIndex={consoleOpen ? 0 : -1}
            title="Drag to resize console; double-click to reset"
          >
            <span />
          </div>
          <ExecutionConsole
            error={executionError}
            onClear={onClearConsole}
            onRerun={onRun}
            result={executionResult}
            submitting={executionSubmitting}
          />
        </div>
      </div>
    </section>
  );
}

type EditorTabsProps = {
  activeFileId: string | null;
  files: WorkspaceFile[];
  onActivate: (fileId: string) => void;
  onClose: (fileId: string) => void;
};

export function EditorTabs({ activeFileId, files, onActivate, onClose }: EditorTabsProps) {
  return (
    <div className="tabs">
      {files.map((file) => (
        <div className={`tab ${file.id === activeFileId ? 'tab-active' : ''}`} key={file.id}>
          <button className="tab-main" onClick={() => onActivate(file.id)} title={file.path} type="button">
            <span className={`language-dot ${languageClass(file.language)}`} />
            <span>{basename(file.path)}</span>
          </button>
          <button className="tab-close" onClick={() => onClose(file.id)} title={`Close ${basename(file.path)}`} type="button">
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}

export function EmptyEditorState({ onOpenUpload }: { onOpenUpload: () => void }) {
  return (
    <div className="empty-editor">
      <div className="empty-editor-content">
        <div aria-hidden="true" className="empty-editor-sketch">
          <div className="empty-sketch-window">
            <div className="empty-sketch-window-bar"><span /><span /><span /><em>shared-room.js</em></div>
            <div className="empty-sketch-code">
              <span><i>1</i><code>const room = <strong>'together'</strong>;</code></span>
              <span><i>2</i><code>shareIdeas(room);</code></span>
              <span><i>3</i><code>grow(<strong>'side by side'</strong>);</code></span>
            </div>
          </div>
          <div className="empty-sketch-caption"><Braces size={17} /><span>Pair-ready workspace</span><UsersRound size={17} /></div>
        </div>
        <h1>Upload files or a project folder to start coding together.</h1>
        <p>Your shared file tree will appear here after uploading.</p>
        <div className="empty-editor-actions">
          <button onClick={onOpenUpload} type="button"><Upload size={16} />Upload Files</button>
          <button onClick={onOpenUpload} type="button"><FolderPlus size={16} />Upload Folder</button>
        </div>
      </div>
    </div>
  );
}

function basename(path: string) {
  const parts = path.split('/');
  return parts[parts.length - 1] || path;
}
