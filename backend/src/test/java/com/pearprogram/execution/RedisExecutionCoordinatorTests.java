package com.pearprogram.execution;

import org.junit.jupiter.api.Test;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ZSetOperations;
import org.springframework.data.redis.core.script.RedisScript;
import org.springframework.http.HttpStatus;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyDouble;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

@SuppressWarnings({"unchecked", "rawtypes"})
class RedisExecutionCoordinatorTests {
    @Test
    void submissionFailsClosedWhenRedisIsUnavailable() {
        StringRedisTemplate redis = mock(StringRedisTemplate.class);
        when(redis.execute(any(RedisScript.class), anyList(), any(Object[].class)))
                .thenThrow(new DataAccessResourceFailureException("offline"));
        RedisExecutionCoordinator coordinator = new RedisExecutionCoordinator(redis, "pearprogram-test");
        Instant now = Instant.now();
        ExecutionJob job = new ExecutionJob(UUID.randomUUID(), "ABC123", "user-1", 71, "print(1)", "", now,
                now.plusSeconds(20), 0, 3, "", "");

        assertThatThrownBy(() -> coordinator.create(job, "key", Duration.ofMinutes(5), 10))
                .isInstanceOfSatisfying(ExecutionApiException.class, exception -> {
                    assertThat(exception.status()).isEqualTo(HttpStatus.SERVICE_UNAVAILABLE);
                    assertThat(exception.code()).isEqualTo("execution_service_unavailable");
                });
    }

    @Test
    void scheduledRecoveryDegradesWithoutThrowing() {
        StringRedisTemplate redis = mock(StringRedisTemplate.class);
        @SuppressWarnings("unchecked") ZSetOperations<String, String> zsets = mock(ZSetOperations.class);
        when(redis.opsForZSet()).thenReturn(zsets);
        when(zsets.rangeByScoreWithScores(any(String.class), anyDouble(), anyDouble(), anyLong(), anyLong()))
                .thenThrow(new DataAccessResourceFailureException("offline"));
        RedisExecutionCoordinator coordinator = new RedisExecutionCoordinator(redis, "pearprogram-test");

        assertThatCode(() -> coordinator.recoverExpiredLeases(Instant.now(), "failed", Duration.ofMinutes(5)))
                .doesNotThrowAnyException();
    }
}
