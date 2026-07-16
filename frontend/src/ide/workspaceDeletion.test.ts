import { describe, expect, it } from 'vitest';
import type { WorkspaceFile } from '../types';
import { reconcileEditorTabs } from './useEditorTabs';
import { filterTombstonedFileUpdates, removeTreePath } from './workspaceFiles';

const file = (id: string, path = `${id}.ts`): WorkspaceFile => ({
  id,
  path,
  workspaceId: 'workspace-1',
  language: 'typescript',
  content: '',
  createdAt: '2026-07-15T00:00:00Z',
  updatedAt: '2026-07-15T00:00:00Z'
});

function reconcileAfterDeletion(currentOpenFileIds: string[], currentActiveFileId: string | null, nextFiles: WorkspaceFile[]) {
  return reconcileEditorTabs({
    currentActiveFileId,
    currentOpenFileIds,
    nextFiles,
    openUploaded: false,
    replaceExisting: true,
    uploadedFiles: nextFiles
  });
}

describe('workspace deletion', () => {
  it('deletes a closed file without changing the active tab', () => {
    const deletion = removeTreePath([file('one'), file('two')], 'two.ts', 'file');
    expect(deletion.removed.map((item) => item.id)).toEqual(['two']);
    expect(reconcileAfterDeletion(['one'], 'one', deletion.files)).toEqual({
      activeFileId: 'one',
      openFileIds: ['one']
    });
  });

  it('selects the next open tab after deleting the active file', () => {
    const deletion = removeTreePath([file('one'), file('two'), file('three')], 'two.ts', 'file');
    expect(reconcileAfterDeletion(['one', 'two', 'three'], 'two', deletion.files)).toEqual({
      activeFileId: 'three',
      openFileIds: ['one', 'three']
    });
  });

  it('handles deleting the final file', () => {
    const deletion = removeTreePath([file('only')], 'only.ts', 'file');
    expect(deletion.files).toEqual([]);
    expect(reconcileAfterDeletion(['only'], 'only', deletion.files)).toEqual({ activeFileId: null, openFileIds: [] });
  });

  it('reconciles a remote deletion and blocks a delayed content update from resurrecting it', () => {
    const remaining = [file('one')];
    expect(reconcileAfterDeletion(['one', 'two'], 'two', remaining)).toEqual({
      activeFileId: 'one',
      openFileIds: ['one']
    });
    expect(filterTombstonedFileUpdates([file('two')], new Set(['two']))).toEqual([]);
  });

  it('deletes every file nested under a folder', () => {
    const deletion = removeTreePath(
      [file('one', 'src/one.ts'), file('two', 'src/nested/two.ts'), file('three', 'README.md')],
      'src',
      'folder'
    );
    expect(deletion.removed.map((item) => item.id)).toEqual(['one', 'two']);
    expect(deletion.files.map((item) => item.id)).toEqual(['three']);
  });
});
