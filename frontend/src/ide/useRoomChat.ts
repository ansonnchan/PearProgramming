import type { Client } from '@stomp/stompjs';
import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { DisplayChatMessage, MentionOption } from '../components/chat/ChatPanel';
import { insertMentionText } from '../components/chat/mention';
import { listChatHistory } from '../api';
import type { ChatMessage, Member, Room, WorkspaceFile } from '../types';
import { displayNameOrPear, invalidMentionLabels, messageMentionsPearAi, messageMentionsUser } from './presence';
import { formatPacificTime } from './roomSession';

type UseRoomChatOptions = {
  activeFile: WorkspaceFile | null;
  cursorLine: number;
  editorRef: MutableRefObject<unknown>;
  mentionOptions: MentionOption[];
  onMention: (message: string) => void;
  room: Room | null;
  user: Member;
};

export function useRoomChat({ activeFile, cursorLine, editorRef, mentionOptions, onMention, room, user }: UseRoomChatOptions) {
  const [messages, setMessages] = useState<DisplayChatMessage[]>([]);
  const [chatDraft, setChatDraft] = useState('');
  const [chatError, setChatError] = useState('');
  const [pacificNow, setPacificNow] = useState(() => new Date());
  const chatInputRef = useRef<HTMLTextAreaElement | null>(null);
  const mentionOptionsRef = useRef<MentionOption[]>([]);
  const userRef = useRef(user);

  userRef.current = user;

  useEffect(() => {
    mentionOptionsRef.current = mentionOptions;
  }, [mentionOptions]);

  useEffect(() => {
    const timer = window.setInterval(() => setPacificNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!room) return;
    let cancelled = false;
    listChatHistory(room.code)
      .then((history) => {
        if (!cancelled) setMessages(history);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [room]);

  function receiveChatMessage(chatMessage: ChatMessage) {
    const activeUser = userRef.current;
    if (chatMessage.userId !== activeUser.id && messageMentionsUser(chatMessage.content, activeUser, mentionOptionsRef.current)) {
      onMention(`${displayNameOrPear(chatMessage.displayName)} mentioned you`);
    }
    setMessages((current) => [...current, chatMessage].slice(-60));
  }

  function sendChat(stompClient: Client | null) {
    const content = chatDraft.trim();
    if (!content || !room) return;
    const invalidMentions = invalidMentionLabels(content, mentionOptions);
    if (invalidMentions.length > 0) {
      setChatError(`Unknown username: @${invalidMentions[0]}`);
      return;
    }

    setChatError('');
    const mentionsAi = messageMentionsPearAi(content);
    if (stompClient?.connected) {
      stompClient.publish({
        destination: `/app/room/${room.code}/chat`,
        body: JSON.stringify({
          userId: user.id,
          displayName: user.name,
          content,
          currentFileId: activeFile?.id,
          currentFile: activeFile?.path,
          currentLine: cursorLine,
          currentFileContent: mentionsAi ? activeFileContextForAi(activeFile, cursorLine, editorRef.current) : undefined
        })
      });
    } else {
      setMessages((current) => [
        ...current,
        { id: crypto.randomUUID(), userId: user.id, displayName: user.name, content, ai: false, createdAt: new Date().toISOString() },
        ...(mentionsAi ? [{
          id: crypto.randomUUID(), userId: null, displayName: 'PearAI',
          content: 'PearAI is unavailable because realtime chat is disconnected. Reconnect to the room and try again.',
          ai: true, createdAt: new Date().toISOString()
        }] : [])
      ].slice(-60));
    }
    setChatDraft('');
  }

  function insertMentionIntoDraft(option: MentionOption) {
    const input = chatInputRef.current;
    const start = input?.selectionStart ?? chatDraft.length;
    const end = input?.selectionEnd ?? start;
    const insertion = insertMentionText(chatDraft, option.label, { start, end });
    setChatDraft(insertion.value);
    setChatError('');
    window.setTimeout(() => {
      input?.focus();
      input?.setSelectionRange(insertion.cursor, insertion.cursor);
    }, 0);
  }

  function addSystemMessage(content: string) {
    setMessages((current) => [...current, {
      id: crypto.randomUUID(), userId: null, displayName: 'System', content,
      ai: false, system: true, createdAt: new Date().toISOString()
    }].slice(-60));
  }

  function resetRoomChat(draft = '') {
    setMessages([]);
    setChatDraft(draft);
    setChatError('');
  }

  return {
    addSystemMessage,
    chatDraft,
    chatError,
    chatInputRef,
    insertMentionIntoDraft,
    messages,
    nowLabel: formatPacificTime(pacificNow.toISOString()),
    receiveChatMessage,
    resetRoomChat,
    sendChat,
    setChatDraft,
    setChatError
  };
}

function activeFileContextForAi(activeFile: WorkspaceFile | null, cursorLine: number, editor: unknown) {
  const editorValue = editor as { getValue?: () => string } | null;
  const content = typeof editorValue?.getValue === 'function' ? editorValue.getValue() : activeFile?.content ?? '';
  if (!content.trim()) return '';
  const maxChars = 12_000;
  if (content.length <= maxChars) return content;

  const lines = content.split(/\r?\n/);
  const cursorIndex = Math.max(0, Math.min(lines.length - 1, cursorLine - 1));
  const selected: string[] = [];
  let total = 0;
  let before = cursorIndex;
  let after = cursorIndex + 1;
  while (total < maxChars && (before >= 0 || after < lines.length)) {
    if (before >= 0) {
      selected.unshift(lines[before]);
      total += lines[before].length + 1;
      before -= 1;
    }
    if (total >= maxChars) break;
    if (after < lines.length) {
      selected.push(lines[after]);
      total += lines[after].length + 1;
      after += 1;
    }
  }
  const prefix = before >= 0 ? '...[earlier lines truncated]\n' : '';
  const suffix = after < lines.length ? '\n...[later lines truncated]' : '';
  return `${prefix}${selected.join('\n')}${suffix}`;
}
