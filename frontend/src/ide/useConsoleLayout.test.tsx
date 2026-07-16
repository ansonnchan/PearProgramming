import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConsoleHeight, loadConsoleOpen, MIN_CONSOLE_HEIGHT, useConsoleLayout } from './useConsoleLayout';

describe('useConsoleLayout', () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        clear: () => values.clear(),
        getItem: (key: string) => values.get(key) ?? null,
        removeItem: (key: string) => values.delete(key),
        setItem: (key: string, value: string) => values.set(key, value)
      }
    });
  });

  it('loads and constrains a saved console height', () => {
    window.localStorage.setItem('pearprogram-console-height', '9999');
    expect(loadConsoleHeight()).toBe(520);
    window.localStorage.setItem('pearprogram-console-height', '20');
    expect(loadConsoleHeight()).toBe(250);
  });

  it('supports keyboard resizing without collapsing the editor', () => {
    const { result } = renderHook(() => useConsoleLayout());
    const preventDefault = vi.fn();

    act(() => result.current.handleConsoleResizeKeyDown({ key: 'Home', shiftKey: false, preventDefault } as never));
    expect(result.current.consoleHeight).toBe(MIN_CONSOLE_HEIGHT);
    expect(preventDefault).toHaveBeenCalledOnce();

    act(() => result.current.handleConsoleResizeKeyDown({ key: 'ArrowUp', shiftKey: true, preventDefault } as never));
    expect(result.current.consoleHeight).toBe(MIN_CONSOLE_HEIGHT + 48);
  });

  it('restores and persists the console open state', () => {
    window.localStorage.setItem('pearprogram-console-open', 'false');
    expect(loadConsoleOpen()).toBe(false);

    const { result } = renderHook(() => useConsoleLayout());
    expect(result.current.executionPanelOpen).toBe(false);

    act(() => result.current.setExecutionPanelOpen(true));
    expect(window.localStorage.getItem('pearprogram-console-open')).toBe('true');
  });
});
