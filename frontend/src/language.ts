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
