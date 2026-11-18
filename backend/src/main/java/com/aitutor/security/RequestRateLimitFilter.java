package com.aitutor.security;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.time.Instant;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;

/**
 * Bounded per-instance fixed-window rate limiter for API protection.
 *
 * Architectural note: This filter runs in-memory on a single JVM instance
 * (suitable for NovaTutor's single-instance Render deployment). Horizontal
 * multi-replica deployments require a shared Redis/WAF rate-limit layer.
 *
 * Security hardening:
 * - Never trusts client-spoofable X-Real-IP or the leftmost X-Forwarded-For hop.
 *   When trustProxy=true behind a single trusted reverse proxy (e.g. Render),
 *   extracts the rightmost proxy-appended X-Forwarded-For entry, falling back to
 *   request.getRemoteAddr().
 * - Enforces a strict upper bound (MAX_ENTRIES) using LRU eviction even under
 *   429 floods so rotating IPs cannot exhaust JVM heap.
 * - Categorizes all AI generation, DSA execution, password recovery, and upload
 *   endpoints into dedicated buckets instead of falling through to `general`.
 */
public class RequestRateLimitFilter extends OncePerRequestFilter {
    private static final int MAX_ENTRIES = 10_000;
    private static final long MAX_WINDOW_MS = 600_000L;

    private record Window(long startedAt, long windowMs, int count) {}
    private record Policy(String bucket, int limit, long windowMs, boolean ipScoped) {}

    // Access-ordered bounded map guarded by its monitor; O(1) lookup, update & LRU eviction.
    private final Map<String, Window> windows = new LinkedHashMap<>(256, 0.75f, true) {
        @Override
        protected boolean removeEldestEntry(Map.Entry<String, Window> eldest) {
            return size() > MAX_ENTRIES;
        }
    };
    private long lastSweepAt = 0L;

    private final boolean enabled;
    private final int generalRpm, authRpm, recoveryRpm, aiRpm, codeRpm, upload10m, adminRpm;
    private final boolean trustProxy;

    public RequestRateLimitFilter(
            @Value("${app.rate-limit.enabled:true}") boolean enabled,
            @Value("${app.rate-limit.requests-per-minute:120}") int generalRpm,
            @Value("${app.rate-limit.auth-per-minute:10}") int authRpm,
            @Value("${app.rate-limit.ai-per-minute:20}") int aiRpm,
            @Value("${app.rate-limit.code-per-minute:20}") int codeRpm,
            @Value("${app.rate-limit.upload-per-10-minutes:5}") int upload10m,
            @Value("${app.rate-limit.admin-per-minute:600}") int adminRpm,
            @Value("${app.rate-limit.trust-proxy:false}") boolean trustProxy) {
        this.enabled = enabled;
        this.generalRpm = Math.max(10, generalRpm);
        this.authRpm = Math.max(3, authRpm);
        this.recoveryRpm = Math.max(3, Math.min(10, authRpm));
        this.aiRpm = Math.max(5, aiRpm);
        this.codeRpm = Math.max(5, codeRpm);
        this.upload10m = Math.max(1, upload10m);
        this.adminRpm = Math.max(60, adminRpm);
        this.trustProxy = trustProxy;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        if (!enabled || "OPTIONS".equalsIgnoreCase(request.getMethod())) {
            chain.doFilter(request, response);
            return;
        }

        Policy policy = classify(request.getMethod(), request.getRequestURI());
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        boolean isGuest = isGuestAuth(auth);

        int effectiveLimit = policy.limit();
        // Keep guest sessions bounded on expensive external APIs while preserving legitimate use.
        if (isGuest) {
            if ("ai".equals(policy.bucket())) effectiveLimit = Math.max(5, Math.min(effectiveLimit, 20));
            else if ("code".equals(policy.bucket())) effectiveLimit = Math.max(5, Math.min(effectiveLimit, 15));
            else if ("upload".equals(policy.bucket())) effectiveLimit = Math.max(2, Math.min(effectiveLimit, 5));
        }

        // For guests on AI/code/upload/auth, key by IP as well as user identity so minting
        // fresh guest sessions cannot reset rate-limit counters.
        String identity = (policy.ipScoped() || (isGuest && ("ai".equals(policy.bucket()) || "code".equals(policy.bucket()) || "upload".equals(policy.bucket()))))
                ? "ip:" + clientAddress(request)
                : rateLimitIdentity(request, auth);
        String key = policy.bucket() + ":" + identity;

        long now = Instant.now().toEpochMilli();
        Window current;
        synchronized (windows) {
            if (now - lastSweepAt > 60_000L && windows.size() > 1000) {
                Iterator<Map.Entry<String, Window>> it = windows.entrySet().iterator();
                while (it.hasNext()) {
                    Window w = it.next().getValue();
                    if (now - w.startedAt() >= Math.max(w.windowMs(), MAX_WINDOW_MS)) {
                        it.remove();
                    }
                }
                lastSweepAt = now;
            }
            Window old = windows.get(key);
            if (old == null || now - old.startedAt() >= policy.windowMs()) {
                current = new Window(now, policy.windowMs(), 1);
            } else {
                current = new Window(old.startedAt(), policy.windowMs(), old.count() + 1);
            }
            windows.put(key, current);
        }

        if (current.count() > effectiveLimit) {
            long retry = Math.max(1, (policy.windowMs() - (now - current.startedAt())) / 1000L);
            response.setStatus(HttpStatus.TOO_MANY_REQUESTS.value());
            response.setContentType("application/json");
            response.setHeader("Retry-After", String.valueOf(retry));
            response.getWriter().write("{\"error\":\"RATE_LIMITED\",\"message\":\"Too many requests. Please retry later.\"}");
            return;
        }
        chain.doFilter(request, response);
    }

    Policy classify(String method, String path) {
        String p = path == null ? "" : path;
        String m = method == null ? "GET" : method.toUpperCase(Locale.ROOT);

        if (p.equals("/api/auth/forgot-password") || p.equals("/api/auth/reset-password")
                || p.equals("/api/auth/resend-verification")) {
            return new Policy("auth-recovery", recoveryRpm, 60_000L, true);
        }
        if (p.startsWith("/api/auth/")) {
            // /api/auth/me is authenticated; unauthenticated auth endpoints are IP-scoped.
            boolean ipScoped = !p.equals("/api/auth/me");
            return new Policy("auth", authRpm, 60_000L, ipScoped);
        }
        if ("POST".equals(m) && (p.contains("/upload") || p.equals("/api/admin/gate-notes"))) {
            return new Policy("upload", upload10m, 600_000L, false);
        }
        if (p.startsWith("/api/admin/")) {
            return new Policy("admin", adminRpm, 60_000L, false);
        }
        if (p.startsWith("/api/code/")
                || ("POST".equals(m) && p.startsWith("/api/dsa/problems/") && p.endsWith("/run"))) {
            return new Policy("code", codeRpm, 60_000L, false);
        }
        if (p.startsWith("/api/ai/")
                || p.equals("/api/dpp/generate")
                || p.equals("/api/interview/ask")
                || p.startsWith("/api/mentor/ask")
                || ("POST".equals(m) && p.startsWith("/api/chat/conversations/") && p.endsWith("/messages"))
                || ("POST".equals(m) && p.startsWith("/api/knowledge/") && (p.endsWith("/ask") || p.endsWith("/pack")))
                || ("POST".equals(m) && p.startsWith("/api/dsa/problems/") && p.endsWith("/hint"))
                || ("POST".equals(m) && p.startsWith("/api/adaptive/") && p.endsWith("/ai-question"))) {
            return new Policy("ai", aiRpm, 60_000L, false);
        }
        return new Policy("general", generalRpm, 60_000L, false);
    }

    private boolean isGuestAuth(Authentication authentication) {
        if (authentication == null || authentication.getAuthorities() == null) return false;
        return authentication.getAuthorities().stream()
                .anyMatch(a -> "ROLE_GUEST".equalsIgnoreCase(a.getAuthority()));
    }

    private String rateLimitIdentity(HttpServletRequest request, Authentication authentication) {
        if (authentication != null && authentication.isAuthenticated() && authentication.getName() != null
                && !authentication.getName().isBlank() && !"anonymousUser".equals(authentication.getName())) {
            return "user:" + authentication.getName().trim().toLowerCase(Locale.ROOT);
        }
        return "ip:" + clientAddress(request);
    }

    /**
     * Never trust arbitrary client-supplied X-Real-IP or leftmost X-Forwarded-For.
     * Behind a single trusted reverse proxy (e.g. Render), the proxy appends the true
     * peer IP as the rightmost entry of X-Forwarded-For.
     */
    String clientAddress(HttpServletRequest request) {
        if (trustProxy) {
            String chain = request.getHeader("X-Forwarded-For");
            if (chain != null && !chain.isBlank()) {
                String[] parts = chain.split(",");
                for (int i = parts.length - 1; i >= 0; i--) {
                    String candidate = parts[i].trim();
                    if (!candidate.isBlank()) return candidate;
                }
            }
        }
        return request.getRemoteAddr();
    }
}
