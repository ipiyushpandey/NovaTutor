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
        @SuppressWarnings("unchecked")
        Map<String, Object> quota = (Map<String, Object>) snapshot.get("dailyQuota");
        assertNotNull(quota);
        assertEquals("UNAVAILABLE", quota.get("limitStatus"));
        assertEquals(false, quota.get("available"));
    }

    @Test
    void tracksDailyUsageAndQuotaLimitsAccurately() {
        AiMetrics metrics = new AiMetrics(100);
        com.aitutor.config.AppMetaRepository mockMeta = org.mockito.Mockito.mock(com.aitutor.config.AppMetaRepository.class);
        org.mockito.Mockito.when(mockMeta.findByKeyForUpdate(org.mockito.ArgumentMatchers.anyString()))
                .thenReturn(java.util.Optional.of(new com.aitutor.config.AppMeta(AiMetrics.QUOTA_MUTEX_KEY, "0")));
        java.util.concurrent.atomic.AtomicLong counter = new java.util.concurrent.atomic.AtomicLong(0);
        org.mockito.Mockito.when(mockMeta.findById(org.mockito.ArgumentMatchers.contains("ai_daily_usage_")))
                .thenAnswer(inv -> java.util.Optional.of(new com.aitutor.config.AppMeta(inv.getArgument(0), String.valueOf(counter.get()))));
        org.mockito.Mockito.when(mockMeta.save(org.mockito.ArgumentMatchers.any()))
                .thenAnswer(inv -> {
                    com.aitutor.config.AppMeta m = inv.getArgument(0);
                    if (m.getKey().contains("ai_daily_usage_")) counter.set(Long.parseLong(m.getValue()));
                    return m;
                });
        org.springframework.transaction.PlatformTransactionManager mockTx = org.mockito.Mockito.mock(org.springframework.transaction.PlatformTransactionManager.class);
        org.mockito.Mockito.when(mockTx.getTransaction(org.mockito.ArgumentMatchers.any()))
                .thenReturn(org.mockito.Mockito.mock(org.springframework.transaction.TransactionStatus.class));
        metrics.setTransactionManager(mockTx);
        metrics.setMetaRepository(mockMeta);

        metrics.reserveDailyQuota();
        metrics.record("TUTOR", 500, true);
        metrics.reserveDailyQuota();
        metrics.record("QA", 400, true);

        Map<String, Object> snapshot = metrics.snapshot();
        @SuppressWarnings("unchecked")
        Map<String, Object> quota = (Map<String, Object>) snapshot.get("dailyQuota");
        assertNotNull(quota);
        assertEquals(2L, quota.get("todayRequests"));
        assertEquals(100, quota.get("dailyLimit"));
        assertEquals(98L, quota.get("remainingQuota"));
        assertEquals(2.0, quota.get("percentConsumed"));
        assertEquals(98.0, quota.get("percentRemaining"));
        assertEquals("NORMAL", quota.get("limitStatus"));
        assertNotNull(quota.get("resetAt"));
        assertTrue(String.valueOf(quota.get("resetSchedule")).contains("00:00 UTC"));
    }
}
