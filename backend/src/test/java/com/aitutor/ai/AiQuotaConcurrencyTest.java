package com.aitutor.ai;

import com.aitutor.config.AppMeta;
import com.aitutor.config.AppMetaRepository;
import com.aitutor.controller.ApiException;
import com.aitutor.service.AiService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpStatus;
import org.springframework.test.context.ActiveProfiles;

import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest
@ActiveProfiles("test")
public class AiQuotaConcurrencyTest {

    @Autowired
    private AppMetaRepository meta;

    @Autowired
    private AiMetrics metrics;

    @Autowired
    private AiService aiService;

    @Autowired
    private org.springframework.transaction.PlatformTransactionManager txManager;

    private String todayKey;

    @BeforeEach
    void setUp() {
        todayKey = "ai_daily_usage_" + LocalDate.now(ZoneOffset.UTC);
        meta.deleteById(todayKey);
        metrics.resetForTest();
        // Ensure mutex row exists
        if (!meta.existsById(AiMetrics.QUOTA_MUTEX_KEY)) {
            meta.saveAndFlush(new AppMeta(AiMetrics.QUOTA_MUTEX_KEY, "0"));
        }
    }

    @Test
    @DisplayName("Concurrent requests cannot exceed the configured quota")
    void concurrentRequestsCannotExceedConfiguredQuota() throws InterruptedException {
        int quotaLimit = 15;
        metrics.setDailyLimit(quotaLimit);

        int totalThreads = 40;
        ExecutorService executor = Executors.newFixedThreadPool(10);
        CountDownLatch startGate = new CountDownLatch(1);
        CountDownLatch doneGate = new CountDownLatch(totalThreads);

        AtomicInteger successCount = new AtomicInteger(0);
        AtomicInteger quotaExceededCount = new AtomicInteger(0);
        AtomicInteger otherFailures = new AtomicInteger(0);

        for (int i = 0; i < totalThreads; i++) {
            executor.submit(() -> {
                try {
                    startGate.await();
                    metrics.reserveDailyQuota();
                    successCount.incrementAndGet();
                } catch (ApiException e) {
                    if (e.status() == HttpStatus.TOO_MANY_REQUESTS && "AI_QUOTA_EXHAUSTED".equals(e.code())) {
                        quotaExceededCount.incrementAndGet();
                    } else {
                        otherFailures.incrementAndGet();
                    }
                } catch (Exception e) {
                    otherFailures.incrementAndGet();
                } finally {
                    doneGate.countDown();
                }
            });
        }

        startGate.countDown();
        assertTrue(doneGate.await(15, TimeUnit.SECONDS), "Timed out waiting for concurrent reservations");
        executor.shutdown();

        assertEquals(quotaLimit, successCount.get(), "Exact quota limit must be reserved");
        assertEquals(totalThreads - quotaLimit, quotaExceededCount.get(), "Excess requests must receive 429 quota exhausted");
        assertEquals(0, otherFailures.get(), "No unexpected concurrency failures");

        // Verify shared persisted database state
        AppMeta stored = meta.findById(todayKey).orElseThrow();
        assertEquals(String.valueOf(quotaLimit), stored.getValue().trim());
    }

    @Test
    @DisplayName("Two independently constructed service/metrics instances share the same persisted quota")
    void twoIndependentlyConstructedInstancesSharePersistedQuota() {
        AiMetrics instanceA = new AiMetrics(10);
        instanceA.setMetaRepository(meta);
        instanceA.setTransactionManager(txManager);

        AiMetrics instanceB = new AiMetrics(10);
        instanceB.setMetaRepository(meta);
        instanceB.setTransactionManager(txManager);

        // Instance A reserves 6 requests
        for (int i = 0; i < 6; i++) {
            long count = instanceA.reserveDailyQuota();
            assertEquals(i + 1, count);
        }

        // Instance B reserves 4 requests reaching the limit of 10
        for (int i = 6; i < 10; i++) {
            long count = instanceB.reserveDailyQuota();
            assertEquals(i + 1, count);
        }

        // 11th request on Instance A must be rejected
        ApiException exA = assertThrows(ApiException.class, instanceA::reserveDailyQuota);
        assertEquals(HttpStatus.TOO_MANY_REQUESTS, exA.status());
        assertEquals("AI_QUOTA_EXHAUSTED", exA.code());

        // 12th request on Instance B must also be rejected
        ApiException exB = assertThrows(ApiException.class, instanceB::reserveDailyQuota);
        assertEquals(HttpStatus.TOO_MANY_REQUESTS, exB.status());
        assertEquals("AI_QUOTA_EXHAUSTED", exB.code());

        assertEquals(10L, instanceA.getTodayRequests());
        assertEquals(10L, instanceB.getTodayRequests());
    }

    @Test
    @DisplayName("First-ever concurrent reservations create the daily counter safely without missing-row race")
    void firstEverConcurrentReservationsCreateCounterSafely() throws InterruptedException {
        int threads = 25;
        metrics.setDailyLimit(100);

        ExecutorService executor = Executors.newFixedThreadPool(8);
        CountDownLatch startGate = new CountDownLatch(1);
        CountDownLatch doneGate = new CountDownLatch(threads);
        List<Long> reservedSlots = new CopyOnWriteArrayList<>();

        for (int i = 0; i < threads; i++) {
            executor.submit(() -> {
                try {
                    startGate.await();
                    long slot = metrics.reserveDailyQuota();
                    reservedSlots.add(slot);
                } catch (Exception ignored) {
                } finally {
                    doneGate.countDown();
                }
            });
        }

        startGate.countDown();
        assertTrue(doneGate.await(15, TimeUnit.SECONDS));
        executor.shutdown();

        assertEquals(threads, reservedSlots.size(), "All initial concurrent reservations must succeed");
        assertEquals(threads, metrics.getTodayRequests(), "Today count must reflect exactly all reservations");
    }

    @Test
    @DisplayName("Request reaching the limit is accepted and next request is rejected before AI provider is called")
    void requestReachingLimitHandledCorrectlyAndNextRejectedBeforeProvider() {
        metrics.setDailyLimit(3);

        // Custom dummy provider to track calls
        AtomicInteger providerCalls = new AtomicInteger(0);
        AiProvider dummyProvider = new AiProvider() {
            @Override
            public String name() { return "mock"; }
            @Override
            public boolean available() { return true; }
            @Override
            public AiResponse generate(AiRequest req) {
                providerCalls.incrementAndGet();
                return new AiResponse("Answer " + providerCalls.get(), req.task().name(), "mock");
            }
        };

        AiService service = new AiService(List.of(dummyProvider), metrics);

        // Requests 1, 2, 3 must succeed
        service.ask(new AiRequest(AiTask.TUTOR, "Topic", "Question 1", "Beginner", "English"));
        service.ask(new AiRequest(AiTask.TUTOR, "Topic", "Question 2", "Beginner", "English"));
        service.ask(new AiRequest(AiTask.TUTOR, "Topic", "Question 3", "Beginner", "English"));
        assertEquals(3, providerCalls.get());
        assertEquals(3, metrics.getTodayRequests());

        // Request 4 must be rejected before provider is called
        ApiException ex = assertThrows(ApiException.class, () -> service.ask(new AiRequest(AiTask.TUTOR, "Topic", "Question 4", "Beginner", "English")));
        assertEquals(HttpStatus.TOO_MANY_REQUESTS, ex.status());
        assertEquals("AI_QUOTA_EXHAUSTED", ex.code());

        // Crucial verification: providerCalls remains 3 (never invoked)
        assertEquals(3, providerCalls.get(), "Provider must not be called when quota is exceeded");
    }

    @Test
    @DisplayName("Database persistence failure rejects the request instead of failing open")
    void databasePersistenceFailureRejectsRequestInsteadOfFailingOpen() {
        AiMetrics brokenMetrics = new AiMetrics(100);
        // meta is null or broken
        brokenMetrics.setMetaRepository(null);

        ApiException ex = assertThrows(ApiException.class, brokenMetrics::reserveDailyQuota);
        assertEquals(HttpStatus.SERVICE_UNAVAILABLE, ex.status());
        assertEquals("AI_QUOTA_STORAGE_UNAVAILABLE", ex.code());

        // Now test with repo that throws on update
        AppMetaRepository throwingRepo = (AppMetaRepository) java.lang.reflect.Proxy.newProxyInstance(
                AppMetaRepository.class.getClassLoader(),
                new Class<?>[]{AppMetaRepository.class},
                (proxy, method, args) -> {
                    throw new org.springframework.dao.DataAccessResourceFailureException("Simulated TiDB disconnection");
                }
        );

        AiMetrics dbFailingMetrics = new AiMetrics(100);
        dbFailingMetrics.setMetaRepository(throwingRepo);

        ApiException dbEx = assertThrows(ApiException.class, dbFailingMetrics::reserveDailyQuota);
        assertEquals(HttpStatus.SERVICE_UNAVAILABLE, dbEx.status());
        assertEquals("AI_QUOTA_UNAVAILABLE", dbEx.code());
        assertTrue(dbEx.getMessage().contains("Simulated TiDB disconnection"));
    }

    @Test
    @DisplayName("Every accepted request is counted exactly once, even if provider throws an error")
    void everyAcceptedRequestCountedExactlyOnceEvenOnFailure() {
        metrics.setDailyLimit(10);
        long initialCount = metrics.getTodayRequests();

        AiProvider failingProvider = new AiProvider() {
            @Override
            public String name() { return "failing"; }
            @Override
            public boolean available() { return true; }
            @Override
            public AiResponse generate(AiRequest req) {
                throw new RuntimeException("Simulated upstream Gemini 500 error");
            }
        };

        AiService service = new AiService(List.of(failingProvider), metrics);

        assertThrows(RuntimeException.class, () -> service.ask(new AiRequest(AiTask.TUTOR, "Topic", "Test question", "Beginner", "English")));

        // Quota was reserved upfront, so it must increment by exactly 1
        assertEquals(initialCount + 1, metrics.getTodayRequests(), "Accepted request must be counted once even on upstream provider failure");

        // Verify telemetry recorded the failure
        var snapshot = metrics.snapshot();
        assertTrue(((Long) snapshot.get("totalFailures")) >= 1);
    }
}
