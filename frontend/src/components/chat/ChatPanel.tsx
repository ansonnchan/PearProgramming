import { Bot, MessageCircle, PanelRightClose, Send } from 'lucide-react';
import { type KeyboardEvent, type ReactNode, type RefObject, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { ChatMessage, Member } from '../../types';
import { insertMentionText, mentionFragmentAt, mentionMatches, type MentionFragment, type MentionOption } from './mention';

export type { MentionOption } from './mention';

export type DisplayChatMessage = ChatMessage & { system?: boolean };

type ChatPanelProps = {
  draft: string;
  error: string;
  inputRef: RefObject<HTMLTextAreaElement>;
  mentionOptions: MentionOption[];
  messages: DisplayChatMessage[];
  nowLabel: string;
  onClose: () => void;
  onDraftChange: (value: string) => void;
  onSend: () => void;
  renderContent: (message: DisplayChatMessage) => ReactNode;
  user: Member;
  messageMentionsUser: (message: DisplayChatMessage) => boolean;
};

export function ChatPanel({
  draft, error, inputRef, mentionOptions, messages, nowLabel, onClose,
  onDraftChange, onSend, renderContent, user, messageMentionsUser
}: ChatPanelProps) {
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const shouldFollowMessagesRef = useRef(true);
  const composerRef = useRef<HTMLDivElement | null>(null);
  const mentionOptionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [mentionFragment, setMentionFragment] = useState<MentionFragment | null>(null);
  const [activeMentionIndex, setActiveMentionIndex] = useState(0);
  const mentionListId = useId();
  const filteredMentionOptions = mentionFragment
    ? mentionOptions.filter((option) => mentionMatches(option, mentionFragment.query))
    : [];

  useLayoutEffect(() => {
    const messageList = messageListRef.current;
    if (messageList && shouldFollowMessagesRef.current) {
      messageList.scrollTop = messageList.scrollHeight;
    }
  }, [messages]);

  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = '0px';
    input.style.height = `${Math.min(Math.max(input.scrollHeight, 40), 112)}px`;
  }, [draft, inputRef]);

  useEffect(() => {
    if (!mentionFragment || filteredMentionOptions.length === 0) return;
    mentionOptionRefs.current[activeMentionIndex]?.scrollIntoView?.({ block: 'nearest' });
  }, [activeMentionIndex, filteredMentionOptions.length, mentionFragment]);

  useEffect(() => {
    setActiveMentionIndex((current) => Math.min(current, Math.max(filteredMentionOptions.length - 1, 0)));
  }, [filteredMentionOptions.length]);

  useEffect(() => {
    if (!mentionFragment) return;

    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!composerRef.current?.contains(event.target as Node)) {
        setMentionFragment(null);
        setActiveMentionIndex(0);
      }
    };

    document.addEventListener('mousedown', closeOnOutsideClick);
    return () => document.removeEventListener('mousedown', closeOnOutsideClick);
  }, [mentionFragment]);

  const handleMessageScroll = () => {
    const messageList = messageListRef.current;
    if (!messageList) return;
    const distanceFromBottom = messageList.scrollHeight - messageList.scrollTop - messageList.clientHeight;
    shouldFollowMessagesRef.current = distanceFromBottom < 56;
  };

  const closeMentionMenu = () => {
    setMentionFragment(null);
    setActiveMentionIndex(0);
  };

  const updateMentionMenu = (input: HTMLTextAreaElement) => {
    const cursor = input.selectionStart ?? input.value.length;
    const fragment = mentionFragmentAt(input.value, cursor);
    setMentionFragment(fragment);
    setActiveMentionIndex(0);
  };

  const insertMention = (option: MentionOption) => {
    if (!mentionFragment) return;
    const insertion = insertMentionText(draft, option.label, mentionFragment);
    onDraftChange(insertion.value);
    closeMentionMenu();
    window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(insertion.cursor, insertion.cursor);
    }, 0);
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionFragment) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeMentionMenu();
        return;
      }

      if (filteredMentionOptions.length > 0 && event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveMentionIndex((current) => (current + 1) % filteredMentionOptions.length);
        return;
      }

      if (filteredMentionOptions.length > 0 && event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveMentionIndex((current) => (current - 1 + filteredMentionOptions.length) % filteredMentionOptions.length);
        return;
      }

      if (filteredMentionOptions.length > 0 && (event.key === 'Enter' || event.key === 'Tab')) {
        event.preventDefault();
        insertMention(filteredMentionOptions[Math.min(activeMentionIndex, filteredMentionOptions.length - 1)]);
        return;
      }
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      closeMentionMenu();
      onSend();
    }
  };

  const handleComposerKeyUp = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      updateMentionMenu(event.currentTarget);
    }
  };

  const sendMessage = () => {
    closeMentionMenu();
    onSend();
  };

  return (
    <aside className="chat" id="room-chat">
      <div className="pane-title-row chat-title-row">
        <span className="pane-title">Room chat</span>
        <div className="chat-title-tools">
          <span className="shared-label">{nowLabel}</span>
          <button aria-label="Hide room chat" className="icon-button panel-minimize-button" onClick={onClose} title="Hide room chat" type="button">
            <PanelRightClose size={16} />
          </button>
        </div>
      </div>
      <div className="messages" onScroll={handleMessageScroll} ref={messageListRef}>
        {messages.length === 0 && (
          <div className="chat-empty-state">
            <span className="chat-empty-icon"><MessageCircle size={18} /></span>
            <strong>The room is quiet</strong>
            <span>Say hello when your coding partner arrives.</span>
          </div>
        )}
        {messages.map((message) => {
          const participant = mentionOptions.find((option) => option.id === message.userId);
          const senderColor = message.ai ? '#7c5aa6' : participant?.color ?? (message.userId === user.id ? user.color : '#667653');
          const senderName = message.ai ? 'PearAI' : message.displayName;
          return (
            <article className={`message ${message.ai ? 'message-ai' : ''} ${message.system ? 'message-system' : ''} ${messageMentionsUser(message) ? 'message-mentioned' : ''}`} key={message.id}>
              {message.system ? <p>{message.content}</p> : (
                <div className="message-row">
                  <span aria-hidden="true" className={`message-avatar ${message.ai ? 'message-avatar-ai' : ''}`} style={{ backgroundColor: `${senderColor}1f`, color: senderColor }}>
                    {message.ai ? <Bot size={13} /> : initials(message.displayName)}
                  </span>
                  <div className="message-body">
                    <div className="message-meta">
                      <span style={{ color: senderColor }}>{senderName}</span>
                      <time dateTime={message.createdAt}>{formatPacificTime(message.createdAt)}</time>
                    </div>
                    <p>{renderContent(message)}</p>
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>
      <div className="chat-input-shell" ref={composerRef}>
        {mentionFragment && (
          <div aria-label="Mention a room member" className="mention-menu" id={mentionListId} role="listbox">
            <span className="mention-menu-label">Mention someone</span>
            {filteredMentionOptions.length === 0 ? (
              <span className="mention-empty" role="status">No matching pears</span>
            ) : filteredMentionOptions.map((option, index) => (
              <button aria-selected={index === activeMentionIndex} className={`mention-option ${index === activeMentionIndex ? 'mention-option-active' : ''}`}
                id={`${mentionListId}-option-${index}`} key={option.id} onClick={() => insertMention(option)} onMouseDown={(event) => event.preventDefault()}
                ref={(element) => { mentionOptionRefs.current[index] = element; }} role="option" type="button">
                <span className={`mention-avatar ${option.ai ? 'mention-avatar-ai' : ''}`} style={{ backgroundColor: `${option.color}22`, color: option.color }}>
                  {option.ai ? <Bot size={12} /> : initials(option.name)}
                </span>
                <span><strong>@{option.label}</strong><small>{option.name}</small></span>
              </button>
            ))}
          </div>
        )}
        {error && <p className="chat-error">{error}</p>}
        <div className="chat-input">
          <textarea aria-activedescendant={mentionFragment && filteredMentionOptions.length > 0 ? `${mentionListId}-option-${activeMentionIndex}` : undefined}
            aria-autocomplete="list" aria-controls={mentionFragment ? mentionListId : undefined} aria-expanded={Boolean(mentionFragment)} aria-haspopup="listbox" aria-label="Message room"
            onChange={(event) => { onDraftChange(event.currentTarget.value); updateMentionMenu(event.currentTarget); }}
            onClick={(event) => updateMentionMenu(event.currentTarget)} onKeyDown={handleComposerKeyDown} onKeyUp={handleComposerKeyUp}
            placeholder="Message or @PearAI…" ref={inputRef} role="combobox" rows={1} value={draft} />
          <button aria-label="Send message" className="send-button" disabled={!draft.trim()} onClick={sendMessage} title="Send message" type="button"><Send size={16} /></button>
        </div>
      </div>
    </aside>
  );
}

function formatPacificTime(value: string) {
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles', timeZoneName: 'short' }).format(new Date(value));
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
}
