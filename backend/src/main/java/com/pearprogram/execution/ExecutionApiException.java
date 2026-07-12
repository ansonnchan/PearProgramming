package com.pearprogram.execution;

import org.springframework.http.HttpStatus;

public class ExecutionApiException extends RuntimeException {
    private final HttpStatus status;
    private final String code;

    public ExecutionApiException(HttpStatus status, String code, String message) {
        super(message);
        this.status = status;
        this.code = code;
    }

    public HttpStatus status() { return status; }
    public String code() { return code; }
}
