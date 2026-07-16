import { describe, expect, it } from 'vitest';
import {
  EXECUTION_LANGUAGES,
  executionLanguageForEditorLanguage,
  inferLanguage,
  normalizeExecutionLanguageOptions
} from './language';

describe('execution languages', () => {
  it('infers newly executable Monaco languages from file extensions', () => {
    expect(inferLanguage('main.go')).toBe('go');
    expect(inferLanguage('main.rs')).toBe('rust');
    expect(inferLanguage('Program.cs')).toBe('csharp');
    expect(inferLanguage('script.sh')).toBe('shell');
  });

  it('automatically selects any executable editor language supported by the backend', () => {
    expect(executionLanguageForEditorLanguage('rust')).toBe('rust');
    expect(executionLanguageForEditorLanguage('markdown')).toBeNull();
    expect(executionLanguageForEditorLanguage('rust', [{ id: 'python', label: 'Python' }])).toBeNull();
  });

  it('normalizes the backend catalog and removes unknown or duplicate entries', () => {
    expect(normalizeExecutionLanguageOptions([
      { id: ' Python ', label: ' Python 3 ' },
      { id: 'python', label: 'Duplicate' },
      { id: 'markdown', label: 'Markdown' },
      { id: 'rust', label: '' }
    ])).toEqual([{ id: 'python', label: 'Python 3' }]);
    expect(EXECUTION_LANGUAGES.map((language) => language.id)).not.toContain('markdown');
  });
});
