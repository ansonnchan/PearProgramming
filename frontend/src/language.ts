//languages offered by Monaco Editor: https://microsoft.github.io/monaco-editor/monarch.html
const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  adoc: 'plaintext',
  astro: 'html',
  bash: 'shell',
  bat: 'bat',
  c: 'c',
  cjs: 'javascript',
  cc: 'cpp',
  cmd: 'bat',
  conf: 'ini',
  config: 'ini',
  cpp: 'cpp',
  cs: 'csharp',
  csv: 'plaintext',
  css: 'css',
  cxx: 'cpp',
  dart: 'dart',
  env: 'ini',
  go: 'go',
  h: 'c',
  hh: 'cpp',
  hpp: 'cpp',
  htm: 'html',
  html: 'html',
  hxx: 'cpp',
  ini: 'ini',
  java: 'java',
  js: 'javascript',
  json: 'json',
  jsonc: 'json',
  jsx: 'javascript',
  kt: 'kotlin',
  kts: 'kotlin',
  less: 'less',
  lua: 'lua',
  m: 'objective-c',
  mjs: 'javascript',
  mm: 'objective-c',
  md: 'markdown',
  markdown: 'markdown',
  mdx: 'markdown',
  php: 'php',
  properties: 'ini',
  ps1: 'powershell',
  py: 'python',
  r: 'r',
  rb: 'ruby',
  rs: 'rust',
  rst: 'plaintext',
  sass: 'scss',
  scala: 'scala',
  scss: 'scss',
  sh: 'shell',
  sql: 'sql',
  svelte: 'html',
  swift: 'swift',
  toml: 'ini',
  ts: 'typescript',
  tsv: 'plaintext',
  tsx: 'typescript',
  vue: 'html',
  xml: 'xml',
  yaml: 'yaml',
  yml: 'yaml'
};

export const EXECUTION_LANGUAGES = [
  { id: 'java', label: 'Java' },
  { id: 'python', label: 'Python' },
  { id: 'javascript', label: 'JavaScript' },
  { id: 'c', label: 'C' },
  { id: 'cpp', label: 'C++' },
  { id: 'typescript', label: 'TypeScript' },
  { id: 'sql', label: 'SQL' },
  { id: 'csharp', label: 'C#' },
  { id: 'php', label: 'PHP' },
  { id: 'ruby', label: 'Ruby' },
  { id: 'go', label: 'Go' },
  { id: 'rust', label: 'Rust' },
  { id: 'kotlin', label: 'Kotlin' },
  { id: 'swift', label: 'Swift' },
  { id: 'r', label: 'R' },
  { id: 'shell', label: 'Shell' }
] as const;

export type ExecutionLanguage = typeof EXECUTION_LANGUAGES[number]['id'];
export type ExecutionLanguageOption = {
  id: ExecutionLanguage;
  label: string;
};

const EXECUTION_LANGUAGE_IDS = new Set<string>(EXECUTION_LANGUAGES.map((language) => language.id));

export function isExecutionLanguage(language: string): language is ExecutionLanguage {
  return EXECUTION_LANGUAGE_IDS.has(language);
}

export function normalizeExecutionLanguageOptions(
  options: readonly { id: string; label: string }[]
): ExecutionLanguageOption[] {
  const seen = new Set<ExecutionLanguage>();
  return options.flatMap((option) => {
    const id = option.id.trim().toLowerCase();
    const label = option.label.trim();
    if (!isExecutionLanguage(id) || !label || seen.has(id)) {
      return [];
    }
    seen.add(id);
    return [{ id, label }];
  });
}

export function executionLanguageForEditorLanguage(
  language?: string,
  supportedLanguages: readonly ExecutionLanguageOption[] = EXECUTION_LANGUAGES
): ExecutionLanguage | null {
  if (!language || !isExecutionLanguage(language)) {
    return null;
  }
  return supportedLanguages.some((option) => option.id === language) ? language : null;
}

export function inferLanguage(path: string) {
  const extension = path.split('.').pop()?.toLowerCase() ?? '';
  return LANGUAGE_BY_EXTENSION[extension] ?? 'plaintext';
}

// For styling the language badge in the file explorer
export function languageClass(language: string) {
  if (language === 'java' || language === 'typescript' || language === 'c' || language === 'cpp') {
    return 'dot-blue';
  }
  if (language === 'javascript' || language === 'json' || language === 'yaml') {
    return 'dot-amber';
  }
  if (language === 'python' || language === 'sql' || language === 'shell') {
    return 'dot-green';
  }
  if (language === 'html' || language === 'css' || language === 'scss' || language === 'markdown' || language === 'xml') {
    return 'dot-purple';
  }
  return 'dot-neutral';
}
