import { useEffect, useState } from 'react';
import { getExecutionLanguages } from '../api';
import {
  EXECUTION_LANGUAGES,
  normalizeExecutionLanguageOptions,
  type ExecutionLanguageOption
} from '../language';

export function useExecutionLanguages(enabled: boolean) {
  const [languages, setLanguages] = useState<readonly ExecutionLanguageOption[]>(EXECUTION_LANGUAGES);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let cancelled = false;
    void getExecutionLanguages()
      .then((options) => {
        const normalized = normalizeExecutionLanguageOptions(options);
        if (!cancelled && normalized.length > 0) {
          setLanguages(normalized);
        }
      })
      .catch(() => {
        // The local catalog keeps execution controls usable during a transient API failure.
      });

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return languages;
}
