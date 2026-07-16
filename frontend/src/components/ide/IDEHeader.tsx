import { Bot, ChevronDown, Copy, Leaf, Settings } from 'lucide-react';
import pearLogoUrl from '../../../assets/favicon.png';
import type { Member } from '../../types';

type IDEHeaderProps = {
  hiddenMemberCount: number;
  humanMemberCount: number;
  isLead: boolean;
  members: Member[];
  onCloseRoom: () => void;
  onCopyRoomCode: () => void;
  onLeaveRoom: () => void;
  onOpenProfile: () => void;
  onReturnToLanding: () => void;
  onSignOut: () => void;
  onToggleMenu: () => void;
  onToggleRoomLock: () => void;
  pearMenuOpen: boolean;
  roleLabel: string;
  roomCode: string;
  roomLocked: boolean;
  user: Member;
};

export function IDEHeader({
  hiddenMemberCount,
  humanMemberCount,
  isLead,
  members,
  onCloseRoom,
  onCopyRoomCode,
  onLeaveRoom,
  onOpenProfile,
  onReturnToLanding,
  onSignOut,
  onToggleMenu,
  onToggleRoomLock,
  pearMenuOpen,
  roleLabel,
  roomCode,
  roomLocked,
  user
}: IDEHeaderProps) {
  return (
    <header className="topbar">
      <button className="brand brand-link" onClick={onReturnToLanding} type="button">
        <img alt="" className="brand-logo" src={pearLogoUrl} />
        <span>PearProgramming</span>
      </button>
      <div className="room-header-center">
        <div className="room-code-control" aria-label={`Room code ${roomCode}`}>
          <span className="room-code-label">Room Code:</span>
          <strong>{roomCode}</strong>
          <button className="room-code-copy" onClick={onCopyRoomCode} title="Copy room code" type="button">
            <Copy size={13} />
            <span>Copy</span>
          </button>
        </div>
        <span className={`role-chip ${isLead ? 'role-lead' : ''}`}>{isLead && <Leaf size={13} />}{roleLabel}</span>
      </div>
      <div className="topbar-actions">
        <div className="collaborators" aria-label="Collaborators">
          <span className="online-dot" />
          <span className="online-count">{Math.max(1, humanMemberCount)} online</span>
          <div className="avatar-stack">
            {members.map((member) => member.id === user.id ? (
              <button
                className="avatar avatar-button"
                key={member.id}
                onClick={onOpenProfile}
                style={{ backgroundColor: `${member.color}22`, color: member.color }}
                title="View profile"
                type="button"
              >
                {member.avatarUrl ? <img alt="" src={member.avatarUrl} /> : initials(member.name)}
              </button>
            ) : (
              <span
                className={`avatar ${member.ai ? 'avatar-ai' : ''}`}
                key={member.id}
                style={{ backgroundColor: member.ai ? '#EEEDFE' : `${member.color}22`, color: member.color }}
                title={member.name}
              >
                {member.ai ? <Bot size={13} /> : member.avatarUrl ? <img alt="" src={member.avatarUrl} /> : initials(member.name)}
              </span>
            ))}
            {hiddenMemberCount > 0 && <span className="avatar avatar-overflow" title={`${hiddenMemberCount} more collaborators`}>+{hiddenMemberCount}</span>}
          </div>
        </div>
        <button aria-label="Open profile" className="topbar-icon-button" onClick={onOpenProfile} title="Open profile" type="button">
          <Settings size={16} />
        </button>
        <div className="pear-menu">
          <button aria-expanded={pearMenuOpen} className="topbar-button pear-menu-trigger" onClick={onToggleMenu} type="button">
            <span>Pear Menu</span>
            <ChevronDown size={14} />
          </button>
          {pearMenuOpen && (
            <div className="pear-menu-popover">
              {isLead && <button onClick={onToggleRoomLock} type="button">{roomLocked ? 'Unlock Room' : 'Lock Room'}</button>}
              <button onClick={onLeaveRoom} type="button">Leave Room</button>
              <button onClick={onSignOut} type="button">Sign Out</button>
              {isLead && <button className="danger-menu-item" onClick={onCloseRoom} type="button">Close Room</button>}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}
