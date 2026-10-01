package com.aitutor.dsa;

/**
 * Immutable progress record for one user on one DSA problem.
 */
public record DsaProgressView(
        String slug,
        String status,          // SOLVED, ATTEMPTED, or NEW
        String difficulty,
        String topic,
        int attempts,
        String lastLanguage,
        String lastCode,
        boolean bookmarked,
        String solvedAt
) {}
