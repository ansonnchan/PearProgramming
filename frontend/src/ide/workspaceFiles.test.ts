import { describe, expect, it } from 'vitest';
import type { WorkspaceFile } from '../types';
import { foldersForPaths, mergeFiles, resolveCreateItemTarget } from './workspaceFiles';

const file = (id: string, path: string, content = ''): WorkspaceFile => ({
  id, path, content, workspaceId: 'workspace-1', language: 'typescript',
  createdAt: '2026-07-15T00:00:00Z', updatedAt: '2026-07-15T00:00:00Z'
});

describe('workspace file helpers', () => {
  it('creates stable unique paths without flattening folders', () => {
    expect(resolveCreateItemTarget('file', 'App.tsx', ['App.tsx'])).toEqual({ path: 'App-2.tsx' });
    expect(resolveCreateItemTarget('folder', 'src', ['src/App.tsx'])).toEqual({ path: 'src-2' });
    expect(foldersForPaths(['src/components/App.tsx'])).toEqual(new Set(['src', 'src/components']));
  });

  it('lets incoming collaborative files replace the same path', () => {
    expect(mergeFiles([file('old', 'App.tsx', 'old')], [file('new', 'App.tsx', 'new')]))
      .toEqual([file('new', 'App.tsx', 'new')]);
  });
});
