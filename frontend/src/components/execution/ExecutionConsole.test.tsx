import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ExecutionConsole } from './ExecutionConsole';

describe('ExecutionConsole', () => {
  it('renders output as text and preserves whitespace', () => {
    const { container } = render(<ExecutionConsole error="" onClear={() => undefined} onStdinChange={() => undefined} submitting={false} stdin="" result={{
      executionId: 'execution-1', status: 'COMPLETED', stdout: '<b>safe</b>\n  indented', stderr: null,
      compileOutput: null, exitCode: 0, durationMs: 8, message: null,
      createdAt: '2026-07-12T00:00:00Z', completedAt: '2026-07-12T00:00:01Z'
    }} />);

    expect(container.querySelector('pre')).toHaveTextContent('<b>safe</b>\n  indented', { normalizeWhitespace: false });
    expect(document.querySelector('b')).toBeNull();
    expect(screen.getByText('8 ms')).toBeInTheDocument();
  });

  it('clears output and edits stdin through explicit callbacks', () => {
    const onClear = vi.fn();
    const onStdinChange = vi.fn();
    render(<ExecutionConsole error="failure" onClear={onClear} onStdinChange={onStdinChange} submitting={false} stdin="input" result={null} />);

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'next input' } });
    fireEvent.click(screen.getByRole('button', { name: 'Clear output' }));
    expect(onStdinChange).toHaveBeenCalledWith('next input');
    expect(onClear).toHaveBeenCalledOnce();
  });
});
