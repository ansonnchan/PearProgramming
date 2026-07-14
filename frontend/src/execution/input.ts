import type { ExecutionLanguage } from '../language';

type EditorValueReader = {
  getValue?: () => string;
};

type ExecutionInputOptions = {
  editor: EditorValueReader | null;
  fallbackSourceCode: string;
  language: ExecutionLanguage;
  roomCode: string;
  stdin: string;
};

export function createExecutionInput({
  editor,
  fallbackSourceCode,
  language,
  roomCode,
  stdin
}: ExecutionInputOptions) {
  return {
    roomCode,
    language,
    sourceCode: editor?.getValue?.() ?? fallbackSourceCode,
    stdin
  };
}
