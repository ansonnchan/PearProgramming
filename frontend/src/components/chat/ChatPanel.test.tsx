import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useRef, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Member } from '../../types';
import { ChatPanel, type MentionOption } from './ChatPanel';

const user: Member = { id: 'user-1', name: 'Alice Pear', color: '#627d31' };
const options: MentionOption[] = [
  { id: 'user-1', name: 'Alice Pear', label: 'AlicePear', color: '#627d31' },
  { id: 'user-2', name: 'Bob Bartlett', label: 'BobBartlett', color: '#9a653f' },
  { id: 'ai', name: 'AI', label: 'AI', color: '#7c5aa6', ai: true }
];

function ChatHarness({ mentionOptions = options }: { mentionOptions?: MentionOption[] }) {
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  return (
    <>
      <button type="button">Outside chat</button>
      <ChatPanel draft={draft} error="" inputRef={inputRef} mentionOptions={mentionOptions} messages={[]}
        messageMentionsUser={() => false} nowLabel="7:30 PM PDT" onClose={() => undefined}
        onDraftChange={setDraft} onSend={() => undefined} renderContent={(message) => message.content} user={user} />
    </>
  );
}

function composer() {
  return screen.getByRole('combobox', { name: 'Message room' }) as HTMLTextAreaElement;
}

function changeDraft(input: HTMLTextAreaElement, value: string) {
  fireEvent.change(input, { target: { value } });
}

describe('ChatPanel mention menu', () => {
  const scrollIntoView = vi.fn();

  beforeEach(() => {
    scrollIntoView.mockClear();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView
    });
  });

  it('opens after @ and filters room members as the query changes', () => {
    render(<ChatHarness />);
    const input = composer();

    changeDraft(input, '@');
    expect(input).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('listbox', { name: 'Mention a room member' })).toBeInTheDocument();
    expect(screen.getAllByRole('option')).toHaveLength(3);

    changeDraft(input, '@bo');
    expect(screen.getByRole('option', { name: /@BobBartlett/i })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /@AlicePear/i })).not.toBeInTheDocument();
  });

  it('moves through results with ArrowDown and ArrowUp and scrolls the active result into view', () => {
    render(<ChatHarness />);
    const input = composer();
    changeDraft(input, '@');
    scrollIntoView.mockClear();

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(screen.getByRole('option', { name: /@BobBartlett/i })).toHaveAttribute('aria-selected', 'true');
    expect(scrollIntoView).toHaveBeenCalled();

    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(screen.getByRole('option', { name: /@AlicePear/i })).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(screen.getByRole('option', { name: /@AI/i })).toHaveAttribute('aria-selected', 'true');
  });

  it('selects the highlighted result with Enter and keeps typing focus', async () => {
    render(<ChatHarness />);
    const input = composer();
    input.focus();
    changeDraft(input, '@bo');

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(input).toHaveValue('@BobBartlett ');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    await waitFor(() => expect(input).toHaveFocus());
  });

  it('accepts the active result with Tab', () => {
    render(<ChatHarness />);
    const input = composer();
    changeDraft(input, '@');
    fireEvent.keyDown(input, { key: 'ArrowDown' });

    fireEvent.keyDown(input, { key: 'Tab' });
    expect(input).toHaveValue('@BobBartlett ');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('selects a clicked result without moving focus away from the composer', async () => {
    render(<ChatHarness />);
    const input = composer();
    input.focus();
    changeDraft(input, '@');
    const alice = screen.getByRole('option', { name: /@AlicePear/i });

    fireEvent.mouseDown(alice);
    fireEvent.click(alice);
    expect(input).toHaveValue('@AlicePear ');
    await waitFor(() => expect(input).toHaveFocus());
  });

  it('dismisses with Escape without clearing the message', () => {
    render(<ChatHarness />);
    const input = composer();
    changeDraft(input, 'hello @al');

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(input).toHaveValue('hello @al');
  });

  it('closes when clicking outside the composer', () => {
    render(<ChatHarness />);
    const input = composer();
    changeDraft(input, '@');

    fireEvent.mouseDown(screen.getByRole('button', { name: 'Outside chat' }));
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(input).toHaveValue('@');
  });

  it('closes when Backspace removes the mention query', () => {
    render(<ChatHarness />);
    const input = composer();
    changeDraft(input, '@a');
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    fireEvent.keyDown(input, { key: 'Backspace' });
    changeDraft(input, '');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(input).toHaveAttribute('aria-expanded', 'false');
  });
});
