import { inferLanguage } from './language';

export type UploadCandidate = {
  path: string;
  language: string;
  content: string;
};

const MAX_UPLOAD_FILES = 300;
const MAX_UPLOAD_BYTES = 1024 * 1024;
const TEXT_EXTENSIONS = new Set([
  'c',
  'cc',
  'cpp',
  'css',
  'cxx',
  'h',
  'hh',
  'hpp',
  'htm',
  'html',
  'hxx',
  'java',
  'js',
  'json',
  'jsx',
  'md',
  'markdown',
  'py',
  'sql',
  'ts',
  'tsx',
  'txt',
  'xml',
  'yaml',
  'yml'
]);

export async function readUploadCandidates(fileList: FileList): Promise<UploadCandidate[]> {
  const files = [...fileList]
    .filter((file) => file.size <= MAX_UPLOAD_BYTES && isTextLike(file))
    .slice(0, MAX_UPLOAD_FILES);

  const candidates = await Promise.all(files.map(async (file) => {
    const path = normalizeUploadPath((file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name);
    return {
      path,
      language: inferLanguage(path),
      content: await file.text()
    };
  }));

  return dedupeByPath(candidates).sort((a, b) => a.path.localeCompare(b.path));
}

export function projectNameForPaths(paths: string[]) {
  const cleanPaths = paths.map(normalizeUploadPath).filter(Boolean);
  if (cleanPaths.length === 0) {
    return 'Selected files';
  }

  const firstParts = cleanPaths[0].split('/');
  if (firstParts.length > 1 && cleanPaths.every((path) => path.split('/')[0] === firstParts[0])) {
    return firstParts[0];
  }

  return cleanPaths.length === 1 ? cleanPaths[0].split('/').pop() ?? 'Selected file' : 'Selected files';
}

export function normalizeUploadPath(path: string) {
  return path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/+/, '').trim();
}

function isTextLike(file: File) {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  return file.type.startsWith('text/') || file.type.includes('json') || TEXT_EXTENSIONS.has(extension);
}

function dedupeByPath(candidates: UploadCandidate[]) {
  const byPath = new Map<string, UploadCandidate>();
  for (const candidate of candidates) {
    if (candidate.path) {
      byPath.set(candidate.path, candidate);
    }
  }
  return [...byPath.values()];
}
