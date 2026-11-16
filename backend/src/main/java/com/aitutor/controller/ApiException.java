package com.aitutor.controller;

import org.springframework.http.HttpStatus;

/**
 * A deliberate, client-facing API failure with a stable machine-readable code.
 * GlobalExceptionHandler renders it as {"error": code, "message": ...} so the
 * frontend can branch on behaviour (for example EMAIL_UNVERIFIED) without
 * parsing prose.
 */
public class ApiException extends RuntimeException {
    private final HttpStatus status;
    private final String code;

    public ApiException(HttpStatus status, String code, String message) {
        super(message);
        this.status = status;
        this.code = code;
    }

    public HttpStatus status() { return status; }
    public String code() { return code; }
}
