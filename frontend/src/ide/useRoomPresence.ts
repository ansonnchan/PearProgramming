import type { Client } from '@stomp/stompjs';
import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { projectNameForPaths } from '../uploads';
import type { Member, Room, WorkspaceFile } from '../types';
import { displayNameOrPear, type MemberRealtimeEvent } from './presence';

type UseRoomPresenceOptions = {
  addSystemMessage: (message: string) => void;
  connectionId: string;
  files: WorkspaceFile[];
  getClient: () => Client | null;
  onConnected: (client: Client) => void;
  onCursorLeft: (userId: string) => void;
  onRoomClosed: (notice: string) => void;
  room: Room | null;
  user: Member;
  userRef: MutableRefObject<Member>;
};

export function useRoomPresence({
  addSystemMessage,
  connectionId,
  files,
  getClient,
  onConnected,
  onCursorLeft,
  onRoomClosed,
  room,
  user,
  userRef
}: UseRoomPresenceOptions) {
  const [presenceMembers, setPresenceMembers] = useState<Record<string, Member>>({});
  const [leadUserId, setLeadUserId] = useState<string | null>(null);
  const [roomLocked, setRoomLocked] = useState(false);
  const leadUserIdRef = useRef<string | null>(null);
  const roomLockedRef = useRef(false);

  useEffect(() => {
    leadUserIdRef.current = leadUserId;
  }, [leadUserId]);

  useEffect(() => {
    roomLockedRef.current = roomLocked;
  }, [roomLocked]);

  function handleConnected(client: Client) {
    if (!room) return;
    const currentUser = userRef.current;
    client.publish({
      destination: `/app/room/${room.code}/members`,
      body: JSON.stringify({
        type: 'joined', userId: currentUser.id, sessionId: currentUser.id, connectionId,
        displayName: currentUser.name, color: currentUser.color, avatarUrl: currentUser.avatarUrl,
        leadUserId: leadUserIdRef.current, locked: roomLockedRef.current, at: new Date().toISOString()
      })
    });
    onConnected(client);
  }

  function handleHeartbeat(client: Client) {
    if (!room) return;
    const currentUser = userRef.current;
    client.publish({
      destination: `/app/room/${room.code}/members`,
      body: JSON.stringify({
        type: 'presence-sync', userId: currentUser.id, sessionId: currentUser.id, connectionId,
        displayName: currentUser.name, color: currentUser.color, avatarUrl: currentUser.avatarUrl,
        leadUserId: leadUserIdRef.current, locked: roomLockedRef.current, targetUserId: currentUser.id,
        at: new Date().toISOString()
      })
    });
  }

  function publishMemberEvent(event: MemberRealtimeEvent) {
    const client = getClient();
    if (!room || !client?.connected) return;
    client.publish({ destination: `/app/room/${room.code}/members`, body: JSON.stringify(event) });
  }

  function publishLeftMemberEvent() {
    publishMemberEvent({
      type: 'left', userId: userRef.current.id, sessionId: userRef.current.id, connectionId,
      displayName: userRef.current.name, color: userRef.current.color, avatarUrl: userRef.current.avatarUrl,
      leadUserId: leadUserIdRef.current ?? undefined, locked: roomLockedRef.current, at: new Date().toISOString()
    });
  }

  function handleMemberEvent(event: MemberRealtimeEvent, client: Client) {
    if (!event.userId) return;
    if (event.type === 'room-closed') {
      if (event.userId !== user.id) onRoomClosed('The Lead Pear closed this room.');
      return;
    }
    if (typeof event.locked === 'boolean') setRoomLocked(event.locked);

    if (event.type === 'lead-transferred' || event.type === 'lead-sync' || event.type === 'lead-removed') {
      if (event.type === 'lead-removed') {
        setLeadUserId(null);
        addSystemMessage(`${displayNameOrPear(event.displayName)} removed ${displayNameOrPear(event.targetUserName)} from Lead Pear`);
        return;
      }
      if (!event.targetUserId || event.targetUserId === user.id || event.type === 'lead-transferred') {
        setLeadUserId(event.leadUserId ?? event.targetUserId ?? event.userId);
      }
      if (event.type === 'lead-transferred') {
        addSystemMessage(`${displayNameOrPear(event.displayName)} designated ${displayNameOrPear(event.targetUserName)} as Lead Pear`);
        if (event.targetUserName) addSystemMessage(`${displayNameOrPear(event.targetUserName)} is now the Lead Pear`);
      }
      return;
    }
    if (event.type === 'lock-changed') {
      addSystemMessage(event.locked ? `${displayNameOrPear(event.displayName)} has locked the room` : `${displayNameOrPear(event.displayName)} has unlocked the room`);
      return;
    }
    if (event.type === 'left') {
      if (event.leadUserId) setLeadUserId(event.leadUserId);
      if (event.userId !== user.id) addSystemMessage(`${displayNameOrPear(event.displayName)} has left the room`);
      setPresenceMembers((current) => {
        const next = { ...current };
        delete next[event.userId];
        return next;
      });
      onCursorLeft(event.userId);
      return;
    }
    if (event.leadUserId && !leadUserIdRef.current) setLeadUserId(event.leadUserId);
    if (event.userId !== user.id && (event.type === 'joined' || event.type === 'presence-sync')) {
      setPresenceMembers((current) => ({
        ...current,
        [event.userId]: {
          id: event.userId, name: event.displayName || 'Guest', color: event.color || '#378ADD', avatarUrl: event.avatarUrl
        }
      }));
    }
    if (event.type !== 'joined' || event.userId === user.id || !room) return;

    client.publish({
      destination: `/app/room/${room.code}/members`,
      body: JSON.stringify({
        type: 'presence-sync', userId: user.id, sessionId: user.id, connectionId,
        displayName: user.name, color: user.color, avatarUrl: user.avatarUrl,
        leadUserId: leadUserIdRef.current, locked: roomLockedRef.current, targetUserId: event.userId,
        at: new Date().toISOString()
      })
    });
    if (leadUserIdRef.current === user.id && files.length > 0) {
      const projectName = projectNameForPaths(files.map((file) => file.path));
      client.publish({
        destination: `/app/room/${room.code}/project-switch`,
        body: JSON.stringify({
          type: 'sync', proposalId: crypto.randomUUID(), currentFolder: projectName, newFolder: projectName,
          proposerId: user.id, proposerName: user.name, targetUserId: event.userId, files,
          replaceExisting: true, openUploaded: false, at: new Date().toISOString()
        })
      });
    }
    if (leadUserIdRef.current === user.id) {
      client.publish({
        destination: `/app/room/${room.code}/members`,
        body: JSON.stringify({
          type: 'lead-sync', userId: user.id, sessionId: user.id, connectionId,
          displayName: user.name, color: user.color, avatarUrl: user.avatarUrl,
          leadUserId: user.id, locked: roomLockedRef.current, targetUserId: event.userId,
          at: new Date().toISOString()
        })
      });
    }
  }

  function resetPresence(nextRoom?: Room) {
    setPresenceMembers({});
    setLeadUserId(nextRoom?.leadUserId ?? null);
    setRoomLocked(nextRoom?.locked ?? false);
  }

  return {
    handleConnected,
    handleHeartbeat,
    handleMemberEvent,
    leadUserId,
    leadUserIdRef,
    presenceMembers,
    publishLeftMemberEvent,
    publishMemberEvent,
    resetPresence,
    roomLocked,
    roomLockedRef,
    setLeadUserId,
    setRoomLocked
  };
}
