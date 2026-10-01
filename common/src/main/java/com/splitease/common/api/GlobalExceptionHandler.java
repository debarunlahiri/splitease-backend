package com.splitease.common.api;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;

import com.splitease.common.exception.ConflictException;
import com.splitease.common.exception.NotFoundException;
import com.splitease.common.exception.TooManyRequestsException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice
public class GlobalExceptionHandler {
    @ExceptionHandler(NotFoundException.class)
    ResponseEntity<ApiError> notFound(NotFoundException exception) {
        return response(HttpStatus.NOT_FOUND, "NOT_FOUND", exception.getMessage());
    }

    @ExceptionHandler(ConflictException.class)
    ResponseEntity<ApiError> conflict(ConflictException exception) {
        return response(HttpStatus.CONFLICT, "CONFLICT", exception.getMessage());
    }

    @ExceptionHandler(AccessDeniedException.class)
    ResponseEntity<ApiError> forbidden(AccessDeniedException exception) {
        return response(HttpStatus.FORBIDDEN, "FORBIDDEN", exception.getMessage());
    }

    @ExceptionHandler(BadCredentialsException.class)
    ResponseEntity<ApiError> unauthorized(BadCredentialsException exception) {
        return response(HttpStatus.UNAUTHORIZED, "INVALID_CREDENTIALS", exception.getMessage());
    }

    @ExceptionHandler(TooManyRequestsException.class)
    ResponseEntity<ApiError> tooManyRequests(TooManyRequestsException exception) {
        return response(HttpStatus.TOO_MANY_REQUESTS, "TOO_MANY_REQUESTS", exception.getMessage());
    }

    @ExceptionHandler(IllegalArgumentException.class)
    ResponseEntity<ApiError> invalidArgument(IllegalArgumentException exception) {
        return response(HttpStatus.BAD_REQUEST, "INVALID_REQUEST", exception.getMessage());
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    ResponseEntity<ApiError> validation(MethodArgumentNotValidException exception) {
        Map<String, String> fields = new LinkedHashMap<>();
        exception.getBindingResult().getFieldErrors()
                .forEach(error -> fields.putIfAbsent(error.getField(), error.getDefaultMessage()));
        ApiError error = new ApiError(Instant.now(), HttpStatus.BAD_REQUEST.value(),
                "VALIDATION_FAILED", "Request validation failed", fields);
        return ResponseEntity.badRequest().body(error);
    }

    private ResponseEntity<ApiError> response(HttpStatus status, String code, String message) {
        return ResponseEntity.status(status).body(ApiError.of(status.value(), code, message));
    }
}
