const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  c: 'c',
  cc: 'cpp',
  cpp: 'cpp',
  css: 'css',
  cxx: 'cpp',
  h: 'c',
  hh: 'cpp',
  hpp: 'cpp',
  htm: 'html',
  html: 'html',
  hxx: 'cpp',
  java: 'java',
  js: 'javascript',
  json: 'json',
  jsx: 'javascript',
  md: 'markdown',
  markdown: 'markdown',
  py: 'python',
  sql: 'sql',
  ts: 'typescript',
  tsx: 'typescript'
};

export function inferLanguage(path: string) {
  const extension = path.split('.').pop()?.toLowerCase() ?? '';
  return LANGUAGE_BY_EXTENSION[extension] ?? 'plaintext';
}

export function languageClass(language: string) {
  if (language === 'java' || language === 'typescript' || language === 'c' || language === 'cpp') {
    return 'dot-blue';
  }
  if (language === 'javascript' || language === 'json') {
    return 'dot-amber';
  }
  if (language === 'python' || language === 'sql') {
    return 'dot-green';
  }
  if (language === 'html' || language === 'css' || language === 'markdown') {
    return 'dot-purple';
  }
  return 'dot-neutral';
}
