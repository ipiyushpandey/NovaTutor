package com.aitutor.ai;

/**
 * Structured completion status for AI streams.
 * Distinguishes full completion from token truncation, safety refusals, errors, and cancellations.
 */
public record StreamCompletion(
        String status,       // "COMPLETED", "TRUNCATED", "SAFETY_REFUSAL", "ERROR", "CANCELLED"
        String finishReason, // "STOP", "MAX_TOKENS", "SAFETY", "BLOCKLIST", etc.
        int chunkCount,
        long totalChars,
        long durationMs
) {
    public static final String COMPLETED = "COMPLETED";
    public static final String TRUNCATED = "TRUNCATED";
    public static final String SAFETY_REFUSAL = "SAFETY_REFUSAL";
    public static final String ERROR = "ERROR";
    public static final String CANCELLED = "CANCELLED";

    public boolean isCompleted() { return COMPLETED.equals(status); }
    public boolean isTruncated() { return TRUNCATED.equals(status); }
    public boolean isSafetyRefusal() { return SAFETY_REFUSAL.equals(status); }
    public boolean isError() { return ERROR.equals(status); }
}
