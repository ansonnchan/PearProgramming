const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const { once } = require('node:events');
const test = require('node:test');

const SERVER_PATH = path.join(__dirname, 'server.cjs');

test('health and readiness stay available through graceful shutdown', async (t) => {
  const running = await startServer(false);
  t.after(() => stopIfRunning(running.child));

  const health = await fetch(`http://127.0.0.1:${running.port}/healthz`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).status, 'ok');

  const ready = await fetch(`http://127.0.0.1:${running.port}/readyz`);
  assert.equal(ready.status, 200);
  assert.equal((await ready.json()).status, 'ready');

  running.child.kill('SIGTERM');
  const [code, signal] = await once(running.child, 'exit');
  assert.equal(code, 0, running.output());
  assert.equal(signal, null);
});

test('production readiness fails closed when required Redis is unavailable', async (t) => {
  const running = await startServer(true);
  t.after(() => stopIfRunning(running.child));

  const ready = await fetch(`http://127.0.0.1:${running.port}/readyz`);
  assert.equal(ready.status, 503);
  assert.deepEqual(await ready.json(), {
    status: 'not_ready',
    redisRequired: true,
    redisAvailable: false,
    redisPubSubAvailable: false
  });

  running.child.kill('SIGTERM');
  const [code] = await once(running.child, 'exit');
  assert.equal(code, 0, running.output());
});

async function startServer(requireRedis) {
  const port = await availablePort();
  let logs = '';
  const child = spawn(process.execPath, [SERVER_PATH], {
    env: {
      ...process.env,
      PORT: String(port),
      REQUIRE_REDIS: String(requireRedis),
      REDIS_URL: '',
      REDIS_HOST: '',
      REDIS_PORT: '',
      REDIS_PASSWORD: '',
      REDIS_TLS: '',
      SNAPSHOT_ENDPOINT: '',
      ROOM_CLEANUP_ENDPOINT: ''
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', (chunk) => { logs += chunk.toString(); });
  child.stderr.on('data', (chunk) => { logs += chunk.toString(); });

  try {
    await waitForHealth(port, child);
  } catch (error) {
    stopIfRunning(child);
    throw new Error(`${error.message}\n${logs}`);
  }
  return { child, port, output: () => logs };
}

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function waitForHealth(port, child) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`server exited with ${child.exitCode}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/healthz`);
      if (response.ok) {
        return;
      }
    } catch {
      // Startup is still in progress.
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('server did not become healthy');
}

function stopIfRunning(child) {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
  }
}
