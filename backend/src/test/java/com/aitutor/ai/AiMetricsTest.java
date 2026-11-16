package com.aitutor.ai;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class AiMetricsTest {
    @Test
    void aggregatesLatencyFailureRateAndFirstTokenTimings() {
        AiMetrics metrics = new AiMetrics();
        metrics.record("TUTOR", 1200, true, 300);
        metrics.record("TUTOR", 1800, true, 420);
        metrics.record("TUTOR", 900, false);
        metrics.record("QUIZ", 400, true);

        Map<String, Object> snapshot = metrics.snapshot();
        assertEquals(4L, snapshot.get("totalRequests"));
        assertEquals(1L, snapshot.get("totalFailures"));
        assertEquals(25.0, snapshot.get("failureRate"));

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> tasks = (List<Map<String, Object>>) snapshot.get("tasks");
        assertEquals(2, tasks.size());
        Map<String, Object> tutor = tasks.stream().filter(t -> "TUTOR".equals(t.get("task"))).findFirst().orElseThrow();
        assertEquals(3L, tutor.get("requests"));
        assertEquals(1L, tutor.get("failures"));
        assertEquals(1300L, tutor.get("averageMs"));
        assertEquals(1800L, tutor.get("maxMs"));
        assertEquals(2L, tutor.get("streams"));
        assertEquals(360L, tutor.get("firstTokenAvgMs"));
    }

    @Test
    void emptyMetricsReportZeroRatherThanFailing() {
        Map<String, Object> snapshot = new AiMetrics().snapshot();
        assertEquals(0L, snapshot.get("totalRequests"));
        assertEquals(0.0, snapshot.get("failureRate"));
        assertTrue(((List<?>) snapshot.get("tasks")).isEmpty());
    }
}
