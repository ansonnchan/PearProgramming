import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';

const CONSOLE_HEIGHT_STORAGE_KEY = 'pearprogram-console-height';
const CONSOLE_OPEN_STORAGE_KEY = 'pearprogram-console-open';
const DEFAULT_CONSOLE_HEIGHT = 250;
const MAX_CONSOLE_HEIGHT = 520;
const MIN_EDITOR_HEIGHT = 170;

export const MIN_CONSOLE_HEIGHT = 160;

export function useConsoleLayout() {
  const [executionPanelOpen, setExecutionPanelOpen] = useState(loadConsoleOpen);
  const [consoleHeight, setConsoleHeight] = useState(loadConsoleHeight);
  const [consoleMaximumHeightValue, setConsoleMaximumHeightValue] = useState(MAX_CONSOLE_HEIGHT);
  const [consoleResizing, setConsoleResizing] = useState(false);
  const editorStackRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem(CONSOLE_HEIGHT_STORAGE_KEY, String(consoleHeight));
    } catch {
      // Resizing remains available when local storage is disabled.
    }
  }, [consoleHeight]);

  useEffect(() => {
    try {
      window.localStorage.setItem(CONSOLE_OPEN_STORAGE_KEY, String(executionPanelOpen));
    } catch {
      // Showing and hiding the console remains available when local storage is disabled.
    }
  }, [executionPanelOpen]);

  useEffect(() => {
    const editorStack = editorStackRef.current;
    if (!editorStack) return;

    const updateMaximumHeight = () => {
      const availableHeight = editorStack.clientHeight;
      const nextMaximum = availableHeight
        ? Math.max(MIN_CONSOLE_HEIGHT, Math.min(MAX_CONSOLE_HEIGHT, availableHeight - MIN_EDITOR_HEIGHT))
        : MAX_CONSOLE_HEIGHT;
      setConsoleMaximumHeightValue((current) => current === nextMaximum ? current : nextMaximum);
    };

    updateMaximumHeight();
    window.addEventListener('resize', updateMaximumHeight);
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateMaximumHeight);
    resizeObserver?.observe(editorStack);
    return () => {
      window.removeEventListener('resize', updateMaximumHeight);
      resizeObserver?.disconnect();
    };
  }, []);

  function consoleMaximumHeight() {
    return consoleMaximumHeightValue;
  }

  function handleConsoleResizeStart(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    const startY = event.clientY;
    const startHeight = Math.min(consoleHeight, consoleMaximumHeight());
    const maximumHeight = consoleMaximumHeight();
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    setConsoleResizing(true);
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';

    const handlePointerMove = (pointerEvent: PointerEvent) => {
      const nextHeight = startHeight + startY - pointerEvent.clientY;
      setConsoleHeight(clampNumber(nextHeight, MIN_CONSOLE_HEIGHT, maximumHeight));
    };
    const stopResizing = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stopResizing);
      window.removeEventListener('pointercancel', stopResizing);
      window.removeEventListener('blur', stopResizing);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      setConsoleResizing(false);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopResizing);
    window.addEventListener('pointercancel', stopResizing);
    window.addEventListener('blur', stopResizing);
  }

  function handleConsoleResizeKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 48 : 20;
    let nextHeight: number | null = null;
    if (event.key === 'ArrowUp') nextHeight = consoleHeight + step;
    if (event.key === 'ArrowDown') nextHeight = consoleHeight - step;
    if (event.key === 'Home') nextHeight = MIN_CONSOLE_HEIGHT;
    if (event.key === 'End') nextHeight = consoleMaximumHeight();
    if (nextHeight === null) {
      return;
    }
    event.preventDefault();
    setConsoleHeight(clampNumber(nextHeight, MIN_CONSOLE_HEIGHT, consoleMaximumHeight()));
  }

  return {
    consoleHeight,
    consoleMaximumHeight,
    consoleResizing,
    editorStackRef,
    executionPanelOpen,
    handleConsoleResizeKeyDown,
    handleConsoleResizeStart,
    setConsoleHeight,
    setExecutionPanelOpen
  };
}

export function loadConsoleHeight() {
  try {
    const value = Number(window.localStorage.getItem(CONSOLE_HEIGHT_STORAGE_KEY));
    if (Number.isFinite(value) && value >= MIN_CONSOLE_HEIGHT) {
      return clampNumber(value, MIN_CONSOLE_HEIGHT, MAX_CONSOLE_HEIGHT);
    }
  } catch {
    // Use the default when local storage is disabled.
  }
  return DEFAULT_CONSOLE_HEIGHT;
}

export function loadConsoleOpen() {
  try {
    const value = window.localStorage.getItem(CONSOLE_OPEN_STORAGE_KEY);
    if (value === 'false') return false;
    if (value === 'true') return true;
  } catch {
    // Use the default when local storage is disabled.
  }
  return true;
}

function clampNumber(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}
