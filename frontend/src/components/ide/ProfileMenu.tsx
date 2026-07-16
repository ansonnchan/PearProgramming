import { UserRound, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { Member } from '../../types';

type ProfileMenuProps = {
  draftName: string;
  onClose: () => void;
  onDraftNameChange: (name: string) => void;
  onSave: () => void;
  roleLabel: string;
  user: Member;
};

export function ProfileMenu({ draftName, onClose, onDraftNameChange, onSave, roleLabel, user }: ProfileMenuProps) {
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    nameInputRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, []);

  return (
    <div className="modal-backdrop profile-menu-backdrop">
      <section aria-label="Account profile" aria-modal="true" className="profile-modal" role="dialog">
        <header>
          <div>
            <span className="profile-menu-kicker">Room profile</span>
            <h2>Your pear identity</h2>
          </div>
          <button aria-label="Close profile" className="icon-button profile-close-button" onClick={onClose} type="button">
            <X size={15} />
          </button>
        </header>
        <div className="profile-preview">
          <span aria-hidden="true" className="profile-avatar" style={{ backgroundColor: `${user.color}22`, color: user.color }}>
            {user.avatarUrl ? <img alt="" src={user.avatarUrl} /> : <UserRound size={24} />}
          </span>
          <div className="profile-identity-copy">
            <strong>{user.name}</strong>
            <span>{roleLabel}</span>
          </div>
        </div>
        <p className="profile-avatar-note">Your avatar is shown here for identification and is not editable inside the IDE.</p>
        <label className="field-label profile-name-field">
          Display name
          <input ref={nameInputRef} onChange={(event) => onDraftNameChange(event.target.value)} value={draftName} />
        </label>
        <div className="modal-actions">
          <button className="secondary-button" onClick={onClose} type="button">Cancel</button>
          <button className="primary-button" disabled={!draftName.trim()} onClick={onSave} type="button">Save name</button>
        </div>
      </section>
    </div>
  );
}
