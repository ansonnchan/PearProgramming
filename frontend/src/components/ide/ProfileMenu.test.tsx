import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ProfileMenu } from './ProfileMenu';

const user = { id: 'user-1', name: 'Pear User', color: '#627d31', avatarUrl: 'data:image/png;base64,pear' };

describe('ProfileMenu', () => {
  it('shows the avatar as informational without avatar editing actions', () => {
    render(<ProfileMenu draftName="Pear User" onClose={vi.fn()} onDraftNameChange={vi.fn()} onSave={vi.fn()} roleLabel="Lead Pear" user={user} />);
    expect(screen.getByRole('dialog', { name: 'Account profile' })).toBeInTheDocument();
    expect(screen.getByText(/not editable inside the IDE/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /upload|replace|regenerate|edit avatar/i })).not.toBeInTheDocument();
  });

  it('supports keyboard dismissal and display-name editing', () => {
    const onClose = vi.fn();
    const onDraftNameChange = vi.fn();
    render(<ProfileMenu draftName="Pear User" onClose={onClose} onDraftNameChange={onDraftNameChange} onSave={vi.fn()} roleLabel="Junior Pear" user={user} />);
    const nameInput = screen.getByRole('textbox', { name: 'Display name' });
    expect(nameInput).toHaveFocus();
    fireEvent.change(nameInput, { target: { value: 'New Pear' } });
    expect(onDraftNameChange).toHaveBeenCalledWith('New Pear');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
