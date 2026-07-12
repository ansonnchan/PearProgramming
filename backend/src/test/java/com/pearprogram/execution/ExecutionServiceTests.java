package com.pearprogram.execution;

import com.pearprogram.rooms.EphemeralRoomStateService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

import java.time.Duration;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Queue;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
class ExecutionServiceTests {
    private final StubRoomState roomState = new StubRoomState();
    private ExecutionProperties properties;
    private FakeProvider provider;
    private ExecutionService service;

    @BeforeEach
    void setUp() {
        properties = new ExecutionProperties();
        properties.setPollInterval(Duration.ofMillis(1));
        properties.setDeadline(Duration.ofMillis(200));
        properties.setMaxPollAttempts(4);
        properties.setWorkerThreads(1);
        properties.setRateLimitPerMinute(20);
        provider = new FakeProvider();
        service = new ExecutionService(provider, new ExecutionLanguageRegistry(), properties, roomState);
        roomState.roomExists = true;
        roomState.activeMember = true;
    }

    @AfterEach
    void tearDown() {
        service.shutdown();
    }

    @Test
    void submitsAndCompletesAValidExecution() {
        provider.results.add(result(ExecutionStatus.RUNNING));
        provider.results.add(new ProviderExecutionResult(ExecutionStatus.COMPLETED, "hello\n", null, null, 0, 42L, null));

        ExecutionResponse submitted = submit("key-1", "python", "print('hello')", "");
        ExecutionResponse completed = awaitTerminal(submitted.executionId());

        assertThat(submitted.status()).isIn(ExecutionStatus.QUEUED, ExecutionStatus.SUBMITTED);
        assertThat(completed.status()).isEqualTo(ExecutionStatus.COMPLETED);
        assertThat(completed.stdout()).isEqualTo("hello\n");
        assertThat(completed.durationMs()).isEqualTo(42L);
    }

    @Test
    void rejectsUnsupportedLanguageAndOversizedInputs() {
        assertApiError(HttpStatus.BAD_REQUEST, () -> submit("bad-language", "ruby", "puts 1", ""));

        properties.setMaxSourceBytes(3);
        assertApiError(HttpStatus.PAYLOAD_TOO_LARGE, () -> submit("big-source", "python", "print(1)", ""));

        properties.setMaxSourceBytes(100);
        properties.setMaxStdinBytes(2);
        assertApiError(HttpStatus.PAYLOAD_TOO_LARGE, () -> submit("big-stdin", "python", "x=1", "abc"));
    }

    @Test
    void requiresActiveRoomMembership() {
        roomState.activeMember = false;
        assertApiError(HttpStatus.FORBIDDEN, () -> submit("no-access", "python", "print(1)", ""));
    }

    @Test
    void returnsSameExecutionForAnIdempotentRetry() {
        provider.results.add(new ProviderExecutionResult(ExecutionStatus.COMPLETED, "ok", null, null, 0, 1L, null));
        ExecutionResponse first = submit("same-key", "python", "print('ok')", "");
        ExecutionResponse duplicate = submit("same-key", "python", "print('changed')", "");

        assertThat(duplicate.executionId()).isEqualTo(first.executionId());
        awaitTerminal(first.executionId());
        assertThat(provider.submissions).hasValue(1);
    }

    @Test
    void concurrentIdempotentRetriesCreateOnlyOneExecution() throws Exception {
        provider.results.add(new ProviderExecutionResult(ExecutionStatus.COMPLETED, "ok", null, null, 0, 1L, null));
        ExecutorService callers = Executors.newFixedThreadPool(8);
        try {
            List<Future<ExecutionResponse>> futures = new ArrayList<>();
            for (int index = 0; index < 8; index++) {
                futures.add(callers.submit(() -> submit("concurrent-key", "python", "print('ok')", "")));
            }
            Set<UUID> executionIds = new HashSet<>();
            for (Future<ExecutionResponse> future : futures) {
                executionIds.add(future.get().executionId());
            }
            assertThat(executionIds).hasSize(1);
            assertThat(provider.submissions).hasValue(1);
        } finally {
            callers.shutdownNow();
        }
    }

    @Test
    void rateLimitsUniqueSubmissionsPerUserAndRoom() {
        properties.setRateLimitPerMinute(1);
        submit("rate-1", "python", "print(1)", "");

        assertApiError(HttpStatus.TOO_MANY_REQUESTS,
                () -> submit("rate-2", "python", "print(2)", ""));
    }

    @Test
    void enforcesExecutionOwnership() {
        provider.results.add(new ProviderExecutionResult(ExecutionStatus.COMPLETED, "ok", null, null, 0, 1L, null));
        ExecutionResponse submitted = submit("ownership", "python", "print('ok')", "");

        assertApiError(HttpStatus.FORBIDDEN, () -> service.get("ABC123", submitted.executionId(), "user-2"));
    }

    @Test
    void preservesCompilationRuntimeAndTimeoutTerminalStates() {
        assertTerminalResult("compile", new ProviderExecutionResult(ExecutionStatus.COMPILATION_ERROR, null, null, "syntax error", 1, 5L, null));
        assertTerminalResult("runtime", new ProviderExecutionResult(ExecutionStatus.RUNTIME_ERROR, null, "boom", null, 1, 6L, null));
        assertTerminalResult("timeout", new ProviderExecutionResult(ExecutionStatus.TIMED_OUT, null, null, null, null, 5000L, null));
    }

    @Test
    void providerFailureTerminatesCleanly() {
        provider.failure = new ExecutionProviderException("unavailable", true);
        ExecutionResponse completed = awaitTerminal(submit("provider-down", "python", "print(1)", "").executionId());
        assertThat(completed.status()).isEqualTo(ExecutionStatus.FAILED);
        assertThat(completed.message()).contains("temporarily unavailable");
    }

    @Test
    void pollingIsBoundedAndEndsInTimeout() {
        provider.defaultResult = result(ExecutionStatus.RUNNING);
        ExecutionResponse completed = awaitTerminal(submit("bounded", "python", "while True: pass", "").executionId());

        assertThat(completed.status()).isEqualTo(ExecutionStatus.TIMED_OUT);
        assertThat(provider.polls).hasValue(properties.getMaxPollAttempts());
    }

    @Test
    void javaRequiresMainEntryClass() {
        assertThatThrownBy(() -> submit("java-main", "java", "class App {}", ""))
                .isInstanceOfSatisfying(ExecutionApiException.class, exception -> {
                    assertThat(exception.status()).isEqualTo(HttpStatus.BAD_REQUEST);
                    assertThat(exception.code()).isEqualTo("java_main_required");
                });
    }

    private void assertTerminalResult(String key, ProviderExecutionResult providerResult) {
        provider.results.add(providerResult);
        ExecutionResponse completed = awaitTerminal(submit(key, "python", "print(1)", "").executionId());
        assertThat(completed.status()).isEqualTo(providerResult.status());
    }

    private ExecutionResponse submit(String key, String language, String source, String stdin) {
        return service.submit("ABC-123", "user-1", key, new ExecutionRequest(language, source, stdin));
    }

    private ExecutionResponse awaitTerminal(UUID id) {
        for (int attempt = 0; attempt < 100; attempt++) {
            ExecutionResponse response = service.get("ABC123", id, "user-1");
            if (response.status().isTerminal()) {
                return response;
            }
            try {
                Thread.sleep(2);
            } catch (InterruptedException exception) {
                Thread.currentThread().interrupt();
                throw new AssertionError(exception);
            }
        }
        throw new AssertionError("Execution did not reach a terminal state");
    }

    private void assertApiError(HttpStatus expected, Runnable action) {
        assertThatThrownBy(action::run)
                .isInstanceOfSatisfying(ExecutionApiException.class,
                        exception -> assertThat(exception.status()).isEqualTo(expected));
    }

    private ProviderExecutionResult result(ExecutionStatus status) {
        return new ProviderExecutionResult(status, null, null, null, null, null, null);
    }

    private static final class FakeProvider implements ExecutionProvider {
        private final Queue<ProviderExecutionResult> results = new ArrayDeque<>();
        private final AtomicInteger submissions = new AtomicInteger();
        private final AtomicInteger polls = new AtomicInteger();
        private ProviderExecutionResult defaultResult = new ProviderExecutionResult(ExecutionStatus.RUNNING, null, null, null, null, null, null);
        private ExecutionProviderException failure;

        @Override
        public String submit(ProviderExecutionRequest request) {
            submissions.incrementAndGet();
            if (failure != null) {
                throw failure;
            }
            return "token";
        }

        @Override
        public ProviderExecutionResult getResult(String submissionToken) {
            polls.incrementAndGet();
            if (failure != null) {
                throw failure;
            }
            ProviderExecutionResult next = results.poll();
            return next == null ? defaultResult : next;
        }
    }

    private static final class StubRoomState extends EphemeralRoomStateService {
        private boolean roomExists;
        private boolean activeMember;

        private StubRoomState() {
            super(null, 120, "pearprogram-test", "", "", "", false);
        }

        @Override
        public boolean roomExists(String code) {
            return roomExists;
        }

        @Override
        public boolean isActiveMember(String code, String userId) {
            return activeMember;
        }
    }
}
