create extension if not exists pgcrypto;

create table users (
    id uuid primary key default gen_random_uuid(),
    github_id varchar(255) unique,
    google_id varchar(255) unique,
    display_name varchar(255) not null,
    email varchar(320),
    avatar_url text,
    created_at timestamptz not null default now()
);

create table workspaces (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid references users(id) on delete set null,
    name varchar(255) not null,
    created_at timestamptz not null default now()
);

create table files (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references workspaces(id) on delete cascade,
    path text not null,
    language varchar(64) not null,
    content text not null default '',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint files_workspace_path_unique unique (workspace_id, path)
);

create table rooms (
    id uuid primary key default gen_random_uuid(),
    code varchar(7) not null unique,
    workspace_id uuid not null references workspaces(id) on delete cascade,
    is_active boolean not null default true,
    created_at timestamptz not null default now(),
    expires_at timestamptz not null
);

create table room_members (
    room_id uuid not null references rooms(id) on delete cascade,
    user_id uuid not null references users(id) on delete cascade,
    cursor_color varchar(16) not null,
    cursor_line integer not null default 1,
    cursor_col integer not null default 1,
    joined_at timestamptz not null default now(),
    primary key (room_id, user_id)
);

create table chat_messages (
    id uuid primary key default gen_random_uuid(),
    room_id uuid not null references rooms(id) on delete cascade,
    user_id uuid references users(id) on delete set null,
    content text not null,
    is_ai boolean not null default false,
    created_at timestamptz not null default now()
);

create table ai_annotations (
    id uuid primary key default gen_random_uuid(),
    file_id uuid not null references files(id) on delete cascade,
    room_id uuid not null references rooms(id) on delete cascade,
    triggered_by uuid references users(id) on delete set null,
    line integer not null,
    content text not null,
    created_at timestamptz not null default now(),
    dismissed_at timestamptz
);

create index idx_files_workspace_id on files(workspace_id);
create index idx_rooms_workspace_id on rooms(workspace_id);
create index idx_rooms_code on rooms(code);
create index idx_room_members_room_id on room_members(room_id);
create index idx_chat_messages_room_created_at on chat_messages(room_id, created_at desc);
create index idx_ai_annotations_file_room on ai_annotations(file_id, room_id);
create index idx_ai_annotations_dedup on ai_annotations(file_id, line, created_at desc) where dismissed_at is null;
