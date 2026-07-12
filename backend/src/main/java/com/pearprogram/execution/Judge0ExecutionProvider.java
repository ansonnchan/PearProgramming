package com.pearprogram.execution;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.HttpStatusCode;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestClientResponseException;

import java.math.BigDecimal;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.function.Supplier;

@Component
public class Judge0ExecutionProvider implements ExecutionProvider {
    private static final Logger log = LoggerFactory.getLogger(Judge0ExecutionProvider.class);

    private final RestClient restClient;
    private final ObjectMapper objectMapper;
    private final ExecutionProperties.Judge0 settings;

    public Judge0ExecutionProvider(
            @Qualifier("judge0RestClient") RestClient restClient,
            ObjectMapper objectMapper,
            ExecutionProperties properties
    ) {
        this.restClient = restClient;
        this.objectMapper = objectMapper;
        this.settings = properties.getJudge0();
    }

    @Override
    public String submit(ProviderExecutionRequest request) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("language_id", request.languageId());
        body.put("source_code", request.sourceCode());
        body.put("stdin", request.stdin());
        body.put("cpu_time_limit", request.executionTimeoutSeconds());
        body.put("wall_time_limit", request.executionTimeoutSeconds() + 1);

        String raw = withTransientRetry("submission", () -> restClient.post()
                .uri("/submissions?base64_encoded=false&wait=false")
                .body(body)
                .retrieve()
                .body(String.class));
        try {
            String token = objectMapper.readTree(raw == null ? "{}" : raw).path("token").asText("").trim();
            if (token.isBlank()) {
                throw new ExecutionProviderException("Execution provider returned an invalid submission response", false);
            }
            return token;
        } catch (ExecutionProviderException exception) {
            throw exception;
        } catch (Exception exception) {
            throw new ExecutionProviderException("Execution provider returned a malformed submission response", false, exception);
        }
    }

    @Override
    public ProviderExecutionResult getResult(String submissionToken) {
        String raw = withTransientRetry("status", () -> restClient.get()
                .uri("/submissions/{token}?base64_encoded=false&fields=stdout,stderr,compile_output,message,status,time,exit_code", submissionToken)
                .retrieve()
                .body(String.class));
        try {
            return normalize(objectMapper.readTree(raw == null ? "{}" : raw));
        } catch (ExecutionProviderException exception) {
            throw exception;
        } catch (Exception exception) {
            throw new ExecutionProviderException("Execution provider returned a malformed status response", false, exception);
        }
    }

    ProviderExecutionResult normalize(JsonNode root) {
        JsonNode statusNode = root.path("status");
        if (!statusNode.has("id") || !statusNode.path("id").canConvertToInt()) {
            throw new ExecutionProviderException("Execution provider returned a malformed status response", false);
        }

        int providerStatus = statusNode.path("id").asInt();
        ExecutionStatus status = switch (providerStatus) {
            case 1 -> ExecutionStatus.SUBMITTED;
            case 2 -> ExecutionStatus.RUNNING;
            case 3, 4 -> ExecutionStatus.COMPLETED;
            case 5 -> ExecutionStatus.TIMED_OUT;
            case 6 -> ExecutionStatus.COMPILATION_ERROR;
            case 7, 8, 9, 10, 11, 12 -> ExecutionStatus.RUNTIME_ERROR;
            default -> ExecutionStatus.FAILED;
        };

        return new ProviderExecutionResult(
                status,
                nullableText(root, "stdout"),
                nullableText(root, "stderr"),
                nullableText(root, "compile_output"),
                nullableInteger(root, "exit_code"),
                durationMs(root.path("time")),
                status == ExecutionStatus.FAILED ? "The execution provider could not complete this run." : null
        );
    }

    private <T> T withTransientRetry(String operation, Supplier<T> request) {
        int maxAttempts = Math.max(1, settings.getMaxRetries() + 1);
        for (int attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                return request.get();
            } catch (RestClientResponseException exception) {
                boolean transientFailure = isTransient(exception.getStatusCode());
                if (!transientFailure || attempt == maxAttempts) {
                    throw new ExecutionProviderException("Execution provider request failed", transientFailure, exception);
                }
            } catch (RestClientException exception) {
                if (attempt == maxAttempts) {
                    throw new ExecutionProviderException("Execution provider is unavailable", true, exception);
                }
            }

            long delay = Math.min(2_000L, Math.max(0, settings.getRetryBackoff().toMillis()) * (1L << (attempt - 1)));
            log.debug("Retrying Judge0 {} after transient failure; attempt={}/{} delayMs={}", operation, attempt + 1, maxAttempts, delay);
            sleep(delay);
        }
        throw new ExecutionProviderException("Execution provider request failed", true);
    }

    private boolean isTransient(HttpStatusCode status) {
        return status.value() == 429 || status.is5xxServerError();
    }

    private void sleep(long delayMs) {
        try {
            Thread.sleep(delayMs);
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new ExecutionProviderException("Execution provider request was interrupted", false, exception);
        }
    }

    private String nullableText(JsonNode root, String field) {
        JsonNode value = root.get(field);
        return value == null || value.isNull() ? null : value.asText();
    }

    private Integer nullableInteger(JsonNode root, String field) {
        JsonNode value = root.get(field);
        return value == null || value.isNull() || !value.canConvertToInt() ? null : value.asInt();
    }

    private Long durationMs(JsonNode value) {
        if (value == null || value.isNull() || value.asText().isBlank()) {
            return null;
        }
        try {
            return new BigDecimal(value.asText()).movePointRight(3).longValue();
        } catch (NumberFormatException exception) {
            throw new ExecutionProviderException("Execution provider returned an invalid duration", false, exception);
        }
    }
}
