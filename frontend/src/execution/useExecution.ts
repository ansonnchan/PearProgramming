import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, getExecution, submitExecution } from '../api';
import type { ExecutionResult } from '../types';
import type { ExecutionLanguage } from '../language';
import { frontendTimeoutResult, isTerminalExecution } from './state';

const POLLING_DEADLINE_MS = 35_000;
const POLLING_INTERVAL_MS = 700;
const MAX_CONSECUTIVE_FAILURES = 3;

type RunInput = {
  roomCode: string;
  language: ExecutionLanguage;
  sourceCode: string;
  stdin: string;
};

export function useExecution(scopeKey: string | null) {
  const [result, setResult] = useState<ExecutionResult | null>(null);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const sequenceRef = useRef(0);
  const submittingRef = useRef(false);

  const clear = useCallback(() => {
    sequenceRef.current += 1;
    setResult(null);
    setError('');
    setSubmitting(false);
    submittingRef.current = false;
  }, []);

  useEffect(() => {
    clear();
  }, [clear, scopeKey]);

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
      setResult(current);
      setSubmitting(false);
      submittingRef.current = false;

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
          if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            setResult({
              ...frontendTimeoutResult(current),
              message: 'Could not retrieve the execution result after several attempts.'
            });
            return;
          }
        }
      }

      if (!isTerminalExecution(current.status) && sequenceRef.current === sequence) {
        setResult(frontendTimeoutResult(current));
      }
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
  }, []);

  return { clear, error, result, run, submitting };
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
