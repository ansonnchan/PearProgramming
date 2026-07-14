import { describe, expect, it, vi } from 'vitest';
import { createExecutionInput } from './input';

describe('createExecutionInput', () => {
  it('captures the current Monaco value with the selected language and stdin', () => {
    const getValue = vi.fn(() => 'console.log("live collaborative value")');

    expect(createExecutionInput({
      editor: { getValue },
      fallbackSourceCode: 'console.log("stale file snapshot")',
      language: 'javascript',
      roomCode: 'ABC123',
      stdin: 'first line\nsecond line\n'
    })).toEqual({
      roomCode: 'ABC123',
      language: 'javascript',
      sourceCode: 'console.log("live collaborative value")',
      stdin: 'first line\nsecond line\n'
    });
    expect(getValue).toHaveBeenCalledOnce();
  });

  it('uses the active file snapshot before Monaco has mounted', () => {
    expect(createExecutionInput({
      editor: null,
      fallbackSourceCode: 'print("ready")',
      language: 'python',
      roomCode: 'ROOM42',
      stdin: ''
    }).sourceCode).toBe('print("ready")');
  });
});
