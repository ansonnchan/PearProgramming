import { Play, SquareTerminal } from 'lucide-react';
import { EXECUTION_LANGUAGES, type ExecutionLanguage } from '../../language';

type ExecutionToolbarProps = {
  activeFile: boolean;
  consoleOpen: boolean;
  language: ExecutionLanguage;
  onLanguageChange: (language: ExecutionLanguage) => void;
  onRun: () => void;
  onToggleConsole: () => void;
  submitting: boolean;
};

export function ExecutionToolbar({
  activeFile,
  consoleOpen,
  language,
  onLanguageChange,
  onRun,
  onToggleConsole,
  submitting
}: ExecutionToolbarProps) {
  return (
    <div className="execution-toolbar" aria-label="Execution controls" role="toolbar">
      <button
        className="run-button"
        disabled={!activeFile || submitting}
        onClick={onRun}
        title={activeFile ? 'Run the current collaborative document' : 'Open a file to run code'}
        type="button"
      >
        <Play size={14} />
        {submitting ? 'Submitting…' : 'Run'}
      </button>
      <label className="execution-language-label">
        <span>Language</span>
        <select disabled={submitting} onChange={(event) => onLanguageChange(event.target.value as ExecutionLanguage)} value={language}>
          {EXECUTION_LANGUAGES.map((option) => (
            <option key={option.id} value={option.id}>{option.label}</option>
          ))}
        </select>
      </label>
      {language === 'java' && <span className="java-main-hint">Java entry class: Main</span>}
      <button className="console-toggle" onClick={onToggleConsole} type="button">
        <SquareTerminal size={14} />
        {consoleOpen ? 'Hide console' : 'Show console'}
      </button>
    </div>
  );
}
