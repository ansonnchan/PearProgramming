import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getExecution, submitExecution } from '../api';
import { useExecution } from './useExecution';

vi.mock('../api', () => ({
  ApiError: class ApiError extends Error { status = 500; },
  getExecution: vi.fn(),
  submitExecution: vi.fn()
}));

const queued = {
  executionId: 'execution-1', status: 'QUEUED' as const, stdout: null, stderr: null,
  compileOutput: null, exitCode: null, durationMs: null, message: null,
  createdAt: '2026-07-12T00:00:00Z', completedAt: null
};

describe('useExecution', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('submits the active source and publishes terminal output', async () => {
    vi.useFakeTimers();
    vi.mocked(submitExecution).mockResolvedValue(queued);
    vi.mocked(getExecution).mockResolvedValue({ ...queued, status: 'COMPLETED', stdout: 'hello\n', exitCode: 0, durationMs: 12 });
    const { result } = renderHook(() => useExecution('file-1'));

    let runPromise: Promise<void>;
    act(() => {
      runPromise = result.current.run({ roomCode: 'ABC123', language: 'javascript', sourceCode: 'console.log("hello")', stdin: '' });
    });
    await act(async () => {
      await vi.runAllTimersAsync();
      await runPromise!;
    });

    expect(submitExecution).toHaveBeenCalledWith('ABC123', expect.any(String), {
      language: 'javascript', sourceCode: 'console.log("hello")', stdin: ''
    });
    expect(result.current.result?.stdout).toBe('hello\n');
    expect(result.current.submitting).toBe(false);
  });

  it('ignores a response after the active file changes', async () => {
    let resolveSubmission!: (value: typeof queued) => void;
    vi.mocked(submitExecution).mockReturnValue(new Promise((resolve) => { resolveSubmission = resolve; }));
    const { result, rerender } = renderHook(({ scope }) => useExecution(scope), { initialProps: { scope: 'file-1' } });

    act(() => {
      void result.current.run({ roomCode: 'ABC123', language: 'python', sourceCode: 'print(1)', stdin: '' });
    });
    rerender({ scope: 'file-2' });
    await act(async () => resolveSubmission(queued));

    expect(result.current.result).toBeNull();
    expect(result.current.submitting).toBe(false);
    expect(getExecution).not.toHaveBeenCalled();
  });
});
