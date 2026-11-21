package com.aitutor.ai;

import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.LongAdder;

/**
 * Lightweight, per-instance AI telemetry.
 *
 * Tracks real request timings and outcomes for every AI task so the admin
 * panel reports measured behaviour instead of a guess. Values reset when the
 * process restarts; they are operational signals, not billing records.
 */
@Component
public class AiMetrics {
    private final Map<String, TaskStat> tasks = new ConcurrentHashMap<>();
    private final LongAdder totalRequests = new LongAdder();
    private final LongAdder totalFailures = new LongAdder();
    private volatile Instant startedAt = Instant.now();
    private volatile int dailyLimit;
    private volatile java.time.LocalDate todayDate = java.time.LocalDate.now(java.time.ZoneOffset.UTC);
    private final LongAdder todayRequests = new LongAdder();

    @org.springframework.beans.factory.annotation.Autowired(required = false)
    private com.aitutor.config.AppMetaRepository meta;

    public AiMetrics() {
        this(1500);
    }

    public AiMetrics(@org.springframework.beans.factory.annotation.Value("${ai.gemini.daily-limit:1500}") int dailyLimit) {
        this.dailyLimit = Math.max(10, dailyLimit);
    }

    @jakarta.annotation.PostConstruct
    public void initFromDb() {
        if (meta == null) return;
        try {
            if (!meta.existsById(QUOTA_MUTEX_KEY)) {
                meta.saveAndFlush(new com.aitutor.config.AppMeta(QUOTA_MUTEX_KEY, "0"));
            }
            String todayKey = "ai_daily_usage_" + todayDate;
            meta.findById(todayKey).ifPresent(m -> {
                try {
                    long stored = Long.parseLong(m.getValue().trim());
                    if (stored > 0) setTodayBase(stored);
                } catch (Exception ignored) {}
            });
            meta.findById("ai.dailyLimit").ifPresent(m -> {
                try {
                    int lim = Integer.parseInt(m.getValue().trim());
                    if (lim > 0) setDailyLimit(lim);
                } catch (Exception ignored) {}
            });
        } catch (Exception ignored) {}
    }

    private void persistIfMeta(long count) {
        if (meta == null) return;
        try {
            String todayKey = "ai_daily_usage_" + todayDate;
            meta.save(new com.aitutor.config.AppMeta(todayKey, String.valueOf(count)));
        } catch (Exception ignored) {}
    }

    @jakarta.annotation.PreDestroy
    public void persistOnShutdown() {
        // Every reservation is immediately persisted and flushed atomically in reserveDailyQuota.
        // Never overwrite the shared database count on shutdown with an instance-local sum.
    }

    public void setDailyLimit(int limit) {
        this.dailyLimit = Math.max(1, limit);
    }

    private void checkDateRoll() {
        java.time.LocalDate current = java.time.LocalDate.now(java.time.ZoneOffset.UTC);
        if (!current.equals(todayDate)) {
            synchronized (this) {
                if (!current.equals(todayDate)) {
                    todayDate = current;
                    todayRequests.reset();
                }
            }
        }
    }

    public void setTodayBase(long base) {
        checkDateRoll();
        synchronized (this) {
            long currentSum = todayRequests.sum();
            if (base > currentSum) {
                todayRequests.add(base - currentSum);
            }
        }
    }

    public void resetForTest() {
        synchronized (this) {
            todayRequests.reset();
            totalRequests.reset();
            totalFailures.reset();
        }
    }

    public static final String QUOTA_MUTEX_KEY = "ai_quota_mutex";

    @org.springframework.beans.factory.annotation.Autowired(required = false)
    private org.springframework.transaction.PlatformTransactionManager transactionManager;

    public void setMetaRepository(com.aitutor.config.AppMetaRepository meta) {
        this.meta = meta;
    }

    public void setTransactionManager(org.springframework.transaction.PlatformTransactionManager txManager) {
        this.transactionManager = txManager;
    }

    public long reserveDailyQuota() {
        if (transactionManager == null) {
            throw new com.aitutor.controller.ApiException(
                org.springframework.http.HttpStatus.SERVICE_UNAVAILABLE,
                "AI_QUOTA_TRANSACTION_UNAVAILABLE",
                "Transaction manager is unavailable. Quota cannot be safely reserved."
            );
        }
        if (meta == null) {
            throw new com.aitutor.controller.ApiException(
                org.springframework.http.HttpStatus.SERVICE_UNAVAILABLE,
                "AI_QUOTA_STORAGE_UNAVAILABLE",
                "Persistence service is unavailable. Quota cannot be safely reserved."
            );
        }

        org.springframework.transaction.support.TransactionTemplate tt =
                new org.springframework.transaction.support.TransactionTemplate(transactionManager);
        tt.setPropagationBehavior(org.springframework.transaction.TransactionDefinition.PROPAGATION_REQUIRES_NEW);

        Long reserved;
        try {
            reserved = tt.execute(status -> doReserveDailyQuota());
        } catch (com.aitutor.controller.ApiException e) {
            throw e;
        } catch (Exception ex) {
            throw new com.aitutor.controller.ApiException(
                org.springframework.http.HttpStatus.SERVICE_UNAVAILABLE,
                "AI_QUOTA_UNAVAILABLE",
                "AI quota reservation failed: " + ex.getMessage()
            );
        }

        if (reserved == null) {
            throw new com.aitutor.controller.ApiException(
                org.springframework.http.HttpStatus.SERVICE_UNAVAILABLE,
                "AI_QUOTA_RESERVATION_FAILED",
                "Transaction completed without reserving quota slot."
            );
        }

        // ONLY update in-memory state after transaction has committed successfully!
        setTodayBase(reserved);
        return reserved;
    }

    private synchronized long doReserveDailyQuota() {
        checkDateRoll();
        String todayKey = "ai_daily_usage_" + todayDate;

        // Guarantee that the global mutex row is locked across all application instances
        var mutexOpt = meta.findByKeyForUpdate(QUOTA_MUTEX_KEY);
        if (mutexOpt.isEmpty()) {
            throw new com.aitutor.controller.ApiException(
                org.springframework.http.HttpStatus.SERVICE_UNAVAILABLE,
                "AI_QUOTA_MUTEX_MISSING",
                "AI quota synchronization mutex row ('" + QUOTA_MUTEX_KEY + "') does not exist."
            );
        }

        // Read the current global usage for today
        long currentCount = 0L;
        var currentOpt = meta.findById(todayKey);
        if (currentOpt.isPresent()) {
            String raw = currentOpt.get().getValue();
            if (raw == null || raw.isBlank()) {
                throw new com.aitutor.controller.ApiException(
                    org.springframework.http.HttpStatus.SERVICE_UNAVAILABLE,
                    "AI_QUOTA_COUNTER_INVALID",
                    "Persisted daily quota counter is blank or invalid."
                );
            }
            try {
                currentCount = Long.parseLong(raw.trim());
                if (currentCount < 0) {
                    throw new com.aitutor.controller.ApiException(
                        org.springframework.http.HttpStatus.SERVICE_UNAVAILABLE,
                        "AI_QUOTA_COUNTER_INVALID",
                        "Persisted daily quota counter cannot be negative (" + currentCount + ")."
                    );
                }
            } catch (NumberFormatException nfe) {
                throw new com.aitutor.controller.ApiException(
                    org.springframework.http.HttpStatus.SERVICE_UNAVAILABLE,
                    "AI_QUOTA_COUNTER_INVALID",
                    "Persisted daily quota counter is malformed: " + raw.trim()
                );
            }
        }

        int limit = getDailyLimit();
        if (currentCount >= limit) {
            throw new com.aitutor.controller.ApiException(
                org.springframework.http.HttpStatus.TOO_MANY_REQUESTS,
                "AI_QUOTA_EXHAUSTED",
                "Daily AI quota has been reached (" + currentCount + "/" + limit + "). Quota resets daily at 00:00 UTC."
            );
        }

        long newCount = currentCount + 1;
        meta.save(new com.aitutor.config.AppMeta(todayKey, String.valueOf(newCount)));
        meta.flush();
        // Do NOT update in-memory state here! Return newCount so caller updates it only after commit.
        return newCount;
    }

    public boolean isQuotaExceeded() {
        checkDateRoll();
        return getTodayRequests() >= dailyLimit;
    }

    public long getTodayRequests() {
        checkDateRoll();
        if (meta != null) {
            try {
                String todayKey = "ai_daily_usage_" + todayDate;
                var currentOpt = meta.findById(todayKey);
                if (currentOpt.isPresent()) {
                    String raw = currentOpt.get().getValue();
                    if (raw != null && !raw.isBlank()) {
                        long stored = Long.parseLong(raw.trim());
                        if (stored >= 0) {
                            return stored;
                        }
                    }
                } else {
                    return 0L;
                }
            } catch (Exception ignored) {}
        }
        return todayRequests.sum();
    }

    public int getDailyLimit() {
        return dailyLimit;
    }

    public void record(String task, long durationMs, boolean success) {
        record(task, durationMs, success, -1);
    }

    public void record(String task, long durationMs, boolean success, long firstTokenMs) {
        String key = task == null || task.isBlank() ? "UNKNOWN" : task.toUpperCase();
        TaskStat stat = tasks.computeIfAbsent(key, k -> new TaskStat());
        stat.count.increment();
        stat.totalMs.add(Math.max(0, durationMs));
        stat.maxMs.accumulate(Math.max(0, durationMs));
        stat.sample(durationMs);
        if (!success) stat.failures.increment();
        if (firstTokenMs >= 0) {
            stat.streams.increment();
            stat.firstTokenTotal.add(firstTokenMs);
            stat.firstTokenMax.accumulate(firstTokenMs);
        }
        totalRequests.increment();
        if (!success) totalFailures.increment();
    }

    public Map<String, Object> snapshot() {
        List<Map<String, Object>> rows = new ArrayList<>();
        tasks.entrySet().stream()
                .sorted(Comparator.comparing(Map.Entry::getKey))
                .forEach(e -> {
                    TaskStat s = e.getValue();
                    long count = s.count.sum();
                    long failures = s.failures.sum();
                    Map<String, Object> row = new LinkedHashMap<>();
                    row.put("task", e.getKey());
                    row.put("requests", count);
                    row.put("failures", failures);
                    row.put("failureRate", count == 0 ? 0.0 : round((double) failures / count * 100));
                    row.put("medianMs", count == 0 ? 0 : s.medianMs());
                    row.put("averageMs", count == 0 ? 0 : s.totalMs.sum() / count);
                    row.put("maxMs", s.maxMs.get());
                    if (s.streams.sum() > 0) {
                        row.put("streams", s.streams.sum());
                        row.put("firstTokenAvgMs", s.firstTokenTotal.sum() / s.streams.sum());
                        row.put("firstTokenMaxMs", s.firstTokenMax.get());
                    }
                    rows.add(row);
                });
        long requests = totalRequests.sum();
        long failures = totalFailures.sum();
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("windowStartedAt", startedAt.toString());
        out.put("totalRequests", requests);
        out.put("totalFailures", failures);
        out.put("failureRate", requests == 0 ? 0.0 : round((double) failures / requests * 100));
        out.put("tasks", rows);

        checkDateRoll();
        long today = getTodayRequests();
        long remaining = Math.max(0, dailyLimit - today);
        double pctConsumed = round(dailyLimit <= 0 ? 0.0 : ((double) today / dailyLimit) * 100.0);
        double pctRemaining = round(Math.max(0.0, 100.0 - pctConsumed));
        String status = today >= dailyLimit ? "EXHAUSTED" : (today >= (dailyLimit * 0.8) ? "APPROACHING_LIMIT" : "NORMAL");
        java.time.ZonedDateTime nextMidnight = java.time.LocalDate.now(java.time.ZoneOffset.UTC).plusDays(1).atStartOfDay(java.time.ZoneOffset.UTC);

        Map<String, Object> dailyQuota = new LinkedHashMap<>();
        dailyQuota.put("todayRequests", today);
        dailyQuota.put("dailyLimit", dailyLimit);
        dailyQuota.put("remainingQuota", remaining);
        dailyQuota.put("percentConsumed", pctConsumed);
        dailyQuota.put("percentRemaining", pctRemaining);
        dailyQuota.put("limitStatus", status);
        dailyQuota.put("resetAt", nextMidnight.toInstant().toString());
        dailyQuota.put("resetSchedule", "Resets daily at 00:00 UTC (05:30 IST)");
        out.put("dailyQuota", dailyQuota);

        return out;
    }

    private static double round(double value) {
        return Math.round(value * 10.0) / 10.0;
    }

    private static final class TaskStat {
        final LongAdder count = new LongAdder();
        final LongAdder failures = new LongAdder();
        final LongAdder totalMs = new LongAdder();
        final java.util.concurrent.atomic.LongAccumulator maxMs = new java.util.concurrent.atomic.LongAccumulator(Long::max, 0);
        final LongAdder streams = new LongAdder();
        final LongAdder firstTokenTotal = new LongAdder();
        final java.util.concurrent.atomic.LongAccumulator firstTokenMax = new java.util.concurrent.atomic.LongAccumulator(Long::max, 0);
        private final int[] histogram = new int[400];
        private final Object lock = new Object();

        /** Coarse 50 ms histogram; avoids retaining per-request values forever. */
        void sample(long durationMs) {
            int bucket = (int) Math.min(histogram.length - 1, Math.max(0, durationMs / 50));
            synchronized (lock) { histogram[bucket]++; }
        }

        long medianMs() {
            long total = count.sum();
            if (total == 0) return 0;
            long target = (total + 1) / 2;
            long seen = 0;
            synchronized (lock) {
                for (int i = 0; i < histogram.length; i++) {
                    seen += histogram[i];
                    if (seen >= target) return i * 50L;
                }
            }
            return 0;
        }
    }
}
