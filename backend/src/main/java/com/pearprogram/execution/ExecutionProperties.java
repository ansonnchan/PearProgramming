package com.pearprogram.execution;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

import java.time.Duration;

@Component
@ConfigurationProperties(prefix = "pearprogram.execution")
public class ExecutionProperties {
    private int maxSourceBytes = 100_000;
    private int maxStdinBytes = 20_000;
    private int rateLimitPerMinute = 10;
    private Duration recordTtl = Duration.ofMinutes(15);
    private Duration initialPollInterval = Duration.ofMillis(100);
    private Duration pollInterval = Duration.ofMillis(750);
    private Duration deadline = Duration.ofSeconds(20);
    private int maxPollAttempts = 25;
    private int workerThreads = 4;
    private Duration workerPollInterval = Duration.ofMillis(200);
    private Duration workerLease = Duration.ofSeconds(30);
    private int workerMaxRetries = 3;
    private Duration workerRetryBackoff = Duration.ofSeconds(1);
    private final Judge0 judge0 = new Judge0();

    public int getMaxSourceBytes() { return maxSourceBytes; }
    public void setMaxSourceBytes(int value) { this.maxSourceBytes = value; }
    public int getMaxStdinBytes() { return maxStdinBytes; }
    public void setMaxStdinBytes(int value) { this.maxStdinBytes = value; }
    public int getRateLimitPerMinute() { return rateLimitPerMinute; }
    public void setRateLimitPerMinute(int value) { this.rateLimitPerMinute = value; }
    public Duration getRecordTtl() { return recordTtl; }
    public void setRecordTtl(Duration value) { this.recordTtl = value; }
    public Duration getInitialPollInterval() { return initialPollInterval; }
    public void setInitialPollInterval(Duration value) { this.initialPollInterval = value; }
    public Duration getPollInterval() { return pollInterval; }
    public void setPollInterval(Duration value) { this.pollInterval = value; }
    public Duration getDeadline() { return deadline; }
    public void setDeadline(Duration value) { this.deadline = value; }
    public int getMaxPollAttempts() { return maxPollAttempts; }
    public void setMaxPollAttempts(int value) { this.maxPollAttempts = value; }
    public int getWorkerThreads() { return workerThreads; }
    public void setWorkerThreads(int value) { this.workerThreads = value; }
    public Duration getWorkerPollInterval() { return workerPollInterval; }
    public void setWorkerPollInterval(Duration value) { this.workerPollInterval = value; }
    public Duration getWorkerLease() { return workerLease; }
    public void setWorkerLease(Duration value) { this.workerLease = value; }
    public int getWorkerMaxRetries() { return workerMaxRetries; }
    public void setWorkerMaxRetries(int value) { this.workerMaxRetries = value; }
    public Duration getWorkerRetryBackoff() { return workerRetryBackoff; }
    public void setWorkerRetryBackoff(Duration value) { this.workerRetryBackoff = value; }
    public Judge0 getJudge0() { return judge0; }

    public static class Judge0 {
        private String baseUrl = "http://localhost:2358";
        private String apiKey = "";
        private String apiHost = "";
        private Duration requestTimeout = Duration.ofSeconds(5);
        private int executionTimeoutSeconds = 5;
        private int maxRetries = 2;
        private Duration retryBackoff = Duration.ofMillis(200);

        public String getBaseUrl() { return baseUrl; }
        public void setBaseUrl(String value) { this.baseUrl = value; }
        public String getApiKey() { return apiKey; }
        public void setApiKey(String value) { this.apiKey = value; }
        public String getApiHost() { return apiHost; }
        public void setApiHost(String value) { this.apiHost = value; }
        public Duration getRequestTimeout() { return requestTimeout; }
        public void setRequestTimeout(Duration value) { this.requestTimeout = value; }
        public int getExecutionTimeoutSeconds() { return executionTimeoutSeconds; }
        public void setExecutionTimeoutSeconds(int value) { this.executionTimeoutSeconds = value; }
        public int getMaxRetries() { return maxRetries; }
        public void setMaxRetries(int value) { this.maxRetries = value; }
        public Duration getRetryBackoff() { return retryBackoff; }
        public void setRetryBackoff(Duration value) { this.retryBackoff = value; }
    }
}
