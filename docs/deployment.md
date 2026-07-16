# Production deployment

This guide describes the repository-supported, single-host deployment topology. It is production-inspired configuration for a portfolio/demo environment; it has not been deployed or load-tested by this repository change.

## Topology

```text
Internet
  -> Caddy (HTTPS, HTTP/2/3, WebSocket proxy)
     -> /api/*, /ws*       Spring Boot backend
     -> /yjs/*             Node Yjs realtime service
     -> everything else    Nginx-hosted React frontend

Spring Boot -> PostgreSQL
Spring Boot -> Redis -> execution workers -> Judge0
Node Yjs    -> Redis
Node Yjs    -> Spring internal snapshot/authentication APIs -> PostgreSQL
```

Only Caddy publishes host ports. PostgreSQL, Redis, Spring, Node, and Nginx stay on the private Compose network. Using one public origin avoids third-party-cookie restrictions and lets the secure `JSESSIONID` and CSRF cookie work consistently across REST and SockJS/STOMP. Caddy strips `/yjs` before proxying the Yjs WebSocket path expected by the Node service.

Judge0 is intentionally not bundled. A reliable self-hosted Judge0 installation includes its own database, queue, and workers; operate it separately or use a hosted Judge0-compatible provider.

## Prerequisites

- A Linux host with current Docker Engine and Docker Compose v2.
- A DNS `A`/`AAAA` record for `PUBLIC_APP_HOST` pointing to the host.
- Public inbound TCP ports 80 and 443, plus UDP 443 if HTTP/3 is desired.
- A Judge0-compatible endpoint reachable from the backend container.
- Enough persistent disk for PostgreSQL, Redis AOF, and Caddy certificate state.

## Configure secrets

From the repository root:

```bash
cp .env.production.example .env.production
chmod 600 .env.production
```

Replace every `change-me` value. Generate independent secrets; for example, `openssl rand -hex 32` is suitable for the internal-service token and local data-store passwords. Do not prefix frontend variables with secrets: every `VITE_*` value is compiled into the public browser bundle.

`PUBLIC_APP_HOST` is only the hostname, while `PUBLIC_APP_ORIGIN` is its exact HTTPS origin:

```env
PUBLIC_APP_HOST=pear.example.com
PUBLIC_APP_ORIGIN=https://pear.example.com
```

For self-hosted Judge0, `JUDGE0_API_KEY` and `JUDGE0_API_HOST` can remain empty. Hosted RapidAPI-compatible providers generally require both. Never use a private backend/Judge0 hostname in frontend variables.

## Validate and start

Validate interpolation before building:

```bash
docker compose --env-file .env.production -f docker-compose.production.yml config --quiet
```

Build and start in dependency order:

```bash
docker compose --env-file .env.production -f docker-compose.production.yml build
docker compose --env-file .env.production -f docker-compose.production.yml up -d
docker compose --env-file .env.production -f docker-compose.production.yml ps
```

Compose waits for PostgreSQL and Redis before Spring. Spring runs Flyway migrations and Hibernate validation before becoming healthy. Realtime then waits for Spring and reports ready only after Redis persistence and pub/sub are connected. The frontend and gateway start last.

Follow startup without printing environment variables:

```bash
docker compose --env-file .env.production -f docker-compose.production.yml logs -f backend realtime gateway
```

Verify the public liveness endpoint and TLS certificate:

```bash
curl --fail --show-error https://pear.example.com/healthz
```

Internal checks available from their containers are:

- Backend: `http://backend:8081/healthz` for process liveness and `/actuator/health/readiness` for Spring readiness.
- Realtime: `http://realtime:1235/healthz` for process liveness and `/readyz` for Redis-backed readiness.
- Frontend: `http://frontend:8080/health`.

The gateway deliberately does not expose internal Spring APIs, actuator metrics, realtime metrics, PostgreSQL, or Redis.

## WebSocket verification

The public browser configuration is compiled as:

```text
REST and SockJS origin: https://pear.example.com
STOMP endpoint:         https://pear.example.com/ws
Yjs endpoint:           wss://pear.example.com/yjs
```

Caddy automatically preserves WebSocket upgrades. If an upstream load balancer or CDN is added, it must also support long-lived WebSocket connections and must not cache `/api/*`, `/ws*`, or `/yjs/*`.

## Updates and migrations

Take a PostgreSQL backup before deploying schema changes. Then rebuild and recreate services:

```bash
docker compose --env-file .env.production -f docker-compose.production.yml build
docker compose --env-file .env.production -f docker-compose.production.yml up -d
```

Flyway migrations execute once during backend startup. A failed migration keeps the backend unhealthy and prevents dependent services from starting. Inspect backend logs, correct the migration or database condition, and restart; never edit a migration that has already been applied successfully.

The frontend URLs are Vite build arguments. A domain change requires rebuilding the frontend image, not merely restarting it.

## Backup and recovery

PostgreSQL is the durable source of truth for users, workspaces, rooms, files, and Yjs snapshots. Back it up on a schedule appropriate for the demo:

```bash
docker compose --env-file .env.production -f docker-compose.production.yml exec -T postgres \
  sh -c 'pg_dump --format=custom --username="$POSTGRES_USER" "$POSTGRES_DB"' > pearprogram.dump
```

Restore into an empty compatible database with `pg_restore`, then start the backend so Flyway can apply any later migrations. Test restores separately from production.

Redis uses append-only persistence, but it remains ephemeral coordination rather than the durable application database. Losing Redis may discard active presence, unflushed Yjs updates, execution results, leases, and queued jobs. Restart Redis first, then backend and realtime; affected executions should be treated as failed and rerun. PostgreSQL snapshots remain the recovery baseline for files.

Caddy's `caddy-data` volume contains certificate state. Losing it does not lose application data, but Caddy must obtain certificates again and may encounter certificate-authority rate limits.

## Failure recovery

- **Judge0 unavailable:** collaboration remains available. Execution workers use bounded retries and deadlines; restore provider connectivity and rerun code.
- **Judge0 language mismatch:** compare the configured provider's `GET /languages` response with `ExecutionLanguageRegistry`. The frontend reads Pear Programming's authenticated `/api/execution/languages` catalog, but provider-specific numeric IDs still need to match the deployed Judge0 instance.
- **Redis unavailable:** realtime `/readyz` becomes unhealthy and new execution submission fails closed. Restore Redis before restarting dependent services.
- **PostgreSQL unavailable:** Spring cannot start safely. Restore the database and verify Flyway history before bringing the stack up.
- **Realtime restart:** SIGTERM stops readiness, closes clients with a restart code, attempts a final PostgreSQL snapshot flush, and closes Redis connections. Browsers reconnect through Yjs.
- **Backend restart:** Spring uses graceful shutdown. Browser sessions are process-local, so users may need to sign in again after a restart.
- **Secret rotation:** update `.env.production`, then recreate both backend and realtime when rotating `INTERNAL_SERVICE_TOKEN`. Rebuild frontend only when public URL values change.

## Scaling assumptions

This Compose topology intentionally runs one backend and one realtime instance. Redis already coordinates room fanout, Yjs updates, execution jobs, and leases, but HTTP sessions and realtime access tokens remain process-local. Do not add backend replicas without either shared/signed session state or sticky routing. Do not add realtime replicas without verifying Redis pub/sub behavior and load-balancer WebSocket routing under failure.

Execution concurrency is bounded by `EXECUTION_WORKER_THREADS` per backend instance and by the Judge0 deployment. Increasing it without provider capacity creates backpressure rather than throughput.

For a managed deployment, map the same service boundaries to the platform's PostgreSQL, Redis TCP, container, TLS, and persistent-volume products. Preserve the same-origin routing and private internal endpoints.

## Security and operational limitations

- Containers and dependencies still require regular patching and image rebuilds. Tags should be pinned to reviewed digests in a stricter production environment.
- The Compose host is a single point of failure; it is appropriate for a demo, not a high-availability service.
- Database backups, restore drills, host monitoring, alerting, and secret management remain operator responsibilities.
- Judge0 is the sandbox boundary and must be independently isolated, patched, resource-limited, and prevented from reaching sensitive internal networks.
- Guest authentication has no email verification, account recovery, invitation workflow, or abuse prevention beyond the existing limits.
- This phase does not claim a deployed URL or a verified multi-user demonstration.
