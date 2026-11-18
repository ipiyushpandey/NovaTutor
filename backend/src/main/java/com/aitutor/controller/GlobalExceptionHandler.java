package com.aitutor.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.servlet.HandlerMapping;
import org.springframework.http.converter.HttpMessageNotReadableException;
import jakarta.persistence.EntityNotFoundException;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.NoSuchElementException;
import java.util.Map;

@RestControllerAdvice
public class GlobalExceptionHandler {
    private static final org.slf4j.Logger log = org.slf4j.LoggerFactory.getLogger(GlobalExceptionHandler.class);
    private final ObjectMapper objectMapper;

    public GlobalExceptionHandler(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    /**
     * Clears any handler-bound producible media types (e.g. text/event-stream on SSE routes)
     * so error responses return their real status code (e.g. 503 AI_BUSY, 400) as JSON instead
     * of failing Spring content negotiation with HTTP 406 Not Acceptable.
     */
    private ResponseEntity<Map<String, String>> errorResponse(
            HttpStatusCode status, String code, String message,
            HttpServletRequest request, HttpServletResponse response) {
        Map<String, String> body = Map.of("error", code, "message", message == null ? "" : message);
        if (request != null) {
            request.removeAttribute(HandlerMapping.PRODUCIBLE_MEDIA_TYPES_ATTRIBUTE);
            String accept = request.getHeader("Accept");
            boolean sseOnly = accept != null
                    && accept.contains(MediaType.TEXT_EVENT_STREAM_VALUE)
                    && !accept.contains(MediaType.APPLICATION_JSON_VALUE)
                    && !accept.contains("*/*");
            if (sseOnly && response != null && !response.isCommitted()) {
                try {
                    response.setStatus(status.value());
                    response.setCharacterEncoding(StandardCharsets.UTF_8.name());
                    response.setContentType(MediaType.APPLICATION_JSON_VALUE);
                    objectMapper.writeValue(response.getWriter(), body);
                    response.flushBuffer();
                    return null;
                } catch (IOException ioEx) {
                    log.debug("Failed writing SSE error body directly", ioEx);
                }
            }
        }
        return ResponseEntity.status(status).contentType(MediaType.APPLICATION_JSON).body(body);
    }

    /** Deliberate API failures carry a stable code the frontend can branch on. */
    @ExceptionHandler(ApiException.class)
    ResponseEntity<Map<String,String>> apiException(ApiException e, HttpServletRequest request, HttpServletResponse response) {
        return errorResponse(e.status(), e.code(), e.getMessage(), request, response);
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    ResponseEntity<Map<String,String>> validation(MethodArgumentNotValidException e, HttpServletRequest request, HttpServletResponse response) {
        String message = e.getBindingResult().getFieldErrors().stream().findFirst()
                .map(x -> x.getField() + ": " + x.getDefaultMessage()).orElse("Invalid request");
        return errorResponse(HttpStatus.BAD_REQUEST, "validation_error", message, request, response);
    }

    @ExceptionHandler(IllegalArgumentException.class)
    ResponseEntity<Map<String,String>> badRequest(IllegalArgumentException e, HttpServletRequest request, HttpServletResponse response) {
        String message = e.getMessage() == null ? "Invalid request" : e.getMessage();
        String code = message.toLowerCase().contains("invalid email or password") ? "INVALID_CREDENTIALS" : "bad_request";
        return errorResponse(HttpStatus.BAD_REQUEST, code, message, request, response);
    }

    @ExceptionHandler(IllegalStateException.class)
    ResponseEntity<Map<String,String>> conflict(IllegalStateException e, HttpServletRequest request, HttpServletResponse response) {
        log.warn("Request conflict state: {}", e.getMessage());
        return errorResponse(HttpStatus.CONFLICT, "conflict", "Operation cannot be completed in the current state.", request, response);
    }

    /** Missing entity (orElseThrow on empty Optional) maps to 404, never a 500. */
    @ExceptionHandler({NoSuchElementException.class, EntityNotFoundException.class})
    ResponseEntity<Map<String,String>> notFound(Exception e, HttpServletRequest request, HttpServletResponse response) {
        return errorResponse(HttpStatus.NOT_FOUND, "not_found", "Resource not found", request, response);
    }

    /** Malformed body / wrong types / missing params are client errors, not 500s. */
    @ExceptionHandler({HttpMessageNotReadableException.class, MissingServletRequestParameterException.class,
            MethodArgumentTypeMismatchException.class})
    ResponseEntity<Map<String,String>> unreadable(Exception e, HttpServletRequest request, HttpServletResponse response) {
        return errorResponse(HttpStatus.BAD_REQUEST, "bad_request", "Malformed request", request, response);
    }

    /** Unsupported Content-Type is a client error (415), not a 500. */
    @ExceptionHandler(org.springframework.web.HttpMediaTypeNotSupportedException.class)
    ResponseEntity<Map<String,String>> mediaType(org.springframework.web.HttpMediaTypeNotSupportedException e, HttpServletRequest request, HttpServletResponse response) {
        return errorResponse(HttpStatus.UNSUPPORTED_MEDIA_TYPE, "unsupported_media_type", "Unsupported Content-Type", request, response);
    }

    /** Unknown URL paths are 404, not 500. */
    @ExceptionHandler({org.springframework.web.servlet.resource.NoResourceFoundException.class,
            org.springframework.web.servlet.NoHandlerFoundException.class})
    ResponseEntity<Map<String,String>> noRoute(Exception e, HttpServletRequest request, HttpServletResponse response) {
        return errorResponse(HttpStatus.NOT_FOUND, "not_found", "Resource not found", request, response);
    }

    /** Constraint violations (over-long columns, unique keys) are client errors. */
    @ExceptionHandler(org.springframework.dao.DataIntegrityViolationException.class)
    ResponseEntity<Map<String,String>> integrity(org.springframework.dao.DataIntegrityViolationException e, HttpServletRequest request, HttpServletResponse response) {
        return errorResponse(HttpStatus.BAD_REQUEST, "bad_request", "Request violates data constraints", request, response);
    }

    /** Preserve explicit controller statuses (401/403/404 from ResponseStatusException). */
    @ExceptionHandler(org.springframework.web.server.ResponseStatusException.class)
    ResponseEntity<Map<String,String>> statusException(org.springframework.web.server.ResponseStatusException e, HttpServletRequest request, HttpServletResponse response) {
        String message = e.getReason() == null ? e.getStatusCode().toString() : e.getReason();
        return errorResponse(e.getStatusCode(), "request_rejected", message, request, response);
    }

    /** Controller/service authorization failures must return 403, never 500. */
    @ExceptionHandler(org.springframework.security.access.AccessDeniedException.class)
    ResponseEntity<Map<String,String>> accessDenied(org.springframework.security.access.AccessDeniedException e, HttpServletRequest request, HttpServletResponse response) {
        String message = (e.getMessage() == null || e.getMessage().isBlank()) ? "Access denied" : e.getMessage();
        return errorResponse(HttpStatus.FORBIDDEN, "forbidden", message, request, response);
    }

    /** Wrong HTTP method on a valid route is 405 Method Not Allowed, never 500. */
    @ExceptionHandler(org.springframework.web.HttpRequestMethodNotSupportedException.class)
    ResponseEntity<Map<String,String>> methodNotAllowed(org.springframework.web.HttpRequestMethodNotSupportedException e, HttpServletRequest request, HttpServletResponse response) {
        return errorResponse(HttpStatus.METHOD_NOT_ALLOWED, "method_not_allowed", "HTTP method not supported for this endpoint", request, response);
    }

    /** Oversized multipart uploads are 413 Payload Too Large, never 500. */
    @ExceptionHandler(org.springframework.web.multipart.MaxUploadSizeExceededException.class)
    ResponseEntity<Map<String,String>> payloadTooLarge(org.springframework.web.multipart.MaxUploadSizeExceededException e, HttpServletRequest request, HttpServletResponse response) {
        return errorResponse(HttpStatus.PAYLOAD_TOO_LARGE, "payload_too_large", "Uploaded file exceeds the maximum allowed size", request, response);
    }

    /** Missing required multipart field is 400 Bad Request, never 500. */
    @ExceptionHandler(org.springframework.web.multipart.support.MissingServletRequestPartException.class)
    ResponseEntity<Map<String,String>> missingPart(org.springframework.web.multipart.support.MissingServletRequestPartException e, HttpServletRequest request, HttpServletResponse response) {
        return errorResponse(HttpStatus.BAD_REQUEST, "bad_request", "Missing required file or form field", request, response);
    }

    /** Last-resort handler: never leak stack traces or internal messages. */
    @ExceptionHandler(Exception.class)
    ResponseEntity<Map<String,String>> unexpected(Exception e, HttpServletRequest request, HttpServletResponse response) {
        // Keep the client message generic, but leave an operator-visible cause in
        // server logs so failures such as a foreign-key abort are diagnosable.
        log.error("Unhandled request error", e);
        return errorResponse(HttpStatus.INTERNAL_SERVER_ERROR, "internal_error", "Something went wrong. Please try again.", request, response);
    }
}
