const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');
const { WebSocketServer } = require('ws');
const Y = require('yjs');
const Redis = require('ioredis');
const { setupWSConnection, docs, getYDoc } = require('y-websocket/bin/utils');

const loadedEnvFiles = loadEnvFiles();
const PORT = numberFromEnv('PORT', 1235);
const SNAPSHOT_ENDPOINT = process.env.SNAPSHOT_ENDPOINT || '';
const ROOM_CLEANUP_ENDPOINT = process.env.ROOM_CLEANUP_ENDPOINT || deriveRoomCleanupEndpoint(SNAPSHOT_ENDPOINT);
const SNAPSHOT_INTERVAL_MS = numberFromEnv('SNAPSHOT_INTERVAL_MS', 30_000);
const ROOM_TTL_SECONDS = numberFromEnv('ROOM_TTL_SECONDS', 24 * 60 * 60);
const ROOM_CLEANUP_GRACE_MS = numberFromEnv('ROOM_CLEANUP_GRACE_MS', 120_000);
const REDIS_KEY_PREFIX = normalizeRedisKeyPrefix(process.env.PEARPROGRAM_REDIS_KEY_PREFIX || process.env.REDIS_KEY_PREFIX || 'pearprogram');
const REDIS_CONFIG = redisConfigFromEnv();
const INSTANCE_ID = randomInstanceId();
const REDIS_BROADCAST_ORIGIN = Symbol('redis-yjs-broadcast');
const YJS_BROADCAST_CHANNEL = `${REDIS_KEY_PREFIX}:yjs:broadcast`;

const hydratedDocs = new Set();
const persistenceAttached = new Set();
const lastFlushMs = new Map();
const roomSockets = new Map();
const roomCleanupTimers = new Map();
let redisAvailable = false;
let redisPubSubAvailable = false;
let redis = null;
let redisSubscriber = null;

log('info', 'Realtime configuration loaded', {
  envFiles: loadedEnvFiles,
  snapshotEndpoint: sanitizeUrl(SNAPSHOT_ENDPOINT),
  roomCleanupEndpoint: sanitizeUrl(ROOM_CLEANUP_ENDPOINT),
  cleanupGraceMs: ROOM_CLEANUP_GRACE_MS,
  instanceId: INSTANCE_ID
});

if (REDIS_CONFIG.enabled) {
  redis = new Redis({
    ...REDIS_CONFIG.options,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableReadyCheck: true
  });

  log('info', 'Redis configured for Yjs persistence', {
    mode: REDIS_CONFIG.mode,
    hostPresent: Boolean(REDIS_CONFIG.host),
    portPresent: Boolean(REDIS_CONFIG.port),
    sslEnabled: REDIS_CONFIG.tls,
    keyPrefix: REDIS_KEY_PREFIX
  });

  redis.on('ready', () => {
    redisAvailable = true;
    log('info', 'Redis connected for Yjs persistence', {
      mode: REDIS_CONFIG.mode,
      hostPresent: Boolean(REDIS_CONFIG.host),
      portPresent: Boolean(REDIS_CONFIG.port),
      sslEnabled: REDIS_CONFIG.tls,
      keyPrefix: REDIS_KEY_PREFIX
    });
    logMetric('redis_available', 1);
    startRedisPubSub();
  });

  redis.on('error', (error) => {
    if (redisAvailable) {
      log('warn', 'Redis unavailable for Yjs persistence; continuing with in-memory docs', {
        hostPresent: Boolean(REDIS_CONFIG.host),
        portPresent: Boolean(REDIS_CONFIG.port),
        sslEnabled: REDIS_CONFIG.tls,
        keyPrefix: REDIS_KEY_PREFIX,
        error: error.message
      });
    }
    redisAvailable = false;
    redisPubSubAvailable = false;
  });

  redis.connect().catch((error) => {
    redisAvailable = false;
    redisPubSubAvailable = false;
    log('warn', 'Redis connection failed on startup; continuing with in-memory docs', {
      mode: REDIS_CONFIG.mode,
      hostPresent: Boolean(REDIS_CONFIG.host),
      portPresent: Boolean(REDIS_CONFIG.port),
      sslEnabled: REDIS_CONFIG.tls,
      keyPrefix: REDIS_KEY_PREFIX,
      error: error.message
    });
  });
} else {
  log('warn', 'Redis is not configured; using in-memory Yjs docs only', {
    reason: REDIS_CONFIG.reason,
    expected: 'Set REDIS_URL to an Upstash TCP URL such as rediss://default:<token>@<host>:6379'
  });
}

const server = http.createServer(async (req, res) => {
  if (req.url === '/health') {
    json(res, 200, {
      status: 'ok',
      redisAvailable,
      redisPubSubAvailable,
      redisMode: REDIS_CONFIG.mode,
      redisKeyPrefix: REDIS_KEY_PREFIX,
      activeDocs: docs.size,
      activeRooms: roomSockets.size
    });
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

  req.pearDocName = parsed.docName;
  req.pearRoomCode = parsed.roomCode;
  req.pearFileId = parsed.fileId;
  req.pearUser = { valid: true, userId: 'anonymous', displayName: 'Guest' };

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

wss.on('connection', async (ws, req) => {
  const { pearDocName: docName, pearRoomCode: roomCode, pearFileId: fileId } = req;
  const doc = getYDoc(docName);

  if (!hydratedDocs.has(docName)) {
    hydratedDocs.add(docName);
    await hydrateDoc(doc, roomCode, fileId);
  }

  setupWSConnection(ws, req, { docName });
  trackRoomConnection(roomCode, ws);
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

async function hydrateDoc(doc, roomCode, fileId) {
  await hydratePostgresSnapshot(doc, roomCode, fileId);
  await hydrateRedisUpdates(doc, roomCode, fileId);
}

async function hydratePostgresSnapshot(doc, roomCode, fileId) {
  if (!SNAPSHOT_ENDPOINT) {
    return;
  }

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
  if (!redis || !redisAvailable) {
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
  doc.on('update', async (update, origin) => {
    if (origin === REDIS_BROADCAST_ORIGIN) {
      return;
    }

    logMetric('yjs_sync_delay_ms', 0, roomCode);
    if (!redis || !redisAvailable) {
      return;
    }

    try {
      const key = redisKey(roomCode, fileId);
      await redis.rpush(key, Buffer.from(update).toString('base64'));
      await redis.expire(key, ROOM_TTL_SECONDS);
      await publishYjsUpdate(docName, roomCode, fileId, update);
    } catch (error) {
      log('warn', 'Unable to persist Yjs update to Redis', { room: roomCode, fileId, error: error.message });
    }
  });
}

async function publishYjsUpdate(docName, roomCode, fileId, update) {
  if (!redis || !redisAvailable) {
    return;
  }

  try {
    await redis.publish(YJS_BROADCAST_CHANNEL, JSON.stringify({
      originInstanceId: INSTANCE_ID,
      docName,
      roomCode,
      fileId,
      update: Buffer.from(update).toString('base64')
    }));
  } catch (error) {
    log('warn', 'Unable to publish Yjs update to Redis pub/sub', { room: roomCode, fileId, error: error.message });
  }
}

function startRedisPubSub() {
  if (!redis || redisSubscriber) {
    return;
  }

  redisSubscriber = redis.duplicate({
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableReadyCheck: true
  });

  redisSubscriber.on('ready', () => {
    redisPubSubAvailable = true;
    log('info', 'Redis pub/sub connected for live Yjs fanout', {
      channel: YJS_BROADCAST_CHANNEL,
      instanceId: INSTANCE_ID
    });
  });

  redisSubscriber.on('message', (channel, raw) => {
    if (channel !== YJS_BROADCAST_CHANNEL) {
      return;
    }
    applyRemoteYjsUpdate(raw);
  });

  redisSubscriber.on('error', (error) => {
    if (redisPubSubAvailable) {
      log('warn', 'Redis pub/sub unavailable for live Yjs fanout; cross-instance edits may not sync in real time', {
        error: error.message
      });
    }
    redisPubSubAvailable = false;
  });

  redisSubscriber.connect()
    .then(() => redisSubscriber.subscribe(YJS_BROADCAST_CHANNEL))
    .catch((error) => {
      redisPubSubAvailable = false;
      redisSubscriber?.disconnect();
      redisSubscriber = null;
      log('warn', 'Redis pub/sub connection failed; cross-instance edits may not sync in real time', {
        error: error.message,
        channel: YJS_BROADCAST_CHANNEL
      });
      setTimeout(startRedisPubSub, 30_000).unref?.();
    });
}

function applyRemoteYjsUpdate(raw) {
  try {
    const event = JSON.parse(raw);
    if (event.originInstanceId === INSTANCE_ID) {
      return;
    }
    if (!event.docName || !event.update) {
      return;
    }

    const doc = docs.get(event.docName);
    if (!doc) {
      return;
    }

    Y.applyUpdate(doc, Buffer.from(event.update, 'base64'), REDIS_BROADCAST_ORIGIN);
  } catch (error) {
    log('warn', 'Unable to apply remote Yjs update from Redis pub/sub', { error: error.message });
  }
}

async function flushSnapshots() {
  for (const [docName, doc] of docs.entries()) {
    await flushSnapshot(docName, doc);
  }
}

async function flushRoomSnapshots(roomCode) {
  const prefix = `${roomCode}:`;
  for (const [docName, doc] of docs.entries()) {
    if (docName.startsWith(prefix)) {
      await flushSnapshot(docName, doc);
    }
  }
}

async function flushSnapshot(docName, doc) {
  if (!SNAPSHOT_ENDPOINT) {
    return;
  }

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

function trackRoomConnection(roomCode, ws) {
  cancelRoomCleanup(roomCode);

  let sockets = roomSockets.get(roomCode);
  if (!sockets) {
    sockets = new Set();
    roomSockets.set(roomCode, sockets);
  }
  sockets.add(ws);

  ws.on('close', () => {
    const current = roomSockets.get(roomCode);
    if (!current) {
      return;
    }

    current.delete(ws);
    if (current.size > 0) {
      return;
    }

    roomSockets.delete(roomCode);
    scheduleRoomCleanup(roomCode);
  });
}

function scheduleRoomCleanup(roomCode) {
  cancelRoomCleanup(roomCode);

  const timer = setTimeout(() => {
    roomCleanupTimers.delete(roomCode);
    cleanupInactiveRoom(roomCode).catch((error) => {
      log('warn', 'Room cleanup failed', { room: roomCode, error: error.message });
    });
  }, ROOM_CLEANUP_GRACE_MS);

  timer.unref?.();
  roomCleanupTimers.set(roomCode, timer);
  log('info', 'Scheduled Yjs room cleanup', { room: roomCode, graceMs: ROOM_CLEANUP_GRACE_MS });
}

function cancelRoomCleanup(roomCode) {
  const timer = roomCleanupTimers.get(roomCode);
  if (!timer) {
    return;
  }

  clearTimeout(timer);
  roomCleanupTimers.delete(roomCode);
  log('info', 'Cancelled pending Yjs room cleanup', { room: roomCode });
}

async function cleanupInactiveRoom(roomCode) {
  if (roomSockets.has(roomCode)) {
    log('info', 'Skipped Yjs room cleanup because users reconnected', { room: roomCode });
    return;
  }

  await flushRoomSnapshots(roomCode);
  const removedDocs = cleanupInMemoryRoomDocs(roomCode);
  await notifyBackendRoomCleanup(roomCode);
  log('info', 'Cleaned up inactive Yjs room state', { room: roomCode, removedDocs });
}

function cleanupInMemoryRoomDocs(roomCode) {
  const prefix = `${roomCode}:`;
  let removed = 0;

  for (const [docName, doc] of docs.entries()) {
    if (!docName.startsWith(prefix)) {
      continue;
    }

    doc.destroy();
    docs.delete(docName);
    hydratedDocs.delete(docName);
    persistenceAttached.delete(docName);
    lastFlushMs.delete(docName);
    removed += 1;
  }

  return removed;
}

async function notifyBackendRoomCleanup(roomCode) {
  if (!ROOM_CLEANUP_ENDPOINT) {
    return;
  }

  try {
    const response = await fetch(`${ROOM_CLEANUP_ENDPOINT}/${encodeURIComponent(roomCode)}/cleanup`, {
      method: 'POST',
      signal: AbortSignal.timeout(5000)
    });

    if (!response.ok) {
      log('warn', 'Backend room cleanup returned non-OK status', { room: roomCode, status: response.status });
    }
  } catch (error) {
    log('warn', 'Backend room cleanup request failed', { room: roomCode, error: error.message });
  }
}

function redisKey(roomCode, fileId) {
  return `${REDIS_KEY_PREFIX}:yjs:${roomCode}:${fileId}:updates`;
}

function normalizeRedisKeyPrefix(value) {
  const normalized = String(value || '').trim().replace(/^:+|:+$/g, '');
  return normalized || 'pearprogram';
}

function randomInstanceId() {
  return Math.random().toString(36).slice(2, 10);
}

function redisConfigFromEnv() {
  if (process.env.REDIS_URL) {
    try {
      const parsed = new URL(process.env.REDIS_URL);
      return {
        enabled: true,
        mode: 'tcp-url',
        host: parsed.hostname,
        port: Number(parsed.port || 6379),
        tls: parsed.protocol === 'rediss:',
        options: {
          host: parsed.hostname,
          port: Number(parsed.port || 6379),
          username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
          password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
          tls: parsed.protocol === 'rediss:' ? {} : undefined
        }
      };
    } catch {
      return {
        enabled: false,
        mode: 'invalid-tcp-url',
        reason: 'REDIS_URL is set but is not a valid Redis TCP URL.'
      };
    }
  }

  const restConfigured = process.env.UPSTASH_REDIS_REST_URL || process.env.UPSTASH_REDIS_REST_TOKEN;
  const tcpConfigured = process.env.REDIS_HOST || process.env.REDIS_PASSWORD || process.env.REDIS_PORT || process.env.REDIS_TLS;
  if (!tcpConfigured) {
    return {
      enabled: false,
      mode: restConfigured ? 'unsupported-upstash-rest' : 'memory',
      reason: restConfigured
        ? 'UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN is set, but this service uses ioredis and requires REDIS_URL.'
        : 'No Redis TCP environment variables were provided.'
    };
  }

  const useTls = (process.env.REDIS_TLS || 'false').toLowerCase() === 'true';
  const host = process.env.REDIS_HOST || 'localhost';
  const port = Number(process.env.REDIS_PORT || 6379);
  return {
    enabled: true,
    mode: 'tcp-host',
    host,
    port,
    tls: useTls,
    options: {
      host,
      port,
      password: process.env.REDIS_PASSWORD || undefined,
      tls: useTls ? {} : undefined
    }
  };
}

function loadEnvFiles() {
  const candidates = [
    path.resolve(__dirname, '..', '.env'),
    path.resolve(__dirname, '..', '.env.local')
  ];
  const loaded = [];

  for (const filePath of candidates) {
    if (!fs.existsSync(filePath)) {
      continue;
    }

    const fileName = path.basename(filePath);
    loaded.push(fileName);
    const content = fs.readFileSync(filePath, 'utf8');
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) {
        continue;
      }

      const assignment = line.startsWith('export ') ? line.slice('export '.length) : line;
      const equalsIndex = assignment.indexOf('=');
      if (equalsIndex === -1) {
        continue;
      }

      const key = assignment.slice(0, equalsIndex).trim();
      let value = assignment.slice(equalsIndex + 1).trim();
      if (!key || process.env[key] !== undefined) {
        continue;
      }

      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  }

  return loaded;
}

function deriveRoomCleanupEndpoint(snapshotEndpoint) {
  return snapshotEndpoint.replace(/\/internal\/files\/?$/, '/internal/rooms');
}

function numberFromEnv(name, fallback) {
  const parsed = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sanitizeUrl(value) {
  try {
    const url = new URL(value);
    if (url.username || url.password) {
      url.username = url.username ? '<redacted>' : '';
      url.password = url.password ? '<redacted>' : '';
    }
    return url.toString();
  } catch {
    return value;
  }
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
