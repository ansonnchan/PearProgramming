import type { ReactNode } from 'react';
import type { MentionOption } from '../components/chat/ChatPanel';
import type { Member } from '../types';

export type MemberRealtimeEvent = {
  type: 'joined' | 'left' | 'presence-sync' | 'presence-snapshot' | 'lead-sync' | 'lead-transferred' | 'lead-removed' | 'lock-changed' | 'room-closed';
  userId: string;
  sessionId?: string;
  connectionId?: string;
  displayName?: string;
  color?: string;
  avatarUrl?: string;
  leadUserId?: string;
  targetUserId?: string;
  targetUserName?: string;
  locked?: boolean;
  at?: string;
  members?: Array<{ userId: string; displayName: string; color: string }>;
  presenceVersion?: number;
};

export function reconcilePresenceSnapshot(
  event: MemberRealtimeEvent,
  currentVersion: number,
  currentUserId: string,
  currentMembers: Record<string, Member> = {}
) {
  const version = event.presenceVersion ?? 0;
  if (event.type !== 'presence-snapshot' || !Array.isArray(event.members) || version <= currentVersion) {
    return null;
  }

  const members: Record<string, Member> = {};
  for (const member of event.members) {
    if (!member.userId || member.userId === currentUserId) continue;
    const avatarUrl = currentMembers[member.userId]?.avatarUrl;
    members[member.userId] = {
      id: member.userId,
      name: member.displayName || 'Guest',
      color: member.color || '#378ADD',
      ...(avatarUrl ? { avatarUrl } : {})
    };
  }
  return { members, version };
}

export function buildMentionOptions(members: Member[]): MentionOption[] {
  const totals = new Map<string, number>();
  for (const member of members) {
    const base = mentionBaseLabel(member);
    totals.set(base, (totals.get(base) ?? 0) + 1);
  }
  return members.map((member) => {
    const base = mentionBaseLabel(member);
    const label = totals.get(base) === 1 ? base : `${base}-${member.id.slice(0, 4)}`;
    return { id: member.id, label, name: member.name, color: member.color, ai: member.ai };
  });
}

export function invalidMentionLabels(content: string, options: MentionOption[]) {
  const labels = new Set(options.map((option) => option.label.toLowerCase()));
  return [...content.matchAll(/(^|\s)@([A-Za-z0-9_-]+)/g)]
    .map((match) => match[2])
    .filter((label) => !labels.has(label.toLowerCase()));
}

export function messageMentionsUser(content: string, user: Member, options: MentionOption[]) {
  const option = options.find((item) => item.id === user.id);
  if (!option) return false;
  return [...content.matchAll(/(^|\s)@([A-Za-z0-9_-]+)/g)]
    .some((match) => match[2].toLowerCase() === option.label.toLowerCase());
}

export function renderMessageContent(content: string, options: MentionOption[], onMentionClick: (option: MentionOption) => void) {
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  for (const match of content.matchAll(/(^|\s)@([A-Za-z0-9_-]+)/g)) {
    const matchIndex = match.index ?? 0;
    const leading = match[1] ?? '';
    const label = match[2];
    const mentionIndex = matchIndex + leading.length;
    if (mentionIndex > lastIndex) parts.push(content.slice(lastIndex, mentionIndex));
    const option = options.find((item) => item.label.toLowerCase() === label.toLowerCase());
    if (option) {
      parts.push(
        <button className="mention-token" key={`${label}-${mentionIndex}`} onClick={() => onMentionClick(option)} type="button">
          @{option.label}
        </button>
      );
    } else {
      parts.push(`@${label}`);
    }
    lastIndex = mentionIndex + label.length + 1;
  }
  if (lastIndex < content.length) parts.push(content.slice(lastIndex));
  return parts;
}

export function uniqueMembers(members: Member[]) {
  const unique = new Map<string, Member>();
  for (const member of members) {
    if (member.id) unique.set(member.id, member);
  }
  return [...unique.values()];
}

export function displayNameOrPear(name?: string) {
  return name?.trim() || 'A pear';
}

export function messageMentionsPearAi(content: string) {
  return /(^|\s)@pearai\b/i.test(content);
}

function mentionBaseLabel(member: Member) {
  if (member.ai) return 'PearAI';
  const normalized = member.name.trim().replace(/\s+/g, '').replace(/[^A-Za-z0-9_-]/g, '');
  return normalized || `user-${member.id.slice(0, 4)}`;
}
