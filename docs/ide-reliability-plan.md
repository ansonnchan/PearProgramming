# IDE reliability refactor plan

This document records the Phase 1 architecture audit for the incremental IDE
refactor. It describes the current ownership boundaries, known failure modes,
the intended extraction sequence, and the verification required in later
phases. It does not claim that the presence, cleanup, deletion, or layout issues
are fixed.

## Current frontend responsibilities

`frontend/src/App.tsx` is 3,364 lines. It currently owns all of the following:

- landing-page room entry and the entry-profile flow;
- room creation, join, restoration, leave, lead transfer, lock, close, and sign
  out flows;
- the persisted browser room session;
- workspace files, uploads, folder creation, file creation, export, optimistic
  file content, autosave, and full-tree synchronization;
- open tabs, active-file selection, cursor position, Monaco mounting, Monaco
  content widgets, and editor content replacement;
- STOMP chat, cursor, member, annotation, project-switch, and content-update
  event handling;
- client-derived presence, mentions, lead state, and room lock state;
- Yjs document binding and upload seeding;
- project-switch proposals and votes;
- execution language, execution requests, console visibility, and console
  sizing;
- explorer, chat, upload, profile, create-item, delegation, and toast UI state;
- most of the IDE page markup and a collection of unrelated pure helpers.

Several useful boundaries already exist and should be retained:

- `LandingPage`, `FileTree`, `ChatPanel`, `ExecutionToolbar`, and
  `ExecutionConsole` are cohesive components;
- `useAuthSession`, `useRoomConnection`, `useCollaborativeDocument`, and
  `useExecution` own meaningful integration lifecycles;
- `api.ts`, `uploads.ts`, `language.ts`, and the execution helpers already keep
  transport and pure behavior out of the UI.

The refactor should build on those modules rather than replace them.

## Phase 2 extraction plan

The extraction order is designed to preserve behavior after each step.

1. Move pure, testable helpers into domain modules:
   - room-code and browser-session helpers under `rooms/`;
   - file merge, tree replacement, tab reconciliation, and path helpers under
     `workspace/`;
   - presence normalization and member-event types under `presence/`;
   - Monaco widget and editor-language helpers under `editor/`.
2. Extract page regions without moving their state ownership prematurely:
   - `IDEHeader` with `PresenceIndicator` and `ProfileMenu`;
   - `ExplorerPanel` around the existing `FileTree`;
   - `EditorWorkspace`, `EditorTabs`, and `EmptyEditorState`;
   - `ConsolePanel` around the existing execution components;
   - retain the existing `ChatPanel` rather than adding a wrapper that only
     forwards props.
3. Extract cohesive controllers:
   - `useRoomLifecycle` for create/join/restore/leave/close and room-session
     persistence;
   - `useWorkspaceFiles` for file state, uploads, persistence, autosave, and
     file-tree collaboration events;
   - `useEditorTabs` for open/active tab state and deterministic reconciliation;
   - `useRoomPresence` for server snapshots, member events, heartbeats, lead,
     and lock state;
   - `useRoomChat` for history, draft validation, mentions, and messages;
   - `useConsoleLayout` for open state and constrained persisted sizing.
4. Keep `useRoomConnection` as the single STOMP connection owner. Route its
   typed events to the domain controllers; do not create one socket per hook.
5. Keep `RoomWorkspace` as the feature composition boundary. Passing a small
   controller object one level into each major panel is preferable to either a
   global store or deep prop chains.
6. Reduce `App.tsx` to authentication/landing/workspace composition and the
   top-level room transition. The target remains under 500 lines; a hard upper
   bound of 800 lines is acceptable only if splitting the coordinator would
   obscure the room transition.

The first refactor tests should lock down tab reconciliation, room-session
restoration, presence normalization, project file replacement, and the STOMP
subscription lifecycle before behavior is changed in later phases.

## File deletion findings

Deletion is partially implemented today:

- `FileTree` exposes keyboard-focusable delete buttons for files and folders;
- `App.deleteTreePath` confirms the named path, filters the tree, reconciles
  tabs through `applyUploadedFiles`, persists a complete room file snapshot,
  and broadcasts a `files-updated` event;
- Spring has `DELETE /api/files/{fileId}` and cascading database relationships
  for file snapshots and AI annotations;
- the full room snapshot path also deletes omitted durable workspace files.

The existing path is not yet reliable enough for the requested behavior:

- there is no focused frontend delete API or typed deletion event;
- the optimistic UI and fire-and-forget snapshot save can report success even
  when durable deletion fails;
- a stale collaborator can later upsert a deleted file through
  `file-content-updated`, recreating the durable row because there is no
  deletion tombstone or missing-file rejection;
- the Yjs service retains the in-memory document and Redis updates after file
  deletion, and Yjs authorization currently validates room membership rather
  than the requested file ID;
- room restoration treats an empty server file list as a reason to fall back to
  the browser session, which is unsafe for the final-file deletion case;
- deletion behavior is embedded in `App.tsx` and has no tests for closed,
  active, final, remote, or reconnect cases.

Phase 3 should make the server mutation authoritative, return the resulting
tree or deletion revision, broadcast a typed deletion with file IDs, reconcile
tabs through a pure tested function, and prevent later content events from
resurrecting deleted IDs. Folder deletion should be a transactional batch
operation. The Yjs service also needs a targeted document eviction/delete path
or an equivalent server-side guard.

## Presence architecture and likely causes

Identity is correctly issued by Spring as a guest UUID. REST, STOMP, and Yjs
requests are authenticated against that identity. For STOMP member events,
Spring replaces client identity and connection fields with the authenticated
principal and the server `simpSessionId`.

Active presence is stored in Redis when available, with an in-process fallback.
Entries are keyed by connection ID and counts are deduplicated by user ID. This
is a sound base for multiple tabs, but the browser does not consume server state
as a snapshot:

- a joining client publishes `joined` after subscribing;
- existing clients respond with individual `presence-sync` events;
- the joining client has no single authoritative initial participant list;
- the frontend constructs presence from its own user, received member events,
  and cursor events, so each client can temporarily or permanently derive a
  different list;
- `targetUserId` is included on sync events but is not used by the frontend;
- cross-instance Redis broadcast failure or a join/sync race can leave a late
  joiner at one participant while an existing client sees two;
- the 25-second heartbeat rebroadcasts individual presence, but it is not a
  versioned reconciliation and gives slow convergence rather than a guarantee;
- explicit `left` removes a user from every client even when another connection
  for that same user remains active, which is incorrect for two tabs;
- abrupt STOMP disconnects have no Spring disconnect listener. Redis entries
  become stale after three minutes, but the frontend is not sent a removal or a
  replacement snapshot, so stale avatars can remain indefinitely;
- current logging covers basic room joins and Redis mode, but not connection,
  subscription, snapshot, reconciliation, reconnect, or stale-removal stages.

Phase 4 should make a server-issued, revisioned presence snapshot the source of
truth. A join/subscription handshake should return the complete active list;
join, leave, disconnect, and stale-prune changes should publish either a new
snapshot or revisioned deltas. A user should be reported offline only after its
last server connection is gone. Reconnect must replace or refresh a connection
entry without duplicating the user.

Required diagnostics should include room code, server connection ID, user ID,
event/revision, and active count while avoiding tokens and message contents.

## Room cleanup architecture and gaps

Current cleanup is split across Spring and the Node Yjs service:

- Spring uses `ROOM_CLEANUP_GRACE_SECONDS` (default 120 seconds) and scans
  pending explicit-leave cleanup every five seconds;
- Redis presence entries have a three-minute stale TTL and room runtime keys
  have a 24-hour TTL;
- a Spring stale-room scan runs every minute and can remove empty room runtime
  state after the grace period;
- Node waits `ROOM_CLEANUP_GRACE_MS` (default 120 seconds) after the last Yjs
  socket closes, flushes snapshots, removes in-memory Yjs documents, and calls
  Spring's internal cleanup endpoint;
- explicit room close deletes the durable room workspace. Ordinary empty-room
  cleanup preserves durable room, membership, workspace, files, and snapshots.

The important gaps are:

- an abrupt STOMP disconnect does not immediately update Spring presence or
  schedule its cleanup path;
- Node can call Spring before the three-minute stale presence window expires;
  Spring then refuses cleanup, while Node does not retry that callback;
- Spring's pending-cleanup map is process-local, so it is not an authoritative
  multi-instance scheduler;
- the stale-room scan can delete Redis room state independently of the main
  cleanup coordinator;
- cleanup does not explicitly cover Yjs Redis update keys, temporary uploaded
  state, or execution keys; most of these currently rely on separate TTLs;
- idempotency exists for several delete operations, but there is no single
  cleanup record proving the full cleanup ran once.

Phase 4 should consolidate the empty-room decision around authoritative server
connections and a shared vacancy timestamp. Cleanup must be retryable and
idempotent, cancellation must clear the pending vacancy when any participant
rejoins, and each resource owner should expose a scoped cleanup operation. The
durable room/workspace/file data must remain intact unless the lead explicitly
closes the room.

## Layout and profile findings

The console already uses a vertical flex split rather than absolute positioning,
has a keyboard-accessible drag separator, persists height, and defaults to 250
pixels. Remaining concerns are:

- open/closed state is not persisted;
- JavaScript constrains the editor to 170 pixels while CSS allows 140 pixels;
- the console uses both flex sizing and a `max-height: 55%` constraint, which
  can make the saved height differ from the rendered height;
- at widths below 1,100 pixels the explorer and chat become absolute drawers
  over the editor rather than automatically collapsing or reserving space.

The execution toolbar is a single non-wrapping row until 700 pixels wide. Its
language selector has a 230-pixel minimum width, and the editor area clips
overflow, so controls can disappear in the laptop-width range before the mobile
overflow rule applies.

There is no documented z-index scale. Current values include negative layers
and positive values 1, 2, 3, 12, 20, 21, 30, 35, 40, and 80. Explorer and editor
ancestors use `overflow: hidden`, and Monaco is not configured to prefer fixed
overflow widgets. These are credible causes of clipped popovers and editor
widgets.

The IDE profile modal is explicitly near-black and contains an avatar upload
button and hidden file input. Phase 5 should remove IDE avatar mutation, retain
only appropriate account/participant information and display-name behavior,
and restyle the menu with the existing cream, tan, olive, and dark-green tokens.

## Verification baseline and later acceptance

Phase 1 baseline on 2026-07-15:

- frontend type check: passed;
- frontend tests: 43 passed;
- frontend production build: passed, with a pre-existing 2.7 MB main bundle
  warning;
- realtime syntax check: passed;
- realtime tests: 2 passed;
- backend tests: 50 passed;
- Vite development server: started and served the root page and transformed
  module graph successfully.

An interactive browser was not available in the Phase 1 workspace, so no visual
or independent-client claim is made. Later UI phases require browser checks at
common 13-inch laptop and desktop sizes. Phase 4 cannot be accepted until the
same room is exercised with at least two independent authenticated clients,
including a late join, reconnect, abrupt disconnect, and separate-device or
equivalent isolated-session coverage. Automated mocks alone are insufficient
for that claim.
