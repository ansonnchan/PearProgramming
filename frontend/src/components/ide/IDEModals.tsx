import { FolderPlus, ImagePlus, Upload, UserRound, X } from 'lucide-react';
import type { DragEvent, RefObject } from 'react';

type EntryAction = 'create' | 'join';

type UploadModalProps = {
  dragging: boolean;
  onCancel: () => void;
  onChooseFiles: () => void;
  onChooseFolder: () => void;
  onDragLeave: () => void;
  onDragOver: () => void;
  onDrop: (event: DragEvent<HTMLElement>) => void;
};

export function UploadModal({
  dragging,
  onCancel,
  onChooseFiles,
  onChooseFolder,
  onDragLeave,
  onDragOver,
  onDrop
}: UploadModalProps) {
  return (
    <div
      className="modal-backdrop modal-backdrop-animated"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onCancel();
        }
      }}
      role="presentation"
    >
      <section
        aria-label="Upload files or folders"
        aria-modal="true"
        className={`upload-modal ${dragging ? 'upload-modal-dragging' : ''}`}
        onDragEnter={(event) => {
          event.preventDefault();
          onDragOver();
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          const nextTarget = event.relatedTarget;
          if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
            onDragLeave();
          }
        }}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
          onDragOver();
        }}
        onDrop={onDrop}
        role="dialog"
      >
        <header>
          <div>
            <span className="upload-modal-kicker">Pear upload</span>
            <h2>Upload project files</h2>
          </div>
          <button className="icon-button" onClick={onCancel} title="Close upload panel" type="button">
            <X size={14} />
          </button>
        </header>
        <div className="upload-dropzone">
          <span className="upload-dropzone-icon">
            <Upload size={22} />
          </span>
          <strong>{dragging ? 'Drop to upload' : 'Drop files or folders here'}</strong>
          <span>Nested folders and supported code files stay together.</span>
        </div>
        <div className="upload-modal-actions">
          <button autoFocus className="secondary-button" onClick={onChooseFiles} type="button">
            <Upload size={15} />
            Choose Files
          </button>
          <button className="primary-button" onClick={onChooseFolder} type="button">
            <FolderPlus size={15} />
            Choose Folder
          </button>
        </div>
      </section>
    </div>
  );
}

type EntryProfileModalProps = {
  action: EntryAction | null;
  avatarInputRef: RefObject<HTMLInputElement>;
  avatarUrl?: string;
  color: string;
  error: string;
  name: string;
  onAvatarInput: (input: HTMLInputElement) => void;
  onCancel: () => void;
  onConfirm: () => void;
  onNameChange: (name: string) => void;
};

export function EntryProfileModal({
  action,
  avatarInputRef,
  avatarUrl,
  color,
  error,
  name,
  onAvatarInput,
  onCancel,
  onConfirm,
  onNameChange
}: EntryProfileModalProps) {
  return (
    <div className="modal-backdrop entry-profile-backdrop">
      <section className="profile-modal entry-profile-modal" role="dialog" aria-modal="true" aria-label="Set up profile">
        <header>
          <h2>{action === 'create' ? 'Create your pear profile' : 'Join with your pear profile'}</h2>
          <button className="icon-button" onClick={onCancel} title="Cancel" type="button">
            <X size={14} />
          </button>
        </header>
        <div className="profile-preview">
          <span className="profile-avatar" style={{ backgroundColor: `${color}22`, color }}>
            {avatarUrl ? <img alt="" src={avatarUrl} /> : <UserRound size={22} />}
          </span>
          <button className="secondary-button" onClick={() => avatarInputRef.current?.click()} type="button">
            <ImagePlus size={15} />
            Upload Photo
          </button>
          <input accept=".jpg,.jpeg,.png,.webp" className="hidden-file-input" onChange={(event) => onAvatarInput(event.currentTarget)} ref={avatarInputRef} type="file" />
        </div>
        <label className="field-label">
          Display name
          <input autoFocus onChange={(event) => onNameChange(event.target.value)} placeholder="Your display name" value={name} />
        </label>
        {error && <p className="profile-error">{error}</p>}
        <div className="modal-actions">
          <button className="secondary-button" onClick={onCancel} type="button">Cancel</button>
          <button className="primary-button" onClick={onConfirm} type="button">Continue</button>
        </div>
      </section>
    </div>
  );
}

type CreateItemModalProps = {
  error: string;
  kind: 'file' | 'folder';
  name: string;
  onCancel: () => void;
  onConfirm: () => void;
  onNameChange: (value: string) => void;
};

export function CreateItemModal({ error, kind, name, onCancel, onConfirm, onNameChange }: CreateItemModalProps) {
  const isFolder = kind === 'folder';

  return (
    <div className="modal-backdrop modal-backdrop-animated" onKeyDown={(event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        onConfirm();
      }
    }} role="presentation">
      <section className="confirm-modal create-item-modal" aria-describedby="create-item-help" aria-label={isFolder ? 'Create folder' : 'Create file'} aria-modal="true" role="dialog">
        <header>
          <h2>{isFolder ? 'Create Folder' : 'Create File'}</h2>
          <button className="icon-button" onClick={onCancel} title="Cancel" type="button">
            <X size={14} />
          </button>
        </header>
        <p id="create-item-help">
          {isFolder
            ? 'Enter a folder name. PearProgramming will create the folder and preserve its structure.'
            : 'Enter a file name. You can include an extension like .ts or .md.'}
        </p>
        <label className="field-label">
          {isFolder ? 'Folder name' : 'File name'}
          <input
            autoFocus
            onChange={(event) => onNameChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                onConfirm();
              }
            }}
            placeholder={isFolder ? 'components' : 'notes.md'}
            value={name}
          />
        </label>
        {error && <p className="profile-error">{error}</p>}
        <div className="create-item-preview">
          <span className="create-item-chip">{isFolder ? 'Folder' : 'File'}</span>
          <span className="create-item-hint">Duplicate names are auto-renamed to keep the tree stable.</span>
        </div>
        <div className="modal-actions">
          <button className="secondary-button" onClick={onCancel} type="button">Cancel</button>
          <button className="primary-button" onClick={onConfirm} type="button">Create</button>
        </div>
      </section>
    </div>
  );
}

export function Toast({ message }: { message: string }) {
  if (!message) {
    return null;
  }

  return <div className="toast" role="status" aria-live="polite">{message}</div>;
}
