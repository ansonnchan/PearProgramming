# Room presence and cleanup

## Presence source of truth

Spring owns room presence. Each STOMP connection is registered by the server-issued
`simpSessionId` and associated with the authenticated guest user ID. Redis stores
these connection records when available; the in-process map is the documented
single-instance fallback.

After a join, heartbeat, explicit leave, or socket disconnect, Spring publishes a
complete `presence-snapshot` containing the unique authenticated users currently
online. Snapshots have a monotonically increasing room revision. Clients replace
their participant list only with a newer revision, so late joiners, concurrent
joins, reconnects, multiple tabs, and separate devices converge on the same count.
Multiple connections for one authenticated user count as one participant, and a
user is removed only after their final connection leaves.

Connection, subscription, snapshot, join, leave, reconnect, and disconnect logs
include room, connection, user, revision, and active-count context without tokens
or chat/editor content.

## Empty-room cleanup

The default empty-room grace period is 120 seconds:

- Spring: `ROOM_CLEANUP_GRACE_SECONDS` (default `120`)
- Yjs realtime service: `ROOM_CLEANUP_GRACE_MS` (default `120000`)

An explicit leave or abrupt STOMP disconnect removes the server connection. When
the final connection is gone, Spring records the vacancy and schedules cleanup.
Any join or heartbeat cancels that cleanup and marks the room active again. Calls
to the cleanup operation are idempotent; if state is already gone or a participant
has rejoined, no resources are deleted.

Cleaned ephemeral data:

- active and recent presence, lead/lock runtime state, counters, and temporary
  annotation metadata in Spring/Redis;
- in-memory Yjs documents and Redis Yjs update logs after final snapshot flush;
- queued, leased, and retained execution records indexed to the room;
- in-process cursor, chat, upload-proposal, and console state when clients leave.

Preserved durable data:

- the room row and durable memberships;
- workspace and file rows, file contents, and saved snapshots;
- user profiles.

Only the Lead Pear's explicit **Close Room** action deletes the durable room
workspace. Ordinary empty-room cleanup keeps it available for reconnecting users.
If Redis is unavailable, presence and revisions are process-local; the application
logs that limitation because cross-instance convergence cannot be guaranteed until
Redis connectivity is restored.
