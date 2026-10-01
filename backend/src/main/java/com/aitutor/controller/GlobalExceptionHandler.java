package com.aitutor.controller;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.http.converter.HttpMessageNotReadableException;
import jakarta.persistence.EntityNotFoundException;
import java.util.NoSuchElementException;
import java.util.Map;

@RestControllerAdvice
public class GlobalExceptionHandler {
    @ExceptionHandler(MethodArgumentNotValidException.class)
    ResponseEntity<Map<String,String>> validation(MethodArgumentNotValidException e) {
        String message = e.getBindingResult().getFieldErrors().stream().findFirst()
                .map(x -> x.getField() + ": " + x.getDefaultMessage()).orElse("Invalid request");
        return ResponseEntity.badRequest().body(Map.of("error", "validation_error", "message", message));
    }

    @ExceptionHandler(IllegalArgumentException.class)
    ResponseEntity<Map<String,String>> badRequest(IllegalArgumentException e) {
        return ResponseEntity.badRequest().body(Map.of("error", "bad_request", "message", e.getMessage() == null ? "Invalid request" : e.getMessage()));
    }

    @ExceptionHandler(IllegalStateException.class)
    ResponseEntity<Map<String,String>> conflict(IllegalStateException e) {
        return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of("error", "conflict", "message", e.getMessage() == null ? "Operation not allowed" : e.getMessage()));
    }

    /** Missing entity (orElseThrow on empty Optional) maps to 404, never a 500. */
    @ExceptionHandler({NoSuchElementException.class, EntityNotFoundException.class})
    ResponseEntity<Map<String,String>> notFound(Exception e) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("error", "not_found", "message", "Resource not found"));
    }

    /** Malformed body / wrong types / missing params are client errors, not 500s. */
    @ExceptionHandler({HttpMessageNotReadableException.class, MissingServletRequestParameterException.class,
            MethodArgumentTypeMismatchException.class})
    ResponseEntity<Map<String,String>> unreadable(Exception e) {
        return ResponseEntity.badRequest().body(Map.of("error", "bad_request", "message", "Malformed request"));
    }

    /** Unsupported Content-Type is a client error (415), not a 500. */
    @ExceptionHandler(org.springframework.web.HttpMediaTypeNotSupportedException.class)
    ResponseEntity<Map<String,String>> mediaType(org.springframework.web.HttpMediaTypeNotSupportedException e) {
        return ResponseEntity.status(HttpStatus.UNSUPPORTED_MEDIA_TYPE).body(Map.of("error", "unsupported_media_type", "message", "Unsupported Content-Type"));
    }

    /** Unknown URL paths are 404, not 500. */
    @ExceptionHandler({org.springframework.web.servlet.resource.NoResourceFoundException.class,
            org.springframework.web.servlet.NoHandlerFoundException.class})
    ResponseEntity<Map<String,String>> noRoute(Exception e) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("error", "not_found", "message", "Resource not found"));
    }

    /** Constraint violations (over-long columns, unique keys) are client errors. */
    @ExceptionHandler(org.springframework.dao.DataIntegrityViolationException.class)
    ResponseEntity<Map<String,String>> integrity(org.springframework.dao.DataIntegrityViolationException e) {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(Map.of("error", "bad_request", "message", "Request violates data constraints"));
    }

    /** Preserve explicit controller statuses (401/403/404 from ResponseStatusException). */
    @ExceptionHandler(org.springframework.web.server.ResponseStatusException.class)
    ResponseEntity<Map<String,String>> statusException(org.springframework.web.server.ResponseStatusException e) {
        String message = e.getReason() == null ? e.getStatusCode().toString() : e.getReason();
        return ResponseEntity.status(e.getStatusCode()).body(Map.of("error", "request_rejected", "message", message));
    }

    /** Last-resort handler: never leak stack traces or internal messages. */
    @ExceptionHandler(Exception.class)
    ResponseEntity<Map<String,String>> unexpected(Exception e) {
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(Map.of("error", "internal_error", "message", "Something went wrong. Please try again."));
    }
}
