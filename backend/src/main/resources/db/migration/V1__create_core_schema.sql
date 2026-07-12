CREATE TABLE app_users (
    id UUID PRIMARY KEY,
    display_name VARCHAR(60) NOT NULL,
    avatar_url TEXT,
    guest BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL
);

CREATE TABLE workspaces (
    id UUID PRIMARY KEY,
    name VARCHAR(160) NOT NULL,
    owner_user_id UUID NOT NULL REFERENCES app_users(id),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL
);

CREATE INDEX idx_workspaces_owner ON workspaces(owner_user_id);

CREATE TABLE workspace_members (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT uk_workspace_member UNIQUE (workspace_id, user_id),
    CONSTRAINT chk_workspace_member_role CHECK (role IN ('OWNER', 'MEMBER'))
);

CREATE INDEX idx_workspace_members_user ON workspace_members(user_id);

CREATE TABLE rooms (
    id UUID PRIMARY KEY,
    code VARCHAR(12) NOT NULL,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    owner_user_id UUID NOT NULL REFERENCES app_users(id),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    closed_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT uk_rooms_code UNIQUE (code),
    CONSTRAINT uk_rooms_workspace UNIQUE (workspace_id)
);

CREATE INDEX idx_rooms_owner ON rooms(owner_user_id);
CREATE INDEX idx_rooms_active ON rooms(active);

CREATE TABLE room_members (
    id UUID PRIMARY KEY,
    room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    joined_at TIMESTAMP WITH TIME ZONE NOT NULL,
    last_seen_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT uk_room_member UNIQUE (room_id, user_id)
);

CREATE INDEX idx_room_members_user ON room_members(user_id);

CREATE TABLE workspace_files (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    path VARCHAR(1024) NOT NULL,
    language VARCHAR(64) NOT NULL,
    content TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT uk_workspace_file_path UNIQUE (workspace_id, path)
);

CREATE INDEX idx_workspace_files_order ON workspace_files(workspace_id, sort_order, path);

CREATE TABLE file_snapshots (
    file_id UUID PRIMARY KEY REFERENCES workspace_files(id) ON DELETE CASCADE,
    encoded_state TEXT NOT NULL,
    plain_text TEXT NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL
);
