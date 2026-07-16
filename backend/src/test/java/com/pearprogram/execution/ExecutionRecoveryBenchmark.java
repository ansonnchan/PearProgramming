package com.pearprogram.execution;

import org.junit.jupiter.api.Test;
import org.springframework.data.redis.connection.RedisStandaloneConfiguration;
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory;
import org.springframework.data.redis.core.StringRedisTemplate;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Explicit benchmark; its class name intentionally does not match Surefire's default test patterns.
 *
 * Run with:
 * mvn -Dtest=ExecutionRecoveryBenchmark test
 */
class ExecutionRecoveryBenchmark {
    @Test
    void measuresExpiredLeaseRecoveryAgainstRedis() throws Exception {
        int runs = integerEnvironment("BENCHMARK_RUNS", 100);
        long leaseMs = longEnvironment("BENCHMARK_LEASE_MS", 30_000);
        long recoveryScanMs = longEnvironment("BENCHMARK_RECOVERY_SCAN_MS", 5_000);
        String host = environment("BENCHMARK_REDIS_HOST", "127.0.0.1");
        int port = integerEnvironment("BENCHMARK_REDIS_PORT", 6379);

        RedisStandaloneConfiguration configuration = new RedisStandaloneConfiguration(host, port);
        String password = System.getenv("BENCHMARK_REDIS_PASSWORD");
        if (password != null && !password.isBlank()) {
            configuration.setPassword(password);
        }

        LettuceConnectionFactory connectionFactory = new LettuceConnectionFactory(configuration);
        connectionFactory.afterPropertiesSet();
        StringRedisTemplate redis = new StringRedisTemplate(connectionFactory);
        redis.afterPropertiesSet();
        redis.getConnectionFactory().getConnection().ping();

        String prefix = "pearprogram-benchmark-" + UUID.randomUUID();
        String roomCode = "BENCH1";
        RedisExecutionCoordinator coordinator = new RedisExecutionCoordinator(redis, prefix);
        Map<UUID, Long> claimedAt = new HashMap<>();
        Map<UUID, Long> recoveredAt = new HashMap<>();
        Duration lease = Duration.ofMillis(leaseMs);
        Duration ttl = Duration.ofMinutes(5);

        try {
            for (int index = 0; index < runs; index += 1) {
                Instant now = Instant.now();
                UUID id = UUID.randomUUID();
                ExecutionJob job = new ExecutionJob(
                        id,
                        roomCode,
                        "benchmark-user",
                        63,
                        "console.log('pear')",
                        "",
                        now,
                        now.plusMillis(leaseMs + recoveryScanMs * 3 + 30_000),
                        0,
                        3,
                        "",
                        ""
                );
                coordinator.create(job, "benchmark-" + index, ttl, runs + 1);
                assertThat(coordinator.claim("crashed-worker-" + index, Instant.now(), lease)).isPresent();
                claimedAt.put(id, System.nanoTime());
            }

            long timeoutAt = System.nanoTime()
                    + Duration.ofMillis(leaseMs + recoveryScanMs * 3 + 10_000).toNanos();
            while (recoveredAt.size() < runs && System.nanoTime() < timeoutAt) {
                Thread.sleep(recoveryScanMs);
                ExecutionRecoveryBatch batch = coordinator.recoverExpiredLeases(
                        Instant.now(),
                        "benchmark recovery exhausted",
                        ttl
                );
                long observedAt = System.nanoTime();
                for (ExecutionRecoveryBatch.RecoveredLease recovered : batch.leases()) {
                    recoveredAt.putIfAbsent(recovered.executionId(), observedAt);
                }
            }

            assertThat(recoveredAt).hasSize(runs);
            List<Double> recoveryMs = new ArrayList<>();
            for (Map.Entry<UUID, Long> recovered : recoveredAt.entrySet()) {
                recoveryMs.add((recovered.getValue() - claimedAt.get(recovered.getKey())) / 1_000_000.0);
            }
            recoveryMs.sort(Double::compareTo);

            int replacementClaims = 0;
            for (int index = 0; index < runs; index += 1) {
                if (coordinator.claim("replacement-worker-" + index, Instant.now(), Duration.ofSeconds(30)).isPresent()) {
                    replacementClaims++;
                }
            }
            assertThat(replacementClaims).isEqualTo(runs);

            System.out.printf(
                    "%nExecution recovery benchmark%n" +
                    "- runs: %d%n" +
                    "- lease: %d ms%n" +
                    "- recovery scan: %d ms%n" +
                    "- p50 recovery: %.2f ms%n" +
                    "- p95 recovery: %.2f ms%n" +
                    "- p99 recovery: %.2f ms%n" +
                    "- max recovery: %.2f ms%n",
                    runs,
                    leaseMs,
                    recoveryScanMs,
                    percentile(recoveryMs, 0.50),
                    percentile(recoveryMs, 0.95),
                    percentile(recoveryMs, 0.99),
                    recoveryMs.getLast()
            );
        } finally {
            coordinator.cleanupRoom(roomCode);
            connectionFactory.destroy();
        }
    }

    private double percentile(List<Double> sortedValues, double quantile) {
        int index = Math.max(0, (int) Math.ceil(sortedValues.size() * quantile) - 1);
        return sortedValues.get(index);
    }

    private int integerEnvironment(String name, int fallback) {
        return Integer.parseInt(environment(name, Integer.toString(fallback)));
    }

    private long longEnvironment(String name, long fallback) {
        return Long.parseLong(environment(name, Long.toString(fallback)));
    }

    private String environment(String name, String fallback) {
        String value = System.getenv(name);
        return value == null || value.isBlank() ? fallback : value.trim();
    }
}
