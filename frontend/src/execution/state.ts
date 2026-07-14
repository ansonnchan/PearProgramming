import type { ExecutionResult, ExecutionStatus } from '../types';

const TERMINAL_STATUSES = new Set<ExecutionStatus>([
  'COMPLETED',
  'COMPILATION_ERROR',
  'RUNTIME_ERROR',
  'TIMED_OUT',
  'FAILED',
  'CANCELLED'
]);

export function isTerminalExecution(status: ExecutionStatus) {
  return TERMINAL_STATUSES.has(status);
}

export function executionStatusLabel(status: ExecutionStatus) {
  return status.toLowerCase().replace(/_/g, ' ').replace(/^./, (letter: string) => letter.toUpperCase());
}

export function frontendTimeoutResult(current: ExecutionResult): ExecutionResult {
  return {
    ...current,
    status: 'FAILED',
    message: 'The browser stopped waiting for this execution. You can run it again.',
    completedAt: new Date().toISOString()
  };
}
