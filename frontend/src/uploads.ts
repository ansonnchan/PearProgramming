import { inferLanguage } from './language';

export type UploadCandidate = {
  path: string;
  language: string;
  content: string;
};

export type SkippedUpload = {
  path: string;
  reason: string;
};

export type UploadReadResult = {
  candidates: UploadCandidate[];
  skipped: SkippedUpload[];
  totalFiles: number;
};

const MAX_UPLOAD_FILES = 300;
const MAX_UPLOAD_BYTES = 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set([
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
const ALLOWED_FILENAMES = new Set(['.env.example']);
const BLOCKED_PATH_SEGMENTS = new Set(['.git', '.hg', '.svn', 'node_modules', 'dist', 'build', 'target', '.idea']);
const BLOCKED_FILENAMES = new Set(['.ds_store', 'thumbs.db', 'desktop.ini']);
export const UPLOAD_ACCEPT = [
  ...Array.from(ALLOWED_EXTENSIONS, (extension) => `.${extension}`),
  ...Array.from(ALLOWED_FILENAMES)
].join(',');

const BLOCKED_EXTENSIONS = new Set([
  '7z',
  'app',
  'bin',
  'class',
  'dll',
  'dmg',
  'exe',
  'gif',
  'gz',
  'ico',
  'jar',
  'jpeg',
  'jpg',
  'mov',
  'mp3',
  'mp4',
  'pdf',
  'png',
  'rar',
  'tar',
  'wasm',
  'webp',
  'zip'
]);

export async function readUploadCandidates(fileList: FileList): Promise<UploadReadResult> {
  const files = Array.from(fileList);
  const skipped: SkippedUpload[] = [];
  const accepted: Array<{ file: File; path: string }> = [];

  for (const file of files) {
    const path = normalizeUploadPath((file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name);
    const blockedReason = blockedReasonFor(file, path);
    if (blockedReason) {
      skipped.push({ path: path || file.name, reason: blockedReason });
      continue;
    }

    if (accepted.length >= MAX_UPLOAD_FILES) {
      skipped.push({ path, reason: `Only the first ${MAX_UPLOAD_FILES} supported files can be uploaded at once.` });
      continue;
    }

    accepted.push({ file, path });
  }

  const candidates = await Promise.all(accepted.map(async ({ file, path }) => {
    return {
      path,
      language: inferLanguage(path),
      content: await file.text()
    };
  }));

  return {
    candidates: dedupeByPath(candidates).sort((a, b) => a.path.localeCompare(b.path)),
    skipped,
    totalFiles: files.length
  };
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

function blockedReasonFor(file: File, path: string) {
  if (!path) {
    return 'This file has no readable path.';
  }

  const parts = path.toLowerCase().split('/').filter(Boolean);
  const name = parts[parts.length - 1] ?? '';
  const extension = name.includes('.') ? name.split('.').pop() ?? '' : '';

  if (parts.some((part) => BLOCKED_PATH_SEGMENTS.has(part) || part.endsWith('.app'))) {
    return 'Project build, dependency, source-control, and app bundle folders are skipped.';
  }

  if (BLOCKED_FILENAMES.has(name)) {
    return 'System files are skipped.';
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return 'Files must be 1 MB or smaller.';
  }

  if (BLOCKED_EXTENSIONS.has(extension)) {
    return 'Binary, executable, archive, and media files are skipped.';
  }

  if (ALLOWED_FILENAMES.has(name) || ALLOWED_EXTENSIONS.has(extension)) {
    return null;
  }

  return 'Only supported code and text project files can be uploaded.';
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
