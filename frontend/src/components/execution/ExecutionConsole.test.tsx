import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ExecutionResult, ExecutionStatus } from '../../types';
import { ExecutionConsole } from './ExecutionConsole';

function execution(status: ExecutionStatus, overrides: Partial<ExecutionResult> = {}): ExecutionResult {
  return {
    executionId: 'execution-1',
    status,
    stdout: null,
    stderr: null,
    compileOutput: null,
    exitCode: null,
    durationMs: null,
    message: null,
    createdAt: '2026-07-12T00:00:00Z',
    completedAt: null,
    ...overrides
  };
}

const requiredProps = {
  error: '',
  onClear: () => undefined,
  onRerun: () => undefined,
  onStdinChange: () => undefined,
  stdin: '',
  submitting: false
};

describe('ExecutionConsole', () => {
  it('renders queued and running states as live progress', () => {
    const { rerender } = render(<ExecutionConsole {...requiredProps} result={execution('QUEUED')} />);
    expect(screen.getByText('Queued…')).toBeInTheDocument();
    expect(screen.getByText('Queued', { selector: '.execution-status' })).toBeInTheDocument();
    expect(document.querySelector('.execution-output')).toHaveAttribute('aria-busy', 'true');

    rerender(<ExecutionConsole {...requiredProps} result={execution('RUNNING')} />);
    expect(screen.getByText('Running…')).toBeInTheDocument();
    expect(document.querySelector('.execution-output')).toHaveAttribute('aria-busy', 'true');
  });

  it('renders output as text and preserves whitespace', () => {
    const { container } = render(<ExecutionConsole {...requiredProps} result={execution('COMPLETED', {
      stdout: '<b>safe</b>\n  indented', exitCode: 0, durationMs: 8,
      completedAt: '2026-07-12T00:00:01Z'
    })} />);

    expect(container.querySelector('pre')).toHaveTextContent('<b>safe</b>\n  indented', { normalizeWhitespace: false });
    expect(document.querySelector('b')).toBeNull();
    expect(screen.getByText('8 ms')).toBeInTheDocument();
    expect(screen.getByText('Process exited with code 0')).toBeInTheDocument();
  });

  it('distinguishes compilation errors, runtime errors, and stderr', () => {
    const { rerender } = render(<ExecutionConsole {...requiredProps} result={execution('COMPILATION_ERROR', {
      compileOutput: 'Main.java:1: error'
    })} />);
    expect(screen.getAllByText('Compilation error')).toHaveLength(2);
    expect(screen.getByText('Main.java:1: error')).toBeInTheDocument();

    rerender(<ExecutionConsole {...requiredProps} result={execution('RUNTIME_ERROR', { stderr: 'NullPointerException' })} />);
    expect(screen.getAllByText('Runtime error')).toHaveLength(2);
    expect(screen.getByText('NullPointerException')).toBeInTheDocument();

    rerender(<ExecutionConsole {...requiredProps} result={execution('COMPLETED', { stderr: 'warning' })} />);
    expect(screen.getByText('Standard error')).toBeInTheDocument();
  });

  it('renders timeouts and provider failures without raw provider payloads', () => {
    const { rerender } = render(<ExecutionConsole {...requiredProps} result={execution('TIMED_OUT', {
      message: 'Execution exceeded the configured deadline.'
    })} />);
    expect(screen.getAllByText('Timed out')).toHaveLength(2);

    rerender(<ExecutionConsole {...requiredProps} error="Could not submit this execution." result={null} />);
    expect(screen.getByText('Request failed')).toBeInTheDocument();
    expect(screen.getByText('Could not submit this execution.')).toBeInTheDocument();
    expect(screen.queryByText(/Judge0|provider token|internal host/i)).not.toBeInTheDocument();
  });

  it.each([
    ['COMPILATION_ERROR', 'Compilation failed without diagnostic output.'],
    ['RUNTIME_ERROR', 'The program failed at runtime without diagnostic output.'],
    ['TIMED_OUT', 'Execution exceeded the configured time limit.'],
    ['FAILED', 'The execution service could not complete this run.'],
    ['CANCELLED', 'This execution was cancelled.']
  ] as const)('shows a useful fallback for %s without provider output', (status, message) => {
    render(<ExecutionConsole {...requiredProps} result={execution(status)} />);
    expect(screen.getByText(message)).toBeInTheDocument();
  });

  it('supports editing stdin, rerunning, and clearing through explicit buttons', () => {
    const onClear = vi.fn();
    const onRerun = vi.fn();
    const onStdinChange = vi.fn();
    render(<ExecutionConsole {...requiredProps} error="failure" onClear={onClear} onRerun={onRerun}
      onStdinChange={onStdinChange} stdin="input" result={null} />);

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'next input' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run again' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear output' }));
    expect(onStdinChange).toHaveBeenCalledWith('next input');
    expect(onRerun).toHaveBeenCalledOnce();
    expect(onClear).toHaveBeenCalledOnce();
  });
});
