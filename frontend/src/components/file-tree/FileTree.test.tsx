import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceFile } from '../../types';
import { FileTree } from './FileTree';

function file(id: string, path: string): WorkspaceFile {
  return {
    id, path, workspaceId: 'workspace-1', language: 'typescript', content: '',
    createdAt: '2026-07-12T00:00:00Z', updatedAt: '2026-07-12T00:00:00Z'
  };
}

describe('FileTree', () => {
  it('preserves nested paths and selects the requested file', () => {
    const onFileSelect = vi.fn();
    render(<FileTree activeFileId="two" expandedFolders={new Set(['src'])}
      files={[file('one', 'README.md'), file('two', 'src/App.tsx')]}
      onDeletePath={() => undefined} onFileSelect={onFileSelect} onToggleFolder={() => undefined} />);

    expect(screen.getByText('src')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('treeitem', { name: 'App.tsx' }));
    expect(onFileSelect).toHaveBeenCalledWith('two');
  });

  it('moves through visible tree items with arrow keys', () => {
    render(<FileTree activeFileId="" expandedFolders={new Set()}
      files={[file('one', 'README.md'), file('two', 'utils.ts')]}
      onDeletePath={() => undefined} onFileSelect={() => undefined} onToggleFolder={() => undefined} />);

    const readme = screen.getByRole('treeitem', { name: 'README.md' });
    const utils = screen.getByRole('treeitem', { name: 'utils.ts' });
    readme.focus();
    fireEvent.keyDown(readme, { key: 'ArrowDown' });
    expect(utils).toHaveFocus();
    fireEvent.keyDown(utils, { key: 'ArrowUp' });
    expect(readme).toHaveFocus();
  });
});
