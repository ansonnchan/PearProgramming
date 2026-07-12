import { SquareTerminal } from 'lucide-react';
import { executionStatusLabel, isTerminalExecution } from '../../execution/state';
import type { ExecutionResult } from '../../types';

type ExecutionConsoleProps = {
  error: string;
  onClear: () => void;
  onStdinChange: (value: string) => void;
  result: ExecutionResult | null;
  stdin: string;
  submitting: boolean;
};

export function ExecutionConsole({ error, onClear, onStdinChange, result, stdin, submitting }: ExecutionConsoleProps) {
  const hasOutput = Boolean(result?.stdout || result?.stderr || result?.compileOutput || result?.message || error);
  const running = submitting || (result ? !isTerminalExecution(result.status) : false);

  return (
    <section className="execution-console" aria-label="Execution console">
      <header className="execution-console-header">
        <div className="execution-console-title">
          <SquareTerminal size={14} />
          <strong>Console</strong>
          {result && <span className={`execution-status execution-status-${result.status.toLowerCase()}`}>{executionStatusLabel(result.status)}</span>}
          {result?.durationMs !== null && result?.durationMs !== undefined && <span className="execution-duration">{result.durationMs} ms</span>}
        </div>
        <button className="clear-console-button" disabled={!result && !error && !submitting} onClick={onClear} type="button">
          Clear output
        </button>
      </header>
      <div className="execution-console-body">
        <label className="stdin-field">
          <span>Standard input (optional)</span>
          <textarea onChange={(event) => onStdinChange(event.target.value)} placeholder="Input passed to the program" spellCheck={false} value={stdin} />
        </label>
        <div className="execution-output" aria-live="polite">
          {running && <p className="execution-progress">{submitting ? 'Submitting securely…' : `${executionStatusLabel(result!.status)}…`}</p>}
          {error && <section className="output-block output-system"><strong>Request failed</strong><pre>{error}</pre></section>}
          {result?.compileOutput && <section className="output-block output-error"><strong>Compilation error</strong><pre>{result.compileOutput}</pre></section>}
          {result?.stdout && <section className="output-block output-stdout"><strong>Standard output</strong><pre>{result.stdout}</pre></section>}
          {result?.stderr && <section className="output-block output-error"><strong>{result.status === 'RUNTIME_ERROR' ? 'Runtime error' : 'Standard error'}</strong><pre>{result.stderr}</pre></section>}
          {result?.message && (
            <section className={`output-block ${result.status === 'TIMED_OUT' || result.status === 'FAILED' ? 'output-system' : ''}`}>
              <strong>{result.status === 'TIMED_OUT' ? 'Timed out' : result.status === 'FAILED' ? 'System failure' : 'Execution status'}</strong>
              <pre>{result.message}</pre>
            </section>
          )}
          {!running && !result && !hasOutput && <p className="execution-empty">Run the active file to see output here.</p>}
          {result && isTerminalExecution(result.status) && !hasOutput && <p className="execution-empty">Process finished with no output.</p>}
          {result?.exitCode !== null && result?.exitCode !== undefined && <p className="execution-exit-code">Process exited with code {result.exitCode}</p>}
        </div>
      </div>
    </section>
  );
}
