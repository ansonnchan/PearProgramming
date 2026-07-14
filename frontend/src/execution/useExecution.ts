import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, getExecution, submitExecution } from '../api';
import type { ExecutionResult } from '../types';
import type { ExecutionLanguage } from '../language';
import { frontendTimeoutResult, isTerminalExecution } from './state';

const POLLING_DEADLINE_MS = 35_000;
const POLLING_INTERVAL_MS = 700;
const MAX_CONSECUTIVE_FAILURES = 3;
const EXECUTION_STORAGE_PREFIX = 'pearprogram-execution:';

type RunInput = {
  roomCode: string;
  language: ExecutionLanguage;
  sourceCode: string;
  stdin: string;
};

export function useExecution(scopeKey: string | null, activeRoomCode: string | null = null) {
  const [result, setResult] = useState<ExecutionResult | null>(null);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const sequenceRef = useRef(0);
  const submittingRef = useRef(false);
  const scopeKeyRef = useRef(scopeKey);

  scopeKeyRef.current = scopeKey;

  const clear = useCallback(() => {
    sequenceRef.current += 1;
    removePersistedExecution(scopeKeyRef.current);
    setResult(null);
    setError('');
    setSubmitting(false);
    submittingRef.current = false;
  }, []);

  const watchExecution = useCallback(async (roomCode: string, initial: ExecutionResult, sequence: number) => {
    let current = initial;
    const deadline = Date.now() + POLLING_DEADLINE_MS;
    let consecutiveFailures = 0;

    while (!isTerminalExecution(current.status) && Date.now() < deadline) {
      await delay(POLLING_INTERVAL_MS);
      if (sequenceRef.current !== sequence) {
        return;
      }
      try {
        current = await getExecution(roomCode, current.executionId);
        consecutiveFailures = 0;
        if (sequenceRef.current === sequence) {
          setResult(current);
        }
      } catch {
        consecutiveFailures += 1;
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES && sequenceRef.current === sequence) {
          setResult({
            ...frontendTimeoutResult(current),
            message: 'Could not retrieve the execution result after several attempts. Reopen this file to try restoring its latest status.'
          });
          return;
        }
      }
    }

    if (!isTerminalExecution(current.status) && sequenceRef.current === sequence) {
      setResult(frontendTimeoutResult(current));
    }
  }, []);

  useEffect(() => {
    const sequence = sequenceRef.current + 1;
    sequenceRef.current = sequence;
    submittingRef.current = false;
    setResult(null);
    setError('');
    setSubmitting(false);

    const persisted = readPersistedExecution(scopeKey, activeRoomCode);
    if (persisted) {
      void getExecution(persisted.roomCode, persisted.executionId)
        .then(async (restored) => {
          if (sequenceRef.current !== sequence) {
            return;
          }
          setResult(restored);
          await watchExecution(persisted.roomCode, restored, sequence);
        })
        .catch((cause) => {
          if (sequenceRef.current === sequence) {
            if (cause instanceof ApiError && (cause.status === 403 || cause.status === 404)) {
              removePersistedExecution(scopeKey);
            } else {
              setError('Could not restore the latest execution status. Reopen this file to try again.');
            }
          }
        });
    }

    return () => {
      sequenceRef.current += 1;
      submittingRef.current = false;
    };
  }, [activeRoomCode, scopeKey, watchExecution]);

  const run = useCallback(async ({ roomCode, language, sourceCode, stdin }: RunInput) => {
    if (submittingRef.current) {
      return;
    }

    const sequence = sequenceRef.current + 1;
    sequenceRef.current = sequence;
    submittingRef.current = true;
    setSubmitting(true);
    setError('');
    setResult(null);

    try {
      let current = await submitExecution(roomCode, crypto.randomUUID(), { language, sourceCode, stdin });
      if (sequenceRef.current !== sequence) {
        return;
      }
      persistExecution(scopeKeyRef.current, roomCode, current.executionId);
      setResult(current);
      setSubmitting(false);
      submittingRef.current = false;
      await watchExecution(roomCode, current, sequence);
    } catch (cause) {
      if (sequenceRef.current === sequence) {
        setError(executionErrorMessage(cause));
      }
    } finally {
      if (sequenceRef.current === sequence) {
        setSubmitting(false);
        submittingRef.current = false;
      }
    }
  }, [watchExecution]);

  return { clear, error, result, run, submitting };
}

type PersistedExecution = {
  executionId: string;
  roomCode: string;
};

function storageKey(scopeKey: string) {
  return `${EXECUTION_STORAGE_PREFIX}${scopeKey}`;
}

function persistExecution(scopeKey: string | null, roomCode: string, executionId: string) {
  if (!scopeKey) {
    return;
  }
  try {
    window.sessionStorage.setItem(storageKey(scopeKey), JSON.stringify({ roomCode, executionId } satisfies PersistedExecution));
  } catch {
    // Execution remains usable when browser storage is unavailable.
  }
}

function readPersistedExecution(scopeKey: string | null, activeRoomCode: string | null): PersistedExecution | null {
  if (!scopeKey) {
    return null;
  }
  try {
    const value = JSON.parse(window.sessionStorage.getItem(storageKey(scopeKey)) ?? 'null') as Partial<PersistedExecution> | null;
    if (!value || typeof value.roomCode !== 'string' || typeof value.executionId !== 'string') {
      return null;
    }
    if (activeRoomCode && value.roomCode !== activeRoomCode) {
      removePersistedExecution(scopeKey);
      return null;
    }
    return { roomCode: value.roomCode, executionId: value.executionId };
  } catch {
    removePersistedExecution(scopeKey);
    return null;
  }
}

function removePersistedExecution(scopeKey: string | null) {
  if (!scopeKey) {
    return;
  }
  try {
    window.sessionStorage.removeItem(storageKey(scopeKey));
  } catch {
    // Clearing the visible console must still succeed when storage is unavailable.
  }
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));
}

function executionErrorMessage(error: unknown) {
  if (!(error instanceof Error)) {
    return 'Could not submit this execution.';
  }
  const bodyMatch = error.message.match(/:\s*(\{.*\})$/s);
  if (bodyMatch) {
    try {
      const body = JSON.parse(bodyMatch[1]) as { message?: string };
      if (body.message) {
        return body.message;
      }
    } catch {
      // The provider response is intentionally hidden behind a safe client message.
    }
  }
  return error instanceof ApiError && error.status === 429
    ? 'Too many executions. Try again in a minute.'
    : 'Could not submit this execution. Check the room connection and try again.';
}
