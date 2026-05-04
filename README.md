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
- Spring API/STOMP: `http://localhost:8080`
- Node Yjs WebSocket: `ws://localhost:1234`
- H2 console in no-Docker mode: `http://localhost:8080/h2-console`

## Architecture Notes

Yjs document edits flow only through the Node service. Spring handles STOMP events for chat, cursors, and presence. PostgreSQL stores durable snapshots and metadata, while Redis stores ephemeral room/session state with 24h TTL.

In default local mode, H2 stands in for PostgreSQL and Redis health is disabled so no-Docker development stays green. The `postgres` Spring profile turns Flyway validation and Redis health checks back on.

## Current Room UX

- The root page lets users create an empty room or join by room code.
- Rooms start empty. Users add code through New File, New Folder, Upload Files, or Upload Folder.
- Local uploads are the primary project-loading path. GitHub import scaffolding still exists in the backend, but it is not the primary UI flow.
- Monaco language highlighting is inferred from file extensions for JavaScript, TypeScript, Python, Java, C, C++, HTML, CSS, JSON, Markdown, SQL, and plaintext fallback.
- Editor changes autosave through the browser to Spring and continue to sync through the existing Yjs realtime path.
- If a populated multi-user room switches to another uploaded folder, participants must approve the switch through the room project-switch WebSocket event before files are replaced.
