# PearProgram

PearProgram is a production-grade portfolio project for a browser-based collaborative code editor. It uses a split real-time architecture:

- Spring Boot owns auth, rooms, metadata, chat, cursors, presence, AI proxying, persistence, and metrics.
- A separate Node `y-websocket` service owns Yjs CRDT document synchronization.
- React, Monaco, Yjs, SockJS/STOMP, Zustand, and Tailwind power the browser app.

## Repository Layout

```text
backend/   Spring Boot API, WebSocket/STOMP, JPA, Flyway, Redis, metrics
realtime/  Node y-websocket service with JWT validation and snapshot flushing
frontend/  Vite + React + TypeScript + Monaco collaborative editor UI
```

## Local Prerequisites

- Java 21
- Maven 3.9+
- Node 20+
- npm 10+
- Docker Desktop, optional for PostgreSQL and Redis

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
SPRING_AUTH_URL=http://localhost:8081/auth/validate
SNAPSHOT_ENDPOINT=http://localhost:8081/internal/files
ROOM_CLEANUP_ENDPOINT=http://localhost:8081/internal/rooms
PORT=1235
ALLOW_ANONYMOUS=true
```

Do not put `UPSTASH_REDIS_REST_URL` or `UPSTASH_REDIS_REST_TOKEN` into the realtime service unless the code is changed to use `@upstash/redis`. If no Redis TCP config is present, realtime starts with in-memory Yjs docs and logs that cross-instance persistence is unavailable.

## Postgres/Redis Mode

```powershell
docker compose up -d

cd backend
mvn spring-boot:run -Dspring-boot.run.profiles=postgres

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
- H2 console in no-Docker mode: `http://localhost:8081/h2-console`

For two laptops on the same network, `localhost` only points to each laptop itself. Start backend and realtime bound normally, then set the second laptop's frontend env to the host machine's LAN IP:

```env
VITE_API_BASE_URL=http://YOUR_LAN_IP:8081
VITE_STOMP_URL=http://YOUR_LAN_IP:8081/ws
VITE_YJS_URL=ws://YOUR_LAN_IP:1235
```

If you are serving the Vite dev app from the host laptop too, start it with `npm run dev -- --host 0.0.0.0` so the second laptop can open it.

The backend room table is the source of truth for create/join. Room codes are normalized by trimming spaces, removing dashes, and uppercasing before lookup.

## Architecture Notes

Yjs document edits flow only through the Node service. Spring handles STOMP events for chat, cursors, and presence. PostgreSQL stores durable snapshots and metadata, while Redis stores ephemeral room/session state with 24h TTL.

In default local mode, H2 stands in for PostgreSQL and Redis health is disabled so no-Docker development stays green. The `postgres` Spring profile turns Flyway validation and Redis health checks back on.

When the last user leaves a room, Spring schedules a short cleanup grace period before marking the room inactive. The realtime service also waits briefly after the last Yjs websocket closes, flushes snapshots, removes in-memory Yjs docs for that room, and asks Spring to clean up only if no members reconnected.

## Current Room UX

- The root page lets users create an empty room or join by room code.
- Rooms start empty. Users add code through New File, New Folder, Upload Files, or Upload Folder.
- Local uploads are the primary project-loading path. GitHub import scaffolding still exists in the backend, but it is not the primary UI flow.
- Monaco language highlighting is inferred from file extensions for JavaScript, TypeScript, Python, Java, C, C++, HTML, CSS, JSON, Markdown, SQL, and plaintext fallback.
- Editor changes autosave through the browser to Spring and continue to sync through the existing Yjs realtime path.
- If a populated multi-user room switches to another uploaded folder, participants must approve the switch through the room project-switch WebSocket event before files are replaced.
