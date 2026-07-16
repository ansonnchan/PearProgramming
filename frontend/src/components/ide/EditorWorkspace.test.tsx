import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EXECUTION_LANGUAGES } from '../../language';
import { EditorWorkspace } from './EditorWorkspace';

vi.mock('@monaco-editor/react', () => ({
  default: ({ options }: { options: { fixedOverflowWidgets?: boolean; suggestLineHeight?: number } }) => (
    <div
      data-fixed-overflow-widgets={String(options.fixedOverflowWidgets)}
      data-suggest-line-height={String(options.suggestLineHeight)}
      data-testid="monaco-editor"
    />
  )
}));

const activeFile = {
  id: 'file-1',
  workspaceId: 'workspace-1',
  path: 'src/index.ts',
  language: 'typescript',
  content: 'export {};',
  createdAt: '2026-07-15T00:00:00Z',
  updatedAt: '2026-07-15T00:00:00Z'
};

const props = {
  activeFile,
  consoleHeight: 250,
  consoleMaximumHeight: 520,
  consoleMinimumHeight: 160,
  consoleOpen: true,
  consoleResizing: false,
  editorStackRef: createRef<HTMLDivElement>(),
  executionError: '',
  executionLanguage: 'javascript' as const,
  executionLanguages: EXECUTION_LANGUAGES,
  executionResult: null,
  executionSubmitting: false,
  onActiveFileChange: vi.fn(),
  onClearConsole: vi.fn(),
  onCloseFile: vi.fn(),
  onConsoleHeightChange: vi.fn(),
  onConsoleResizeKeyDown: vi.fn(),
  onConsoleResizeStart: vi.fn(),
  onEditorMount: vi.fn(),
  onLanguageChange: vi.fn(),
  onOpenUpload: vi.fn(),
  onRun: vi.fn(),
  onToggleConsole: vi.fn(),
  openFiles: [activeFile]
};

describe('EditorWorkspace', () => {
  it('allows Monaco widgets to escape the editor scroll surface', () => {
    const { container } = render(<EditorWorkspace {...props} consoleHeight={700} />);
    expect(screen.getByTestId('monaco-editor')).toHaveAttribute('data-fixed-overflow-widgets', 'true');
    expect(screen.getByTestId('monaco-editor')).toHaveAttribute('data-suggest-line-height', '28');
    expect(container.querySelector('.console-region')).toHaveStyle({ flexBasis: '520px' });
  });

  it('collapses the console region without removing the editor', () => {
    const { container } = render(<EditorWorkspace {...props} consoleOpen={false} />);
    expect(screen.getByTestId('monaco-editor')).toBeInTheDocument();
    expect(container.querySelector('.console-region')).toHaveClass('console-region-collapsed');
    expect(screen.getByRole('separator', { hidden: true })).toHaveAttribute('tabindex', '-1');
  });
});
