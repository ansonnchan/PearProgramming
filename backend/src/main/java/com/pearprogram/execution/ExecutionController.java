package com.pearprogram.execution;

import jakarta.validation.Valid;
import com.pearprogram.auth.GuestIdentityService;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.security.core.Authentication;

import java.util.UUID;

@RestController
@RequestMapping("/api/rooms/{code}/executions")
public class ExecutionController {
    private final ExecutionService executionService;
    private final GuestIdentityService identities;

    public ExecutionController(ExecutionService executionService, GuestIdentityService identities) {
        this.executionService = executionService;
        this.identities = identities;
    }

    @PostMapping
    @ResponseStatus(HttpStatus.ACCEPTED)
    public ExecutionResponse submit(
            @PathVariable String code,
            @RequestHeader(name = "Idempotency-Key", required = false) String idempotencyKey,
            @Valid @RequestBody ExecutionRequest request,
            Authentication authentication
    ) {
        return executionService.submit(code, identities.requirePrincipal(authentication).id(), idempotencyKey, request);
    }

    @GetMapping("/{executionId}")
    public ExecutionResponse get(
            @PathVariable String code,
            @PathVariable UUID executionId,
            Authentication authentication
    ) {
        return executionService.get(code, executionId, identities.requirePrincipal(authentication).id());
    }
}
