import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import * as Y from 'yjs';
import { MonacoBinding } from 'y-monaco';
import { WebsocketProvider } from 'y-websocket';
import type { Member, WorkspaceFile } from '../types';

type CollaborativeDocumentOptions = {
  editor: MutableRefObject<unknown>;
  editorMountVersion: number;
  file: WorkspaceFile | null;
  filesRef: MutableRefObject<WorkspaceFile[]>;
  onFilesChange: (updater: (files: WorkspaceFile[]) => WorkspaceFile[]) => void;
  realtimeToken: string;
  roomCode: string | null;
  suppressEditorChange: MutableRefObject<boolean>;
  user: Member;
  yjsUrl: string;
};

export function useCollaborativeDocument({
  editor: editorRef,
  editorMountVersion,
  file,
  filesRef,
  onFilesChange,
  realtimeToken,
  roomCode,
  suppressEditorChange,
  user,
  yjsUrl
}: CollaborativeDocumentOptions) {
  const [syncStatus, setSyncStatus] = useState('Yjs offline');
  const [peerCount, setPeerCount] = useState(1);
  const bindingRef = useRef<MonacoBinding | null>(null);
  const providerRef = useRef<WebsocketProvider | null>(null);
  const ydocRef = useRef<Y.Doc | null>(null);

  useEffect(() => {
    const editor = editorRef.current as any;
    if (!editor || !roomCode || !file) {
      return;
    }

    bindingRef.current?.destroy();
    providerRef.current?.destroy();
    ydocRef.current?.destroy();
    bindingRef.current = null;
    providerRef.current = null;
    ydocRef.current = null;

    const model = editor.getModel();
    if (!model) {
      return;
    }

    let disposed = false;
    const suppressionTimers: number[] = [];
    const releaseSuppressionSoon = () => {
      suppressionTimers.push(window.setTimeout(() => {
        if (!disposed) {
          suppressEditorChange.current = false;
        }
      }, 0));
    };
    suppressEditorChange.current = true;
    if (model.getValue() !== file.content) {
      model.setValue(file.content);
    }
    releaseSuppressionSoon();

    if (!yjsUrl) {
      setSyncStatus('Yjs offline');
      setPeerCount(1);
      return () => cleanupSuppression();
    }
    if (!realtimeToken) {
      setSyncStatus('Authentication required');
      return () => cleanupSuppression();
    }

    const ydoc = new Y.Doc();
    const provider = new WebsocketProvider(yjsUrl, `${roomCode}/${file.id}`, ydoc, {
      params: { access_token: realtimeToken }
    });
    const yText = ydoc.getText('monaco');
    const yMeta = ydoc.getMap('meta');
    const shouldSeedLocalText = roomCode === 'LOCAL1' || !isUuid(file.id);
    if (shouldSeedLocalText && !yMeta.get('initialized')) {
      ydoc.transact(() => {
        if (yText.length === 0 && file.content) {
          yText.insert(0, file.content);
        }
        yMeta.set('initialized', true);
      }, 'pear-local-seed');
    }

    let binding: MonacoBinding | null = null;
    const syncFileStateFromModel = () => {
      const content = model.getValue();
      const current = filesRef.current.find((item) => item.id === file.id);
      if (!current || current.content === content) {
        return;
      }
      const updatedAt = new Date().toISOString();
      filesRef.current = filesRef.current.map((item) => item.id === file.id ? { ...item, content, updatedAt } : item);
      onFilesChange((items) => items.map((item) => item.id === file.id ? { ...item, content, updatedAt } : item));
    };
    const attachBinding = () => {
      if (disposed || binding) {
        return;
      }
      if (!yMeta.get('initialized')) {
        const seedContent = model.getValue();
        ydoc.transact(() => {
          if (yText.length === 0 && seedContent) {
            yText.insert(0, seedContent);
          }
          yMeta.set('initialized', true);
        }, 'pear-synced-seed');
      }
      suppressEditorChange.current = true;
      binding = new MonacoBinding(yText, model, new Set([editor]), provider.awareness);
      bindingRef.current = binding;
      syncFileStateFromModel();
      releaseSuppressionSoon();
      setSyncStatus('Yjs synced');
    };

    provider.awareness.setLocalStateField('user', { name: user.name, color: user.color, avatarUrl: user.avatarUrl });
    const handleStatus = ({ status }: { status: string }) => setSyncStatus(status === 'connected' ? (binding ? 'Yjs synced' : 'Yjs syncing') : 'Yjs reconnecting');
    const handleSync = (synced: boolean) => {
      if (synced) attachBinding();
    };
    const updatePeerCount = () => setPeerCount(provider.awareness.getStates().size);
    provider.on('status', handleStatus);
    provider.on('sync', handleSync);
    provider.awareness.on('change', updatePeerCount);
    providerRef.current = provider;
    ydocRef.current = ydoc;
    setSyncStatus('Yjs connecting');
    updatePeerCount();
    if ((provider as unknown as { synced?: boolean }).synced) {
      attachBinding();
    }

    return () => {
      cleanupSuppression();
      provider.off('status', handleStatus);
      provider.off('sync', handleSync);
      provider.awareness.off('change', updatePeerCount);
      binding?.destroy();
      provider.destroy();
      ydoc.destroy();
      if (bindingRef.current === binding) bindingRef.current = null;
      if (providerRef.current === provider) providerRef.current = null;
      if (ydocRef.current === ydoc) ydocRef.current = null;
    };

    function cleanupSuppression() {
      disposed = true;
      suppressionTimers.forEach((timer) => window.clearTimeout(timer));
      suppressEditorChange.current = false;
    }
  }, [editorMountVersion, file?.id, onFilesChange, realtimeToken, roomCode, user.avatarUrl, user.color, user.id, user.name, yjsUrl]);

  return { peerCount, syncStatus };
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
