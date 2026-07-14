import { Bot, PanelRightClose, Send } from 'lucide-react';
import type { KeyboardEvent, ReactNode, RefObject } from 'react';
import type { ChatMessage, Member } from '../../types';

export type DisplayChatMessage = ChatMessage & { system?: boolean };
export type MentionOption = { id: string; name: string; label: string; color: string; ai?: boolean };

type ChatPanelProps = {
  activeMentionIndex: number;
  draft: string;
  error: string;
  inputRef: RefObject<HTMLInputElement>;
  mentionOptions: MentionOption[];
  messages: DisplayChatMessage[];
  nowLabel: string;
  onClose: () => void;
  onDraftInput: (input: HTMLInputElement) => void;
  onInsertMention: (option: MentionOption) => void;
  onMentionKeyDown: (event: KeyboardEvent<HTMLInputElement>) => boolean;
  onSend: () => void;
  renderContent: (message: DisplayChatMessage) => ReactNode;
  user: Member;
  messageMentionsUser: (message: DisplayChatMessage) => boolean;
};

export function ChatPanel({
  activeMentionIndex, draft, error, inputRef, mentionOptions, messages, nowLabel, onClose,
  onDraftInput, onInsertMention, onMentionKeyDown, onSend, renderContent, messageMentionsUser
}: ChatPanelProps) {
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
      <div className="messages">
        {messages.map((message) => (
          <article className={`message ${message.ai ? 'message-ai' : ''} ${message.system ? 'message-system' : ''} ${messageMentionsUser(message) ? 'message-mentioned' : ''}`} key={message.id}>
            {message.system ? <p>{message.content}</p> : (
              <><div className="message-meta"><span>{message.displayName}</span><span>{formatPacificTime(message.createdAt)}</span></div><p>{renderContent(message)}</p></>
            )}
          </article>
        ))}
      </div>
      <div className="chat-input-shell">
        {mentionOptions.length > 0 && (
          <div className="mention-menu" role="listbox">
            {mentionOptions.map((option, index) => (
              <button aria-selected={index === activeMentionIndex} className={`mention-option ${index === activeMentionIndex ? 'mention-option-active' : ''}`}
                key={option.id} onMouseDown={(event) => { event.preventDefault(); onInsertMention(option); }} role="option" type="button">
                <span className={`mention-avatar ${option.ai ? 'mention-avatar-ai' : ''}`} style={{ backgroundColor: `${option.color}22`, color: option.color }}>
                  {option.ai ? <Bot size={12} /> : initials(option.name)}
                </span>
                <span>@{option.label}</span>
              </button>
            ))}
          </div>
        )}
        {error && <p className="chat-error">{error}</p>}
        <div className="chat-input">
          <input onChange={(event) => onDraftInput(event.currentTarget)} onClick={(event) => onDraftInput(event.currentTarget)}
            onKeyUp={(event) => onDraftInput(event.currentTarget)} onKeyDown={(event) => { if (!onMentionKeyDown(event) && event.key === 'Enter') onSend(); }}
            placeholder="Message or @AI..." ref={inputRef} value={draft} />
          <button className="send-button" onClick={onSend} title="Send message" type="button"><Send size={16} /></button>
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
