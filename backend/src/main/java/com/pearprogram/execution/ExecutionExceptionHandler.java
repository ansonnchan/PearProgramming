package com.pearprogram.execution;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.util.Map;

@RestControllerAdvice(assignableTypes = ExecutionController.class)
public class ExecutionExceptionHandler {
    @ExceptionHandler(ExecutionApiException.class)
    ResponseEntity<Map<String, String>> handleExecutionException(ExecutionApiException exception) {
        return ResponseEntity.status(exception.status()).body(Map.of(
                "error", exception.code(),
                "message", exception.getMessage()
        ));
    }
}
