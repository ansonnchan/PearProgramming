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
    fireEvent.click(screen.getByRole('button', { name: 'App.tsx' }));
    expect(onFileSelect).toHaveBeenCalledWith('two');
  });
});
