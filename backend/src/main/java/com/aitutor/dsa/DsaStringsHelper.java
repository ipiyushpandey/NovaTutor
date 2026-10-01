package com.aitutor.dsa;

/** Shared helpers for the string problem banks. */
public final class DsaStringsHelper {
    private DsaStringsHelper() {}

    /** Validates one IPv4 segment (0-255, no leading zeros). */
    static boolean valid(String seg) {
        if (seg == null || seg.isEmpty() || seg.length() > 3) return false;
        if (seg.length() > 1 && seg.charAt(0) == '0') return false;
        for (char c : seg.toCharArray()) if (!Character.isDigit(c)) return false;
        return Integer.parseInt(seg) <= 255;
    }
}
