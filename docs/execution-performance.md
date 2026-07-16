# Execution performance

Pear Programming records execution latency without treating Judge0's program runtime as end-to-end latency.

## Metrics

Spring Actuator and Prometheus expose:

| Metric | Definition |
| --- | --- |
| `execution_queue_wait_seconds` | Submission acceptance to the first worker claim |
| `execution_end_to_end_seconds` | Submission acceptance to a terminal execution state |
| `execution_orchestration_overhead_seconds` | End-to-end time minus Judge0-reported program runtime |
| `execution_recovery_detection_delay_seconds` | Lease expiration to recovery processing |
| `execution_recoveries_total` | Expired leases processed, tagged as requeued or finalized |
| `execution_queue_depth` | Jobs currently available for workers to claim |

Latency timers publish p50, p95, and p99 percentiles plus histogram buckets. Metrics do not use room or user identifiers as tags, avoiding unbounded metric cardinality.

`execution_orchestration_overhead_seconds` is an approximation. It includes queueing, network time, Judge0 queueing and compilation, and result-polling delay because Judge0's `time` field only reports program runtime.

## End-to-end benchmark

Start the application with Judge0 configured, then run:

```bash
node scripts/benchmark-execution.mjs \
  --base-url http://localhost:8081 \
  --language javascript \
  --warmup 5 \
  --runs 100 \
  --concurrency 4 \
  --output execution-benchmark.json
```

The backend defaults to 10 execution submissions per user and room each minute. Raise `EXECUTION_RATE_LIMIT_PER_MINUTE` for a controlled local benchmark instead of bypassing the limit with multiple identities.

The report separates:

- client-observed completion time;
- server lifecycle time from `createdAt` to `completedAt`;
- Judge0-reported program runtime;
- approximate orchestration overhead.

Judge0 polling starts at `JUDGE0_INITIAL_POLL_INTERVAL` (100 ms by default) and backs off exponentially to
`JUDGE0_POLL_INTERVAL` (750 ms by default). This reduces completion latency for short programs without applying
the fastest polling rate throughout the execution deadline.

Run benchmarks against a warmed deployment and record the environment, Judge0 provider, language, run count, concurrency, and date. Free-tier cold starts should be reported separately rather than removed without explanation.

## Recovery benchmark

Start the repository Redis service, then run:

```bash
cd backend
mvn -Dtest=ExecutionRecoveryBenchmark test
```

The benchmark claims 100 jobs as crashed workers, waits for their leases to expire, executes the Redis recovery path, and verifies that replacement workers can reclaim every job. It reports p50, p95, p99, and maximum time from the simulated crash to requeue.

Its defaults match the application configuration:

- 30-second worker lease;
- 5-second recovery scan;
- 100 abandoned jobs.

Override them when evaluating a proposed configuration:

```bash
BENCHMARK_LEASE_MS=5000 \
BENCHMARK_RECOVERY_SCAN_MS=1000 \
mvn -Dtest=ExecutionRecoveryBenchmark test
```

Do not describe lease duration plus scan delay as successful execution recovery. A recovered job must still finish before its execution deadline. With the current 20-second deadline and 30-second lease, stale work is finalized safely but will normally exceed its deadline before another worker can resume it.
