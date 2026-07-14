import { SquareTerminal } from 'lucide-react';
import { executionStatusLabel, isTerminalExecution } from '../../execution/state';
import type { ExecutionResult } from '../../types';

type ExecutionConsoleProps = {
  error: string;
  onClear: () => void;
  onRerun: () => void;
  onStdinChange: (value: string) => void;
  result: ExecutionResult | null;
  stdin: string;
  submitting: boolean;
};

export function ExecutionConsole({ error, onClear, onRerun, onStdinChange, result, stdin, submitting }: ExecutionConsoleProps) {
  const hasOutput = Boolean(result?.stdout || result?.stderr || result?.compileOutput || result?.message || error);
  const running = submitting || (result ? !isTerminalExecution(result.status) : false);
  const canRerun = Boolean(error || (result && isTerminalExecution(result.status)));

  return (
    <section className="execution-console" aria-label="Execution console">
      <header className="execution-console-header">
        <div className="execution-console-title">
          <SquareTerminal size={14} />
          <strong>Console</strong>
          {result && <span className={`execution-status execution-status-${result.status.toLowerCase()}`}>{executionStatusLabel(result.status)}</span>}
          {result?.durationMs !== null && result?.durationMs !== undefined && <span className="execution-duration">{result.durationMs} ms</span>}
        </div>
        <div className="execution-console-actions">
          {canRerun && <button className="rerun-button" disabled={submitting} onClick={onRerun} type="button">Run again</button>}
          <button className="clear-console-button" disabled={!result && !error && !submitting} onClick={onClear} type="button">
            Clear output
          </button>
        </div>
      </header>
      <div className="execution-console-body">
        <label className="stdin-field">
          <span>Standard input (optional)</span>
          <textarea onChange={(event) => onStdinChange(event.target.value)} placeholder="Input passed to the program" spellCheck={false} value={stdin} />
        </label>
        <div className="execution-output" aria-busy={running} aria-live="polite">
          {running && <p className="execution-progress">{submitting ? 'Submitting securely…' : `${executionStatusLabel(result!.status)}…`}</p>}
          {error && <section className="output-block output-system"><strong>Request failed</strong><pre>{error}</pre></section>}
          {result?.compileOutput && <section className="output-block output-error"><strong>Compilation error</strong><pre>{result.compileOutput}</pre></section>}
          {result?.stdout && <section className="output-block output-stdout"><strong>Standard output</strong><pre>{result.stdout}</pre></section>}
          {result?.stderr && <section className="output-block output-error"><strong>{result.status === 'RUNTIME_ERROR' ? 'Runtime error' : 'Standard error'}</strong><pre>{result.stderr}</pre></section>}
          {result?.message && (
            <section className={`output-block ${result.status === 'TIMED_OUT' || result.status === 'FAILED' || result.status === 'CANCELLED' ? 'output-system' : ''}`}>
              <strong>{result.status === 'TIMED_OUT' ? 'Timed out' : result.status === 'FAILED' ? 'System failure' : result.status === 'CANCELLED' ? 'Cancelled' : 'Execution status'}</strong>
              <pre>{result.message}</pre>
            </section>
          )}
          {result && !hasOutput && result.status === 'COMPILATION_ERROR' && <p className="execution-fallback-error">Compilation failed without diagnostic output.</p>}
          {result && !hasOutput && result.status === 'RUNTIME_ERROR' && <p className="execution-fallback-error">The program failed at runtime without diagnostic output.</p>}
          {result && !hasOutput && result.status === 'TIMED_OUT' && <p className="execution-fallback-system">Execution exceeded the configured time limit.</p>}
          {result && !hasOutput && result.status === 'FAILED' && <p className="execution-fallback-system">The execution service could not complete this run.</p>}
          {result && !hasOutput && result.status === 'CANCELLED' && <p className="execution-fallback-system">This execution was cancelled.</p>}
          {!running && !result && !hasOutput && <p className="execution-empty">Run the active file to see output here.</p>}
          {result?.status === 'COMPLETED' && !hasOutput && <p className="execution-empty">Process finished with no output.</p>}
          {result?.exitCode !== null && result?.exitCode !== undefined && <p className="execution-exit-code">Process exited with code {result.exitCode}</p>}
        </div>
      </div>
    </section>
  );
}
