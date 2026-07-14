import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, getExecution, submitExecution } from '../api';
import type { ExecutionResult, ExecutionStatus } from '../types';
import { useExecution } from './useExecution';

vi.mock('../api', () => ({
  ApiError: class ApiError extends Error {
    constructor(_method: string, _path: string, public status: number, _body: string) {
      super('safe test error');
    }
  },
  getExecution: vi.fn(),
  submitExecution: vi.fn()
}));

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

describe('useExecution', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('submits source, selected language, and stdin and publishes terminal output', async () => {
    vi.useFakeTimers();
    vi.mocked(submitExecution).mockResolvedValue(execution('QUEUED'));
    vi.mocked(getExecution).mockResolvedValue(execution('COMPLETED', {
      stdout: 'hello\n', exitCode: 0, durationMs: 12, completedAt: '2026-07-12T00:00:01Z'
    }));
    const { result } = renderHook(() => useExecution('ABC123:file-1', 'ABC123'));

    let runPromise: Promise<void>;
    act(() => {
      runPromise = result.current.run({
        roomCode: 'ABC123', language: 'javascript', sourceCode: 'console.log("hello")', stdin: 'pear\n'
      });
    });
    await act(async () => {
      await vi.runAllTimersAsync();
      await runPromise!;
    });

    expect(submitExecution).toHaveBeenCalledWith('ABC123', expect.any(String), {
      language: 'javascript', sourceCode: 'console.log("hello")', stdin: 'pear\n'
    });
    expect(result.current.result?.stdout).toBe('hello\n');
    expect(result.current.submitting).toBe(false);
  });

  it('prevents repeated clicks from duplicating an in-flight submission', async () => {
    let resolveSubmission!: (value: ExecutionResult) => void;
    vi.mocked(submitExecution).mockReturnValue(new Promise((resolve) => { resolveSubmission = resolve; }));
    const { result } = renderHook(() => useExecution('ABC123:file-1'));
    const input = { roomCode: 'ABC123', language: 'python' as const, sourceCode: 'print(1)', stdin: '' };

    act(() => {
      void result.current.run(input);
      void result.current.run(input);
    });

    expect(submitExecution).toHaveBeenCalledOnce();
    expect(result.current.submitting).toBe(true);
    await act(async () => resolveSubmission(execution('COMPLETED')));
    expect(result.current.submitting).toBe(false);
  });

  it('publishes queued and running states while polling', async () => {
    vi.useFakeTimers();
    vi.mocked(submitExecution).mockResolvedValue(execution('QUEUED'));
    vi.mocked(getExecution)
      .mockResolvedValueOnce(execution('RUNNING'))
      .mockResolvedValueOnce(execution('COMPLETED'));
    const { result } = renderHook(() => useExecution('ABC123:file-1'));

    act(() => {
      void result.current.run({ roomCode: 'ABC123', language: 'c', sourceCode: 'int main() {}', stdin: '' });
    });
    await act(async () => Promise.resolve());
    expect(result.current.result?.status).toBe('QUEUED');

    await act(async () => vi.advanceTimersByTimeAsync(700));
    expect(result.current.result?.status).toBe('RUNNING');

    await act(async () => vi.advanceTimersByTimeAsync(700));
    expect(result.current.result?.status).toBe('COMPLETED');
  });

  it('does not let an older out-of-order response replace a newer run', async () => {
    vi.useFakeTimers();
    const first = execution('QUEUED', { executionId: 'execution-old' });
    const second = execution('QUEUED', { executionId: 'execution-new' });
    let resolveOldPoll!: (value: ExecutionResult) => void;
    vi.mocked(submitExecution).mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    vi.mocked(getExecution)
      .mockReturnValueOnce(new Promise((resolve) => { resolveOldPoll = resolve; }))
      .mockResolvedValueOnce(execution('COMPLETED', { executionId: 'execution-new', stdout: 'new output' }));
    const { result } = renderHook(() => useExecution('ABC123:file-1'));

    act(() => {
      void result.current.run({ roomCode: 'ABC123', language: 'python', sourceCode: 'print("old")', stdin: '' });
    });
    await act(async () => Promise.resolve());
    await act(async () => vi.advanceTimersByTimeAsync(700));

    act(() => {
      void result.current.run({ roomCode: 'ABC123', language: 'python', sourceCode: 'print("new")', stdin: '' });
    });
    await act(async () => Promise.resolve());
    await act(async () => vi.advanceTimersByTimeAsync(700));
    expect(result.current.result?.stdout).toBe('new output');

    await act(async () => resolveOldPoll(execution('COMPLETED', { executionId: 'execution-old', stdout: 'stale output' })));
    expect(result.current.result?.executionId).toBe('execution-new');
    expect(result.current.result?.stdout).toBe('new output');
  });

  it('terminates polling with a safe failure after repeated retrieval errors', async () => {
    vi.useFakeTimers();
    vi.mocked(submitExecution).mockResolvedValue(execution('RUNNING'));
    vi.mocked(getExecution).mockRejectedValue(new Error('private provider hostname'));
    const { result } = renderHook(() => useExecution('ABC123:file-1'));

    act(() => {
      void result.current.run({ roomCode: 'ABC123', language: 'java', sourceCode: 'class Main {}', stdin: '' });
    });
    await act(async () => vi.advanceTimersByTimeAsync(2_100));

    expect(result.current.result?.status).toBe('FAILED');
    expect(result.current.result?.message).toMatch(/Could not retrieve/);
    expect(result.current.result?.message).not.toContain('private provider hostname');
  });

  it('renders a safe rate-limit submission error', async () => {
    vi.mocked(submitExecution).mockRejectedValue(new ApiError('POST', '/executions', 429, ''));
    const { result } = renderHook(() => useExecution('ABC123:file-1'));

    await act(async () => result.current.run({ roomCode: 'ABC123', language: 'cpp', sourceCode: 'int main() {}', stdin: '' }));

    expect(result.current.error).toBe('Too many executions. Try again in a minute.');
    expect(result.current.submitting).toBe(false);
  });

  it('restores the latest execution for the same room and file', async () => {
    window.sessionStorage.setItem('pearprogram-execution:ABC123:file-1', JSON.stringify({
      roomCode: 'ABC123', executionId: 'execution-restored'
    }));
    vi.mocked(getExecution).mockResolvedValue(execution('COMPLETED', {
      executionId: 'execution-restored', stdout: 'restored output'
    }));

    const { result } = renderHook(() => useExecution('ABC123:file-1'));

    await waitFor(() => expect(result.current.result?.stdout).toBe('restored output'));
    expect(getExecution).toHaveBeenCalledWith('ABC123', 'execution-restored');
  });

  it('clears output when the active scope changes without leaking a previous workspace result', async () => {
    window.sessionStorage.setItem('pearprogram-execution:ROOM1:file-1', JSON.stringify({
      roomCode: 'ROOM1', executionId: 'execution-room-1'
    }));
    vi.mocked(getExecution).mockResolvedValue(execution('COMPLETED', {
      executionId: 'execution-room-1', stdout: 'workspace one'
    }));
    const { result, rerender } = renderHook(({ roomCode, scope }) => useExecution(scope, roomCode), {
      initialProps: { roomCode: 'ROOM1' as string | null, scope: 'ROOM1:file-1' as string | null }
    });
    await waitFor(() => expect(result.current.result?.stdout).toBe('workspace one'));

    rerender({ roomCode: 'ROOM2', scope: 'ROOM2:file-1' });

    expect(result.current.result).toBeNull();
    expect(result.current.error).toBe('');
  });

  it('keeps a saved execution reference when restoration is temporarily unavailable', async () => {
    window.sessionStorage.setItem('pearprogram-execution:ABC123:file-1', JSON.stringify({
      roomCode: 'ABC123', executionId: 'execution-restored'
    }));
    vi.mocked(getExecution).mockRejectedValueOnce(new Error('network unavailable'));
    const first = renderHook(() => useExecution('ABC123:file-1', 'ABC123'));
    await waitFor(() => expect(first.result.current.error).toMatch(/Could not restore/));
    expect(window.sessionStorage.getItem('pearprogram-execution:ABC123:file-1')).not.toBeNull();
    first.unmount();

    vi.mocked(getExecution).mockResolvedValue(execution('COMPLETED', {
      executionId: 'execution-restored', stdout: 'available after reconnect'
    }));
    const second = renderHook(() => useExecution('ABC123:file-1', 'ABC123'));
    await waitFor(() => expect(second.result.current.result?.stdout).toBe('available after reconnect'));
    second.unmount();
  });

  it('rejects a saved execution reference associated with another room', () => {
    window.sessionStorage.setItem('pearprogram-execution:ROOM2:file-1', JSON.stringify({
      roomCode: 'ROOM1', executionId: 'execution-wrong-room'
    }));

    const { result } = renderHook(() => useExecution('ROOM2:file-1', 'ROOM2'));

    expect(result.current.result).toBeNull();
    expect(getExecution).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem('pearprogram-execution:ROOM2:file-1')).toBeNull();
  });

  it('ignores a response after the active file changes', async () => {
    let resolveSubmission!: (value: ExecutionResult) => void;
    vi.mocked(submitExecution).mockReturnValue(new Promise((resolve) => { resolveSubmission = resolve; }));
    const { result, rerender } = renderHook(({ scope }) => useExecution(scope), {
      initialProps: { scope: 'ABC123:file-1' as string | null }
    });

    act(() => {
      void result.current.run({ roomCode: 'ABC123', language: 'python', sourceCode: 'print(1)', stdin: '' });
    });
    rerender({ scope: 'ABC123:file-2' });
    await act(async () => resolveSubmission(execution('QUEUED')));

    expect(result.current.result).toBeNull();
    expect(result.current.submitting).toBe(false);
    expect(getExecution).not.toHaveBeenCalled();
  });

  it('clears the console and its saved execution reference', async () => {
    vi.mocked(submitExecution).mockResolvedValue(execution('COMPLETED'));
    const { result, unmount } = renderHook(() => useExecution('ABC123:file-1'));
    await act(async () => result.current.run({ roomCode: 'ABC123', language: 'python', sourceCode: 'print(1)', stdin: '' }));
    expect(window.sessionStorage.getItem('pearprogram-execution:ABC123:file-1')).not.toBeNull();

    act(() => result.current.clear());
    expect(result.current.result).toBeNull();
    expect(window.sessionStorage.getItem('pearprogram-execution:ABC123:file-1')).toBeNull();
    unmount();
  });

  it('cancels polling when its owner unmounts', async () => {
    let resolveSubmission!: (value: ExecutionResult) => void;
    vi.mocked(submitExecution).mockReturnValue(new Promise((resolve) => { resolveSubmission = resolve; }));
    const { result, unmount } = renderHook(() => useExecution('ABC123:file-1'));
    act(() => {
      void result.current.run({ roomCode: 'ABC123', language: 'python', sourceCode: 'print(1)', stdin: '' });
    });

    unmount();
    await act(async () => resolveSubmission(execution('QUEUED')));
    expect(getExecution).not.toHaveBeenCalled();
  });
});
