package com.pearprogram.execution;

import java.time.Instant;
import java.util.UUID;

record ExecutionJob(
        UUID executionId,
        String roomCode,
        String ownerUserId,
        int languageId,
        String sourceCode,
        String stdin,
        Instant createdAt,
        Instant deadline,
        int retryCount,
        int maxRetries,
        String providerToken,
        String leaseOwner
) {}
