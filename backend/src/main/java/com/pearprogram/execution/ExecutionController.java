package com.pearprogram.execution;

import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

@RestController
@RequestMapping("/api/rooms/{code}/executions")
public class ExecutionController {
    private final ExecutionService executionService;

    public ExecutionController(ExecutionService executionService) {
        this.executionService = executionService;
    }

    @PostMapping
    @ResponseStatus(HttpStatus.ACCEPTED)
    public ExecutionResponse submit(
            @PathVariable String code,
            @RequestHeader(name = "X-Pear-Session-Id", required = false) String sessionId,
            @RequestHeader(name = "Idempotency-Key", required = false) String idempotencyKey,
            @Valid @RequestBody ExecutionRequest request
    ) {
        return executionService.submit(code, sessionId, idempotencyKey, request);
    }

    @GetMapping("/{executionId}")
    public ExecutionResponse get(
            @PathVariable String code,
            @PathVariable UUID executionId,
            @RequestHeader(name = "X-Pear-Session-Id", required = false) String sessionId
    ) {
        return executionService.get(code, executionId, sessionId);
    }
}
