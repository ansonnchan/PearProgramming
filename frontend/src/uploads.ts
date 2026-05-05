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

const MAX_UPLOAD_FILES = 1500;
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set([
  'adoc',
  'astro',
  'bash',
  'bat',
  'c',
  'cc',
  'cjs',
  'cmd',
  'conf',
  'config',
  'cpp',
  'cs',
  'csv',
  'css',
  'cxx',
  'dart',
  'env',
  'gif',
  'go',
  'h',
  'hh',
  'hpp',
  'htm',
  'html',
  'hxx',
  'ico',
  'ini',
  'java',
  'jpeg',
  'jpg',
  'js',
  'json',
  'jsonc',
  'jsx',
  'kt',
  'kts',
  'less',
  'lua',
  'm',
  'mjs',
  'mm',
  'md',
  'markdown',
  'mdx',
  'php',
  'png',
  'properties',
  'ps1',
  'py',
  'r',
  'rb',
  'rs',
  'rst',
  'sass',
  'scala',
  'scss',
  'sh',
  'sql',
  'svg',
  'svelte',
  'swift',
  'toml',
  'ts',
  'tsv',
  'tsx',
  'txt',
  'vue',
  'webp',
  'xml',
  'yaml',
  'yml'
]);
const ALLOWED_FILENAMES = new Set([
  '.dockerignore',
  '.env',
  '.env.example',
  '.gitignore',
  'bun.lockb',
  'dockerfile',
  'docker-compose.yaml',
  'docker-compose.yml',
  'makefile',
  'package-lock.json',
  'package.json',
  'pnpm-lock.yaml',
  'readme',
  'readme.md',
  'tsconfig.json',
  'vite.config.js',
  'vite.config.ts',
  'next.config.js',
  'next.config.ts',
  'yarn.lock'
]);
const BLOCKED_PATH_SEGMENTS = new Set([
  '.cache',
  '.git',
  '.hg',
  '.next',
  '.svn',
  '.turbo',
  'bower_components',
  'build',
  'coverage',
  'dist',
  'jspm_packages',
  'node_modules',
  'out',
  'target',
  '__pycache__'
]);
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
  'gz',
  'iso',
  'jar',
  'msi',
  'o',
  'obj',
  'pkg',
  'pyc',
  'pyo',
  'mov',
  'mp3',
  'mp4',
  'pdf',
  'rar',
  'so',
  'tar',
  'wasm',
  'zip'
]);
const IMAGE_EXTENSIONS = new Set(['gif', 'ico', 'jpeg', 'jpg', 'png', 'svg', 'webp']);

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
    const extension = extensionForPath(path);
    return {
      path,
      language: inferLanguage(path),
      content: await readCandidateContent(file, extension)
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
  const extension = extensionForPath(name);

  if (parts.some((part) => BLOCKED_PATH_SEGMENTS.has(part) || part.endsWith('.app'))) {
    return 'Project build, dependency, source-control, and app bundle folders are skipped.';
  }

  if (BLOCKED_FILENAMES.has(name) || name.startsWith('._')) {
    return 'System files are skipped.';
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return 'Files must be 5 MB or smaller.';
  }

  if (BLOCKED_EXTENSIONS.has(extension)) {
    return 'Binary, executable, archive, and media files are skipped.';
  }

  if (file.size === 0 && name.startsWith('.') && !ALLOWED_FILENAMES.has(name)) {
    return 'Empty hidden metadata files are skipped.';
  }

  return null;
}

function extensionForPath(path: string) {
  const name = path.split('/').pop()?.toLowerCase() ?? path.toLowerCase();
  if (name.startsWith('.') && name.indexOf('.', 1) < 0) {
    return name.slice(1);
  }
  return name.includes('.') ? name.split('.').pop() ?? '' : '';
}

function readCandidateContent(file: File, extension: string) {
  if (IMAGE_EXTENSIONS.has(extension)) {
    return fileToDataUrl(file);
  }
  return file.text();
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(String(reader.result ?? '')));
    reader.addEventListener('error', () => reject(reader.error));
    reader.readAsDataURL(file);
  });
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
