import { describe, expect, it } from 'vitest';
import type { WorkspaceFile } from '../types';
import { reconcileEditorTabs, restoreEditorTabs } from './useEditorTabs';

const file = (id: string): WorkspaceFile => ({
  id,
  workspaceId: 'workspace-1',
  path: `${id}.ts`,
  language: 'typescript',
  content: '',
  createdAt: '2026-07-15T00:00:00Z',
  updatedAt: '2026-07-15T00:00:00Z'
});

describe('editor tab reconciliation', () => {
  it('keeps the active tab when the file tree still contains it', () => {
    expect(reconcileEditorTabs({
      currentActiveFileId: 'two',
      currentOpenFileIds: ['one', 'two'],
      nextFiles: [file('one'), file('two')],
      openUploaded: false,
      replaceExisting: true,
      uploadedFiles: [file('one'), file('two')]
    })).toEqual({ activeFileId: 'two', openFileIds: ['one', 'two'] });
  });

  it('chooses the next retained tab when the active file disappears', () => {
    expect(reconcileEditorTabs({
      currentActiveFileId: 'two',
      currentOpenFileIds: ['one', 'two', 'three'],
      nextFiles: [file('one'), file('three')],
      openUploaded: false,
      replaceExisting: true,
      uploadedFiles: [file('one'), file('three')]
    })).toEqual({ activeFileId: 'one', openFileIds: ['one', 'three'] });
  });

  it('handles restoring an empty workspace', () => {
    expect(restoreEditorTabs([], ['deleted'], 'deleted')).toEqual({ activeFileId: null, openFileIds: [] });
  });
});
