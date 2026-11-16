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
