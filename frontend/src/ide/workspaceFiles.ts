import { inferLanguage } from '../language';
import type { UploadCandidate, UploadReadResult } from '../uploads';
import type { WorkspaceFile } from '../types';

export function resolveCreateItemTarget(kind: 'file' | 'folder', rawName: string, existingPaths: string[]) {
  if (!rawName) return { error: `${kind === 'folder' ? 'Folder' : 'File'} name is required.` };
  if (/[\\/]/.test(rawName)) return { error: 'Use a single name without path separators.' };
  if (kind === 'folder') return { path: uniqueFolderPath(existingPaths, rawName) };
  const { baseName, extension } = splitFileName(rawName);
  return { path: uniqueFilePath(existingPaths, baseName || 'new-file', extension || 'txt') };
}

export function uniqueStrings(values: string[]) {
  return [...new Set(values)];
}

export function basename(path: string) {
  const parts = path.split('/');
  return parts[parts.length - 1] ?? path;
}

export function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function createLocalFile(path: string, workspaceId: string, createdById?: string): WorkspaceFile {
  return {
    id: crypto.randomUUID(), workspaceId, path, language: inferLanguage(path), content: '',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), createdById
  };
}

export function createLocalFileFromCandidate(candidate: UploadCandidate, workspaceId: string, createdById?: string): WorkspaceFile {
  return {
    id: crypto.randomUUID(), workspaceId, path: candidate.path, language: candidate.language, content: candidate.content,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), createdById
  };
}

export function mergeFiles(current: WorkspaceFile[], incoming: WorkspaceFile[]) {
  const byPath = new Map<string, WorkspaceFile>();
  current.forEach((file) => byPath.set(file.path, file));
  incoming.forEach((file) => byPath.set(file.path, file));
  return [...byPath.values()];
}

export function sortByPath(a: WorkspaceFile, b: WorkspaceFile) {
  return a.path.localeCompare(b.path);
}

export function foldersForPaths(paths: string[]) {
  const folders = new Set<string>();
  for (const path of paths) {
    const parts = path.split('/').filter(Boolean);
    let folder = '';
    for (let index = 0; index < parts.length - 1; index += 1) {
      folder = folder ? `${folder}/${parts[index]}` : parts[index];
      folders.add(folder);
    }
  }
  return folders;
}

export function uploadNoticeText(result: UploadReadResult) {
  const renameText = result.renamedCount > 0
    ? ` Renamed ${result.renamedCount} duplicate file${result.renamedCount === 1 ? '' : 's'} to avoid overwriting existing files.`
    : '';
  if (result.skipped.length === 0) {
    const base = result.candidates.length === 1 ? 'Selected 1 supported file.' : `Selected ${result.candidates.length} supported files.`;
    return `${base}${renameText}`;
  }
  const examples = result.skipped.slice(0, 3).map((item) => basename(item.path)).join(', ');
  const suffix = result.skipped.length > 3 ? ', and more' : '';
  const skippedText = `Skipped ${result.skipped.length} unsupported file${result.skipped.length === 1 ? '' : 's'}${examples ? `: ${examples}${suffix}` : ''}.`;
  if (result.candidates.length === 0) return `No supported code files found. ${skippedText}`;
  return `Selected ${result.candidates.length} supported file${result.candidates.length === 1 ? '' : 's'}. ${skippedText}${renameText}`;
}

export function configureFolderInput(input: HTMLInputElement) {
  const folderInput = input as HTMLInputElement & { webkitdirectory?: boolean; directory?: boolean };
  folderInput.webkitdirectory = true;
  folderInput.directory = true;
  for (const attribute of ['webkitdirectory', 'directory', 'mozdirectory', 'msdirectory', 'odirectory']) {
    input.setAttribute(attribute, '');
  }
}

function splitFileName(value: string) {
  const trimmed = value.trim();
  const lastDot = trimmed.lastIndexOf('.');
  if (lastDot <= 0 || lastDot === trimmed.length - 1) return { baseName: trimmed, extension: '' };
  return { baseName: trimmed.slice(0, lastDot), extension: trimmed.slice(lastDot + 1) };
}

function uniqueFilePath(existingPaths: string[], basenameWithoutExtension: string, extension: string) {
  const existing = new Set(existingPaths);
  const suffix = extension ? `.${extension.replace(/^\./, '')}` : '';
  let candidate = `${basenameWithoutExtension}${suffix}`;
  let index = 2;
  while (existing.has(candidate)) candidate = `${basenameWithoutExtension}-${index++}${suffix}`;
  return candidate;
}

function uniqueFolderPath(existingPaths: string[], basename: string) {
  const existingFolders = foldersForPaths(existingPaths);
  let candidate = basename;
  let index = 2;
  while (existingFolders.has(candidate) || existingPaths.some((path) => path === candidate || path.startsWith(`${candidate}/`))) {
    candidate = `${basename}-${index++}`;
  }
  return candidate;
}
