const http = require('node:http');
const { URL } = require('node:url');
const { WebSocketServer } = require('ws');
const Y = require('yjs');
const Redis = require('ioredis');
const { setupWSConnection, docs } = require('y-websocket/bin/utils');

const PORT = Number(process.env.PORT || 1235);
const SPRING_AUTH_URL = process.env.SPRING_AUTH_URL || 'http://localhost:8081/auth/validate';
const SNAPSHOT_ENDPOINT = process.env.SNAPSHOT_ENDPOINT || 'http://localhost:8081/internal/files';
const ALLOW_ANONYMOUS = (process.env.ALLOW_ANONYMOUS || 'true').toLowerCase() === 'true';
const SNAPSHOT_INTERVAL_MS = Number(process.env.SNAPSHOT_INTERVAL_MS || 30_000);
const ROOM_TTL_SECONDS = Number(process.env.ROOM_TTL_SECONDS || 24 * 60 * 60);
const REDIS_OPTIONS = redisOptionsFromEnv();

const hydratedDocs = new Set();
const persistenceAttached = new Set();
const lastFlushMs = new Map();
let redisAvailable = false;

const redis = new Redis({
  ...REDIS_OPTIONS,
  lazyConnect: true,
  maxRetriesPerRequest: 1,
  enableReadyCheck: true
});

redis.on('ready', () => {
  redisAvailable = true;
  logMetric('redis_available', 1);
});

redis.on('error', (error) => {
  if (redisAvailable) {
    log('warn', 'Redis unavailable for Yjs persistence; continuing with in-memory docs', { error: error.message });
  }
  redisAvailable = false;
});

redis.connect().catch((error) => {
  log('warn', 'Redis connection failed on startup; continuing with in-memory docs', { error: error.message });
});

const server = http.createServer(async (req, res) => {
  if (req.url === '/health') {
    json(res, 200, { status: 'ok', redisAvailable, activeDocs: docs.size });
    return;
  }

  if (req.url === '/metrics') {
    res.writeHead(200, { 'content-type': 'text/plain; version=0.0.4' });
    res.end(renderMetrics());
    return;
  }

  json(res, 404, { error: 'not_found' });
});

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', async (req, socket, head) => {
  const parsed = parseDocRequest(req);
  if (!parsed) {
    socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
    socket.destroy();
    return;
  }

  const auth = await validateRequest(req);
  if (!auth.valid) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  req.pearDocName = parsed.docName;
  req.pearRoomCode = parsed.roomCode;
  req.pearFileId = parsed.fileId;
  req.pearUser = auth;

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

wss.on('connection', async (ws, req) => {
  const { pearDocName: docName, pearRoomCode: roomCode, pearFileId: fileId } = req;
  setupWSConnection(ws, req, { docName });

  const doc = docs.get(docName);
  if (!doc) {
    log('warn', 'y-websocket did not create a doc for connection', { docName });
    return;
  }

  if (!hydratedDocs.has(docName)) {
    hydratedDocs.add(docName);
    await hydrateDoc(doc, roomCode, fileId);
  }

  attachRedisPersistence(doc, roomCode, fileId);
  log('info', 'Yjs client connected', { room: roomCode, fileId, activeDocs: docs.size });
});

setInterval(() => {
  flushSnapshots().catch((error) => log('error', 'Snapshot flush loop failed', { error: error.message }));
}, SNAPSHOT_INTERVAL_MS).unref();

server.listen(PORT, () => {
  log('info', 'PearProgram y-websocket service listening', { port: PORT });
});

function parseDocRequest(req) {
  const url = new URL(req.url, 'http://localhost');
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length !== 2) {
    return null;
  }

  const [roomCode, fileId] = parts;
  return {
    roomCode,
    fileId,
    docName: `${roomCode}:${fileId}`
  };
}

async function validateRequest(req) {
  const authorization = extractAuthorization(req);
  if (!authorization && ALLOW_ANONYMOUS) {
    return { valid: true, userId: 'anonymous', displayName: 'Guest' };
  }
  if (!authorization) {
    return { valid: false };
  }

  try {
    const response = await fetch(SPRING_AUTH_URL, {
      headers: { authorization },
      signal: AbortSignal.timeout(2500)
    });
    if (!response.ok) {
      return { valid: false };
    }
    return response.json();
  } catch (error) {
    log('warn', 'JWT validation request failed', { error: error.message });
    return ALLOW_ANONYMOUS ? { valid: true, userId: 'anonymous', displayName: 'Guest' } : { valid: false };
  }
}

function extractAuthorization(req) {
  if (req.headers.authorization) {
    return req.headers.authorization;
  }
  const url = new URL(req.url, 'http://localhost');
  const token = url.searchParams.get('token');
  return token ? `Bearer ${token}` : null;
}

async function hydrateDoc(doc, roomCode, fileId) {
  await hydratePostgresSnapshot(doc, roomCode, fileId);
  await hydrateRedisUpdates(doc, roomCode, fileId);
}

async function hydratePostgresSnapshot(doc, roomCode, fileId) {
  try {
    const response = await fetch(`${SNAPSHOT_ENDPOINT}/${fileId}/snapshot`, {
      signal: AbortSignal.timeout(2500)
    });
    if (!response.ok) {
      return;
    }

    const snapshot = await response.json();
    if (snapshot.encodedState && looksLikeBase64(snapshot.encodedState)) {
      Y.applyUpdate(doc, Buffer.from(snapshot.encodedState, 'base64'));
      log('info', 'Loaded PostgreSQL Yjs snapshot', { room: roomCode, fileId });
    } else if (snapshot.plainText) {
      const yText = doc.getText('monaco');
      if (yText.length === 0) {
        yText.insert(0, snapshot.plainText);
      }
      log('info', 'Loaded PostgreSQL plain-text snapshot', { room: roomCode, fileId });
    }
  } catch (error) {
    log('warn', 'Unable to hydrate PostgreSQL snapshot', { room: roomCode, fileId, error: error.message });
  }
}

async function hydrateRedisUpdates(doc, roomCode, fileId) {
  if (!redisAvailable) {
    return;
  }

  try {
    const updates = await redis.lrange(redisKey(roomCode, fileId), 0, -1);
    for (const update of updates) {
      Y.applyUpdate(doc, Buffer.from(update, 'base64'));
    }
    if (updates.length > 0) {
      log('info', 'Applied Redis Yjs updates', { room: roomCode, fileId, updates: updates.length });
    }
  } catch (error) {
    log('warn', 'Unable to hydrate Redis Yjs updates', { room: roomCode, fileId, error: error.message });
  }
}

function attachRedisPersistence(doc, roomCode, fileId) {
  const docName = `${roomCode}:${fileId}`;
  if (persistenceAttached.has(docName)) {
    return;
  }

  persistenceAttached.add(docName);
  doc.on('update', async (update) => {
    logMetric('yjs_sync_delay_ms', 0, roomCode);
    if (!redisAvailable) {
      return;
    }

    try {
      const key = redisKey(roomCode, fileId);
      await redis.rpush(key, Buffer.from(update).toString('base64'));
      await redis.expire(key, ROOM_TTL_SECONDS);
    } catch (error) {
      log('warn', 'Unable to persist Yjs update to Redis', { room: roomCode, fileId, error: error.message });
    }
  });
}

async function flushSnapshots() {
  for (const [docName, doc] of docs.entries()) {
    const [roomCode, fileId] = docName.split(':');
    const started = performance.now();
    const encodedState = Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64');
    const plainText = doc.getText('monaco').toString();

    try {
      const response = await fetch(`${SNAPSHOT_ENDPOINT}/${fileId}/snapshot`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ roomCode, encodedState, plainText }),
        signal: AbortSignal.timeout(5000)
      });

      const durationMs = Math.round(performance.now() - started);
      lastFlushMs.set(docName, durationMs);
      logMetric('snapshot_flush_ms', durationMs, roomCode);

      if (!response.ok) {
        log('warn', 'Snapshot flush returned non-OK status', { room: roomCode, fileId, status: response.status });
      }
    } catch (error) {
      log('warn', 'Snapshot flush failed', { room: roomCode, fileId, error: error.message });
    }
  }
}

function redisKey(roomCode, fileId) {
  return `yjs:${roomCode}:${fileId}:updates`;
}

function redisOptionsFromEnv() {
  if (process.env.REDIS_URL) {
    const parsed = new URL(process.env.REDIS_URL);
    return {
      host: parsed.hostname,
      port: Number(parsed.port || 6379),
      username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
      password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
      tls: parsed.protocol === 'rediss:' ? {} : undefined
    };
  }

  const useTls = (process.env.REDIS_TLS || 'false').toLowerCase() === 'true';
  return {
    host: process.env.REDIS_HOST || 'localhost',
    port: Number(process.env.REDIS_PORT || 6379),
    password: process.env.REDIS_PASSWORD || undefined,
    tls: useTls ? {} : undefined
  };
}

function looksLikeBase64(value) {
  return /^[A-Za-z0-9+/=]+$/.test(value) && value.length % 4 === 0;
}

function renderMetrics() {
  const lines = [
    '# HELP pear_yjs_active_docs Active Yjs documents in memory',
    '# TYPE pear_yjs_active_docs gauge',
    `pear_yjs_active_docs ${docs.size}`,
    '# HELP pear_redis_available Whether Redis is available to the y-websocket service',
    '# TYPE pear_redis_available gauge',
    `pear_redis_available ${redisAvailable ? 1 : 0}`,
    '# HELP pear_snapshot_flush_ms Last snapshot flush duration by document',
    '# TYPE pear_snapshot_flush_ms gauge'
  ];

  for (const [docName, value] of lastFlushMs.entries()) {
    const [roomCode, fileId] = docName.split(':');
    lines.push(`pear_snapshot_flush_ms{room="${roomCode}",file="${fileId}"} ${value}`);
  }

  return `${lines.join('\n')}\n`;
}

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function logMetric(metric, value, room) {
  log('metric', metric, { metric, value, room });
}

function log(level, message, fields = {}) {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    message,
    service: 'pearprogram-realtime',
    ...fields
  }));
}
