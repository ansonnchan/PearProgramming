import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getExecutionLanguages } from '../api';
import { EXECUTION_LANGUAGES } from '../language';
import { useExecutionLanguages } from './useExecutionLanguages';

vi.mock('../api', () => ({
  getExecutionLanguages: vi.fn()
}));

describe('useExecutionLanguages', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('replaces the fallback catalog with the authenticated backend catalog', async () => {
    vi.mocked(getExecutionLanguages).mockResolvedValue([
      { id: 'python', label: 'Python' },
      { id: 'go', label: 'Go' }
    ]);

    const { result } = renderHook(() => useExecutionLanguages(true));

    await waitFor(() => expect(result.current).toEqual([
      { id: 'python', label: 'Python' },
      { id: 'go', label: 'Go' }
    ]));
  });

  it('keeps the fallback catalog when loading is disabled or unavailable', async () => {
    const disabled = renderHook(() => useExecutionLanguages(false));
    expect(disabled.result.current).toEqual(EXECUTION_LANGUAGES);
    expect(getExecutionLanguages).not.toHaveBeenCalled();

    vi.mocked(getExecutionLanguages).mockRejectedValue(new Error('unavailable'));
    const unavailable = renderHook(() => useExecutionLanguages(true));
    await waitFor(() => expect(getExecutionLanguages).toHaveBeenCalledOnce());
    expect(unavailable.result.current).toEqual(EXECUTION_LANGUAGES);
  });
});
