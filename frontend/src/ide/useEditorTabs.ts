import { useEffect, useRef, useState } from 'react';
import type { WorkspaceFile } from '../types';

type ReconcileTabsOptions = {
  currentActiveFileId: string | null;
  currentOpenFileIds: string[];
  nextFiles: WorkspaceFile[];
  openUploaded: boolean;
  replaceExisting: boolean;
  uploadedFiles: WorkspaceFile[];
};

export function reconcileEditorTabs({
  currentActiveFileId,
  currentOpenFileIds,
  nextFiles,
  openUploaded,
  replaceExisting,
  uploadedFiles
}: ReconcileTabsOptions) {
  const nextFileIds = new Set(nextFiles.map((file) => file.id));
  const uploadedIds = uploadedFiles.map((file) => file.id).filter((fileId) => nextFileIds.has(fileId));
  const retainedOpenIds = currentOpenFileIds.filter((fileId) => nextFileIds.has(fileId));
  const requestedOpenIds = openUploaded
    ? replaceExisting
      ? uploadedIds
      : uniqueStrings([...retainedOpenIds, ...uploadedIds])
    : retainedOpenIds;
  const openFileIds = openUploaded && requestedOpenIds.length === 0 && nextFiles[0]
    ? [nextFiles[0].id]
    : requestedOpenIds;
  const previousActiveIndex = currentActiveFileId ? currentOpenFileIds.indexOf(currentActiveFileId) : -1;
  const activeFileId = openUploaded
    ? uploadedIds[0] ?? openFileIds[0] ?? null
    : openFileIds.includes(currentActiveFileId ?? '')
      ? currentActiveFileId
      : openFileIds[Math.max(0, previousActiveIndex)] ?? openFileIds[Math.max(0, previousActiveIndex - 1)] ?? null;

  return { activeFileId, openFileIds };
}

export function restoreEditorTabs(files: WorkspaceFile[], restoredOpenFileIds: string[] = [], restoredActiveFileId: string | null = null) {
  const fileIds = new Set(files.map((file) => file.id));
  const openFileIds = restoredOpenFileIds.filter((fileId) => fileIds.has(fileId));
  const activeFileId = restoredActiveFileId && fileIds.has(restoredActiveFileId)
    ? restoredActiveFileId
    : openFileIds[0] ?? files[0]?.id ?? null;
  return {
    activeFileId,
    openFileIds: openFileIds.length > 0 ? openFileIds : activeFileId ? [activeFileId] : []
  };
}

export function useEditorTabs(files: WorkspaceFile[]) {
  const [openFileIds, setOpenFileIds] = useState<string[]>([]);
  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const openFileIdsRef = useRef<string[]>([]);
  const activeFileIdRef = useRef<string | null>(null);
  const openFiles = openFileIds
    .map((fileId) => files.find((file) => file.id === fileId))
    .filter((file): file is WorkspaceFile => Boolean(file));
  const activeFile = openFiles.find((file) => file.id === activeFileId) ?? null;

  useEffect(() => {
    activeFileIdRef.current = activeFileId;
  }, [activeFileId]);

  useEffect(() => {
    openFileIdsRef.current = openFileIds;
  }, [openFileIds]);

  function applyTabState(next: { activeFileId: string | null; openFileIds: string[] }) {
    activeFileIdRef.current = next.activeFileId;
    openFileIdsRef.current = next.openFileIds;
    setActiveFileId(next.activeFileId);
    setOpenFileIds(next.openFileIds);
    return next;
  }

  function openFileTab(fileId: string) {
    const openIds = openFileIdsRef.current.includes(fileId)
      ? openFileIdsRef.current
      : [...openFileIdsRef.current, fileId];
    applyTabState({ activeFileId: fileId, openFileIds: openIds });
  }

  function closeFileTab(fileId: string) {
    const index = openFileIdsRef.current.indexOf(fileId);
    const openIds = openFileIdsRef.current.filter((id) => id !== fileId);
    const nextActiveId = activeFileIdRef.current === fileId
      ? openIds[index] ?? openIds[index - 1] ?? null
      : activeFileIdRef.current;
    applyTabState({ activeFileId: nextActiveId, openFileIds: openIds });
  }

  return {
    activeFile,
    activeFileId,
    activeFileIdRef,
    applyTabState,
    closeFileTab,
    openFileIds,
    openFileIdsRef,
    openFiles,
    openFileTab,
    setActiveFileId
  };
}

function uniqueStrings(values: string[]) {
  return [...new Set(values)];
}
