package com.aitutor.security;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpStatus;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.time.Instant;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Lightweight pre-authentication IP flood limiter executed BEFORE
 * {@link JwtAuthenticationFilter}.
 *
 * Caps high-velocity traffic (including forged or revoked Bearer JWT floods)
 * in O(1) bounded memory before JWT validation queries the database, mitigating
 * pre-auth DB connection pool amplification (HIGH-SEC-02).
 */
public class PreAuthRateLimitFilter extends OncePerRequestFilter {
    private static final int MAX_ENTRIES = 10_000;
    private static final long WINDOW_MS = 60_000L;

    private record Window(long startedAt, int count) {}

    private final Map<String, Window> windows = new LinkedHashMap<>(256, 0.75f, true) {
        @Override
        protected boolean removeEldestEntry(Map.Entry<String, Window> eldest) {
            return size() > MAX_ENTRIES;
        }
    };
    private long lastSweepAt = 0L;

    private final boolean enabled;
    private final int maxPerMinute;
    private final boolean trustProxy;

    public PreAuthRateLimitFilter(boolean enabled, int maxPerMinute, boolean trustProxy) {
        this.enabled = enabled;
        this.maxPerMinute = Math.max(30, maxPerMinute);
        this.trustProxy = trustProxy;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        if (!enabled || "OPTIONS".equalsIgnoreCase(request.getMethod())) {
            chain.doFilter(request, response);
            return;
        }
        String ip = RequestRateLimitFilter.resolveClientAddress(request, trustProxy);
        long now = Instant.now().toEpochMilli();
        Window current;
        synchronized (windows) {
            if (now - lastSweepAt > WINDOW_MS && windows.size() > 1000) {
                Iterator<Map.Entry<String, Window>> it = windows.entrySet().iterator();
                while (it.hasNext()) {
                    if (now - it.next().getValue().startedAt() >= WINDOW_MS) {
                        it.remove();
                    }
                }
                lastSweepAt = now;
            }
            Window old = windows.get(ip);
            if (old == null || now - old.startedAt() >= WINDOW_MS) {
                current = new Window(now, 1);
            } else {
                current = new Window(old.startedAt(), old.count() + 1);
            }
            windows.put(ip, current);
        }

        if (current.count() > maxPerMinute) {
            long retry = Math.max(1, (WINDOW_MS - (now - current.startedAt())) / 1000L);
            response.setStatus(HttpStatus.TOO_MANY_REQUESTS.value());
            response.setContentType("application/json");
            response.setHeader("Retry-After", String.valueOf(retry));
            response.getWriter().write("{\"error\":\"RATE_LIMITED\",\"message\":\"Too many requests. Please retry later.\"}");
            return;
        }
        chain.doFilter(request, response);
    }
}
