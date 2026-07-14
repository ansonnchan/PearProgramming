import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ExecutionToolbar } from './ExecutionToolbar';

const props = {
  activeFile: true,
  consoleOpen: true,
  language: 'javascript' as const,
  onLanguageChange: vi.fn(),
  onRun: vi.fn(),
  onToggleConsole: vi.fn(),
  submitting: false
};

describe('ExecutionToolbar', () => {
  it('runs through a keyboard-accessible button and disables controls during submission', () => {
    const onRun = vi.fn();
    const { rerender } = render(<ExecutionToolbar {...props} onRun={onRun} />);
    const runButton = screen.getByRole('button', { name: 'Run' });

    fireEvent.click(runButton);
    expect(onRun).toHaveBeenCalledOnce();

    rerender(<ExecutionToolbar {...props} onRun={onRun} submitting />);
    expect(screen.getByRole('button', { name: 'Submitting…' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Language' })).toBeDisabled();
  });

  it('disables Run without an active file and exposes language and console controls', () => {
    const onLanguageChange = vi.fn();
    const onToggleConsole = vi.fn();
    const { rerender } = render(<ExecutionToolbar {...props} activeFile={false}
      onLanguageChange={onLanguageChange} onToggleConsole={onToggleConsole} />);

    expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled();
    fireEvent.change(screen.getByRole('combobox', { name: 'Language' }), { target: { value: 'java' } });
    expect(onLanguageChange).toHaveBeenCalledWith('java');
    fireEvent.click(screen.getByRole('button', { name: 'Hide console' }));
    expect(onToggleConsole).toHaveBeenCalledOnce();

    rerender(<ExecutionToolbar {...props} language="java" />);
    expect(screen.getByText('Java entry class: Main')).toBeInTheDocument();
  });
});
