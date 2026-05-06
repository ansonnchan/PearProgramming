# PearProgram

PearProgram is a browser-based collaborative code editor. It uses a split real-time architecture:

- Spring Boot owns rooms, chat, cursors, presence, room permissions, AI proxying, cleanup, and metrics.
- A separate Node `y-websocket` service owns Yjs CRDT document synchronization and optional Redis-backed update persistence.
- React, Monaco, Yjs, SockJS/STOMP, and Tailwind power the browser app.

## Repository Layout

```text
backend/   Spring Boot API, WebSocket/STOMP, Redis-backed room presence, metrics
realtime/  Node y-websocket service with optional Redis persistence and snapshot flushing
frontend/  Vite + React + TypeScript + Monaco collaborative editor UI
```

## Local Prerequisites

- Java 21
- Maven 3.9+
- Node 20+
- npm 10+
- Docker Desktop, optional for Redis

## Quick Start Without Docker

The default backend profile uses local H2 persistence and placeholder AI behavior, so the app runs without Docker:

```powershell
cd backend
mvn spring-boot:run

cd ../realtime
npm install
npm run dev

cd ../frontend
npm install
npm run dev
```

The realtime service loads `realtime/.env` automatically when it starts. It uses `ioredis`, so Upstash must be configured with the TCP URL:

```env
REDIS_URL=rediss://default:<upstash-token>@<upstash-host>:6379
SNAPSHOT_ENDPOINT=http://localhost:8081/internal/files
ROOM_CLEANUP_ENDPOINT=http://localhost:8081/internal/rooms
ROOM_CLEANUP_GRACE_MS=120000
PORT=1235
```

Do not put `UPSTASH_REDIS_REST_URL` or `UPSTASH_REDIS_REST_TOKEN` into the realtime service unless the code is changed to use `@upstash/redis`. If no Redis TCP config is present, realtime starts with in-memory Yjs docs and logs that cross-instance persistence is unavailable.

## Redis Mode

```powershell
docker compose up -d

cd backend
mvn spring-boot:run

cd ../realtime
npm install
npm run dev

cd ../frontend
npm install
npm run dev
```

Default local endpoints:

- Frontend: `http://localhost:5173`
- Spring API/STOMP: `http://localhost:8081`
- Node Yjs WebSocket: `ws://localhost:1235`

For two laptops on the same network, `localhost` only points to each laptop itself. Start backend and realtime bound normally, then set the second laptop's frontend env to the host machine's LAN IP:

```env
VITE_API_BASE_URL=http://YOUR_LAN_IP:8081
VITE_STOMP_URL=http://YOUR_LAN_IP:8081/ws
VITE_YJS_URL=ws://YOUR_LAN_IP:1235
```

If you are serving the Vite dev app from the host laptop too, start it with `npm run dev -- --host 0.0.0.0` so the second laptop can open it.

The backend room service is the source of truth for create/join. Room codes are normalized by trimming spaces, removing dashes, and uppercasing before lookup.

## Architecture Notes

Yjs document edits flow only through the Node service. Spring handles STOMP events for chat, cursors, permissions, file-tree sync events, and presence. Redis stores ephemeral room/session state with 24h TTL when configured; otherwise the backend falls back to in-memory room state for local development.

Supabase/PostgreSQL variables are not required by the current local runtime because file metadata and snapshots are not persisted through JPA in this version. Do not add Supabase credentials to `.env.example`; keep any production database credentials in the deployment provider's private environment settings.

When the last user leaves a room, Spring marks it inactive and schedules cleanup after `ROOM_CLEANUP_GRACE_SECONDS` seconds. The realtime service also waits after the last Yjs websocket closes, flushes snapshots when `SNAPSHOT_ENDPOINT` is configured, removes in-memory Yjs docs for that room, and asks Spring to clean up only if no members reconnected.

## Current Room UX

- The root page lets users create an empty room or join by room code.
- Rooms start empty. Users add code through New File, New Folder, Upload Files, or Upload Folder.
- Local uploads are the primary project-loading path. GitHub import scaffolding still exists in the backend, but it is not the primary UI flow.
- Monaco language highlighting is inferred from file extensions for JavaScript, TypeScript, Python, Java, C, C++, HTML, CSS, JSON, Markdown, SQL, and plaintext fallback.
- Editor changes autosave through the browser to Spring and continue to sync through the existing Yjs realtime path.
- If a populated multi-user room switches to another uploaded folder, participants must approve the switch through the room project-switch WebSocket event before files are replaced.
