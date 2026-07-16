#!/usr/bin/env node

import { writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

const TERMINAL_STATUSES = new Set([
  'COMPLETED',
  'COMPILATION_ERROR',
  'RUNTIME_ERROR',
  'TIMED_OUT',
  'FAILED',
  'CANCELLED'
]);

const DEFAULT_SOURCE = {
  bash: 'printf "pear\\n"',
  c: '#include <stdio.h>\nint main(void) { puts("pear"); return 0; }',
  cpp: '#include <iostream>\nint main() { std::cout << "pear\\\\n"; }',
  java: 'class Main { public static void main(String[] args) { System.out.println("pear"); } }',
  javascript: 'console.log("pear");',
  python: 'print("pear")',
  typescript: 'console.log("pear");'
};

class HttpSession {
  constructor(origin) {
    this.origin = origin;
    this.cookies = new Map();
    this.csrfHeader = '';
    this.csrfToken = '';
  }

  async signIn(displayName) {
    await this.request('/api/auth/guest', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ displayName })
    });
    const csrf = await this.get('/api/auth/csrf');
    this.csrfHeader = csrf.headerName;
    this.csrfToken = csrf.token;
  }

  async get(path) {
    return this.request(path);
  }

  async mutate(path, body, extraHeaders = {}) {
    return this.request(path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [this.csrfHeader]: this.csrfToken,
        ...extraHeaders
      },
      body: JSON.stringify(body)
    });
  }

  async request(path, init = {}) {
    const headers = new Headers(init.headers);
    if (this.cookies.size > 0) {
      headers.set('cookie', [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; '));
    }
    const response = await fetch(`${this.origin}${path}`, { ...init, headers });
    this.captureCookies(response.headers);
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`${init.method ?? 'GET'} ${path} failed with ${response.status}: ${body.slice(0, 500)}`);
    }
    if (response.status === 204) {
      return null;
    }
    return response.json();
  }

  captureCookies(headers) {
    const setCookies = typeof headers.getSetCookie === 'function'
      ? headers.getSetCookie()
      : [headers.get('set-cookie')].filter(Boolean);
    for (const rawCookie of setCookies) {
      const [pair] = rawCookie.split(';');
      const separator = pair.indexOf('=');
      if (separator <= 0) {
        continue;
      }
      this.cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
  }
}

const options = parseArguments(process.argv.slice(2));
const baseUrl = options.baseUrl.replace(/\/+$/, '');
const session = new HttpSession(baseUrl);

await session.signIn(`Execution benchmark ${Date.now()}`);
const room = await session.mutate('/api/rooms/create', {});

const sourceCode = options.source ?? DEFAULT_SOURCE[options.language] ?? 'print("pear")';
const totalRequests = options.warmup + options.runs;
if (totalRequests > 10) {
  console.warn(
    `Running ${totalRequests} submissions. The backend defaults to 10 executions per user and room per minute; ` +
    'raise EXECUTION_RATE_LIMIT_PER_MINUTE for larger local benchmarks.'
  );
}

console.log(`Target: ${baseUrl}`);
console.log(`Room: ${room.code}`);
console.log(`Language: ${options.language}`);
console.log(`Warmup: ${options.warmup}; measured runs: ${options.runs}; concurrency: ${options.concurrency}`);

for (let index = 0; index < options.warmup; index += 1) {
  await executeSample(index, true);
}

const samples = new Array(options.runs);
let nextIndex = 0;
await Promise.all(Array.from({ length: options.concurrency }, async () => {
  while (true) {
    const index = nextIndex;
    nextIndex += 1;
    if (index >= options.runs) {
      return;
    }
    samples[index] = await executeSample(index, false);
  }
}));

const report = {
  generatedAt: new Date().toISOString(),
  target: baseUrl,
  roomCode: room.code,
  language: options.language,
  runs: options.runs,
  concurrency: options.concurrency,
  metrics: {
    clientEndToEndMs: summarize(samples.map((sample) => sample.clientEndToEndMs)),
    serverEndToEndMs: summarize(samples.map((sample) => sample.serverEndToEndMs)),
    submissionMs: summarize(samples.map((sample) => sample.submissionMs)),
    judgeRuntimeMs: summarize(samples.map((sample) => sample.judgeRuntimeMs)),
    orchestrationOverheadMs: summarize(samples.map((sample) => sample.orchestrationOverheadMs))
  },
  statuses: samples.reduce((counts, sample) => {
    counts[sample.status] = (counts[sample.status] ?? 0) + 1;
    return counts;
  }, {}),
  samples
};

printSummary(report);
if (options.output) {
  await writeFile(options.output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${options.output}`);
}

async function executeSample(index, warmup) {
  const idempotencyKey = `benchmark-${Date.now()}-${warmup ? 'warmup' : 'run'}-${index}-${crypto.randomUUID()}`;
  const startedAt = performance.now();
  const submitted = await session.mutate(
    `/api/rooms/${encodeURIComponent(room.code)}/executions`,
    { language: options.language, sourceCode, stdin: '' },
    { 'Idempotency-Key': idempotencyKey }
  );
  const submittedAt = performance.now();
  let result = submitted;

  while (!TERMINAL_STATUSES.has(result.status)) {
    if (performance.now() - startedAt > options.timeoutMs) {
      throw new Error(`Execution ${result.executionId} did not finish within ${options.timeoutMs} ms`);
    }
    await delay(options.pollMs);
    result = await session.get(`/api/rooms/${encodeURIComponent(room.code)}/executions/${result.executionId}`);
  }

  const observedAt = performance.now();
  const serverEndToEndMs = timestampDifference(result.createdAt, result.completedAt);
  const judgeRuntimeMs = numberOrNull(result.durationMs);
  const orchestrationOverheadMs = serverEndToEndMs === null || judgeRuntimeMs === null
    ? null
    : Math.max(0, serverEndToEndMs - judgeRuntimeMs);

  return {
    executionId: result.executionId,
    status: result.status,
    submissionMs: round(submittedAt - startedAt),
    clientEndToEndMs: round(observedAt - startedAt),
    serverEndToEndMs,
    judgeRuntimeMs,
    orchestrationOverheadMs
  };
}

function parseArguments(args) {
  const values = {
    baseUrl: process.env.PEAR_API_URL ?? 'http://localhost:8081',
    runs: 8,
    warmup: 1,
    concurrency: 1,
    language: 'javascript',
    source: null,
    pollMs: 100,
    timeoutMs: 60_000,
    output: null
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const value = args[index + 1];
    if (!argument.startsWith('--') || value === undefined) {
      throw new Error(`Expected --option value, received "${argument}"`);
    }
    index += 1;
    switch (argument) {
      case '--base-url': values.baseUrl = value; break;
      case '--runs': values.runs = positiveInteger(value, argument); break;
      case '--warmup': values.warmup = nonNegativeInteger(value, argument); break;
      case '--concurrency': values.concurrency = positiveInteger(value, argument); break;
      case '--language': values.language = value; break;
      case '--source': values.source = value; break;
      case '--poll-ms': values.pollMs = positiveInteger(value, argument); break;
      case '--timeout-ms': values.timeoutMs = positiveInteger(value, argument); break;
      case '--output': values.output = value; break;
      default: throw new Error(`Unknown option "${argument}"`);
    }
  }

  values.concurrency = Math.min(values.concurrency, values.runs);
  return values;
}

function summarize(rawValues) {
  const values = rawValues.filter((value) => Number.isFinite(value)).sort((left, right) => left - right);
  if (values.length === 0) {
    return null;
  }
  return {
    count: values.length,
    min: round(values[0]),
    p50: round(percentile(values, 0.5)),
    p95: round(percentile(values, 0.95)),
    p99: round(percentile(values, 0.99)),
    max: round(values.at(-1)),
    mean: round(values.reduce((sum, value) => sum + value, 0) / values.length)
  };
}

function percentile(sortedValues, quantile) {
  return sortedValues[Math.max(0, Math.ceil(sortedValues.length * quantile) - 1)];
}

function timestampDifference(createdAt, completedAt) {
  if (!createdAt || !completedAt) {
    return null;
  }
  const value = new Date(completedAt).getTime() - new Date(createdAt).getTime();
  return Number.isFinite(value) ? Math.max(0, value) : null;
}

function numberOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function positiveInteger(value, name) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function nonNegativeInteger(value, name) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return parsed;
}

function round(value) {
  return value === null ? null : Math.round(value * 100) / 100;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function printSummary(report) {
  console.log('\nExecution benchmark');
  for (const [name, summary] of Object.entries(report.metrics)) {
    if (!summary) {
      console.log(`- ${name}: unavailable`);
      continue;
    }
    console.log(
      `- ${name}: p50=${summary.p50} ms, p95=${summary.p95} ms, ` +
      `p99=${summary.p99} ms, mean=${summary.mean} ms`
    );
  }
  console.log(`- statuses: ${JSON.stringify(report.statuses)}`);
}
