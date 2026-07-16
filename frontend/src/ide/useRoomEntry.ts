import { useCallback, useEffect, useRef, useState } from 'react';
import { API_BASE_URL, ApiError, createRoom, getRoom, getRoomAccess, getRoomFiles, joinRoom } from '../api';
import type { Member, Room, RoomSessionState, WorkspaceFile } from '../types';
import { fileToDataUrl, isAllowedProfileImage } from './profileImage';
import { getJoinCode, isValidRoomCode, loadRoomSession, normalizeRoomCode } from './roomSession';

type PendingRoomAction = 'create' | 'join';

type UseRoomEntryOptions = {
  authReady: boolean;
  onOpenRoom: (room: Room, files: WorkspaceFile[], replaceUrl: boolean, restoredState?: RoomSessionState) => void;
  onToast: (message: string) => void;
  signIn: (displayName: string, avatarUrl?: string) => Promise<unknown>;
  user: Member;
};

export function useRoomEntry({ authReady, onOpenRoom, onToast, signIn, user }: UseRoomEntryOptions) {
  const [landingCode, setLandingCode] = useState('');
  const [landingError, setLandingError] = useState('');
  const [landingNotice, setLandingNotice] = useState('');
  const [creatingRoom, setCreatingRoom] = useState(false);
  const [joiningRoom, setJoiningRoom] = useState(false);
  const [pendingRoomAction, setPendingRoomAction] = useState<PendingRoomAction | null>(null);
  const [entryProfileOpen, setEntryProfileOpen] = useState(false);
  const [entryProfileName, setEntryProfileName] = useState('');
  const [entryProfileAvatar, setEntryProfileAvatar] = useState<string | undefined>();
  const [entryProfileError, setEntryProfileError] = useState('');
  const entryAvatarInputRef = useRef<HTMLInputElement | null>(null);
  const bootstrappedRoomRef = useRef(false);
  const onOpenRoomRef = useRef(onOpenRoom);
  const onToastRef = useRef(onToast);
  onOpenRoomRef.current = onOpenRoom;
  onToastRef.current = onToast;

  const handleJoinRoom = useCallback(async (rawCode: string, replaceUrl = true) => {
    const code = normalizeRoomCode(rawCode);
    if (!isValidRoomCode(code)) {
      setLandingError('Please enter in a valid pear room code');
      return;
    }
    setJoiningRoom(true);
    setLandingError('');
    setLandingNotice('');
    try {
      const access = await getRoomAccess(code);
      if (!access.canJoin) {
        if (access.reason === 'locked') onToastRef.current('Room is Locked. Contact the room owner if this is a mistake.');
        else if (access.reason === 'not_found') setLandingError(`Room ${code} has expired or was closed.`);
        else setLandingError('Room is Full.');
        return;
      }
      await joinRoom(code);
      const joinedRoom = await getRoom(code);
      const roomFiles = await getRoomFiles(code).catch(() => []);
      onOpenRoomRef.current(joinedRoom, roomFiles, replaceUrl);
    } catch (error) {
      console.warn('Join room failed', { apiBaseUrl: API_BASE_URL, code, error });
      setLandingError(error instanceof ApiError && error.status === 404
        ? `Room ${code} was not found. No new room was created.`
        : `Could not join this room. The frontend tried ${API_BASE_URL}.`);
    } finally {
      setJoiningRoom(false);
    }
  }, []);

  const handleCreateRoom = useCallback(async () => {
    setCreatingRoom(true);
    setLandingError('');
    setLandingNotice('');
    try {
      const createResponse = await createRoom();
      const createdRoom = await getRoom(createResponse.code);
      onOpenRoomRef.current(createdRoom, [], true);
    } catch (error) {
      console.warn('Create room failed', { apiBaseUrl: API_BASE_URL, error });
      setLandingError(`Could not create a shared room. The frontend tried ${API_BASE_URL}.`);
    } finally {
      setCreatingRoom(false);
    }
  }, []);

  useEffect(() => {
    if (!authReady || bootstrappedRoomRef.current) return;
    bootstrappedRoomRef.current = true;
    const joinCode = getJoinCode();
    const savedSession = loadRoomSession();
    if (user.id && savedSession?.room?.code && (!joinCode || normalizeRoomCode(joinCode) === savedSession.room.code)) {
      onOpenRoomRef.current(savedSession.room, savedSession.files, false, savedSession);
      void (async () => {
        try {
          await joinRoom(savedSession.room.code);
          const freshRoom = await getRoom(savedSession.room.code);
          const roomFiles = await getRoomFiles(savedSession.room.code);
          onOpenRoomRef.current(freshRoom, roomFiles, false, savedSession);
        } catch {
          onToastRef.current('Restored your room locally while the hosted services reconnect.');
        }
      })();
      return;
    }
    if (joinCode) {
      const code = normalizeRoomCode(joinCode);
      setLandingCode(code);
      requestRoomEntry('join', code);
    }
  }, [authReady, user.id]);

  function requestRoomEntry(action: PendingRoomAction, codeOverride = landingCode) {
    if (action === 'join') {
      const code = normalizeRoomCode(codeOverride);
      if (!isValidRoomCode(code)) {
        setLandingError('Please enter in a valid pear room code');
        return;
      }
      setLandingCode(code);
    }
    setPendingRoomAction(action);
    setEntryProfileName(user.name === 'You' ? '' : user.name);
    setEntryProfileAvatar(user.avatarUrl);
    setEntryProfileError('');
    setEntryProfileOpen(true);
  }

  function closeEntryProfile() {
    setEntryProfileOpen(false);
    setPendingRoomAction(null);
    setEntryProfileError('');
  }

  async function handleEntryAvatarInput(input: HTMLInputElement) {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (!isAllowedProfileImage(file)) {
      setEntryProfileError('Profile picture must be a JPG, PNG, or WEBP image.');
      return;
    }
    setEntryProfileError('');
    setEntryProfileAvatar(await fileToDataUrl(file));
  }

  async function confirmEntryProfile() {
    const displayName = entryProfileName.trim();
    if (!displayName) {
      setEntryProfileError('Display name is required.');
      return;
    }
    const action = pendingRoomAction;
    try {
      await signIn(displayName, entryProfileAvatar);
    } catch {
      setEntryProfileError('Could not create a secure session. Try again.');
      return;
    }
    closeEntryProfile();
    if (action === 'create') await handleCreateRoom();
    if (action === 'join') await handleJoinRoom(landingCode);
  }

  function resetLanding(notice = '') {
    setLandingCode('');
    setLandingError('');
    setLandingNotice(notice);
  }

  return {
    closeEntryProfile,
    confirmEntryProfile,
    creatingRoom,
    entryAvatarInputRef,
    entryProfileAvatar,
    entryProfileError,
    entryProfileName,
    entryProfileOpen,
    handleEntryAvatarInput,
    joiningRoom,
    landingCode,
    landingError,
    landingNotice,
    pendingRoomAction,
    requestRoomEntry,
    resetLanding,
    setEntryProfileName,
    setLandingCode,
    setLandingNotice
  };
}
