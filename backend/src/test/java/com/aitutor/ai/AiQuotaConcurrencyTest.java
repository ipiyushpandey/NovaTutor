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
import org.springframework.transaction.PlatformTransactionManager;

import java.time.LocalDate;
import java.time.ZoneOffset;
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
    private PlatformTransactionManager txManager;

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
    @DisplayName("Two independently constructed instances running concurrent reservations through the shared database cannot exceed quota")
    void twoIndependentInstancesConcurrentSharedDatabaseReservationsCannotExceedQuota() throws InterruptedException {
        int quotaLimit = 15;

        // Instance A and Instance B are completely separate Java objects
        // They share the SAME database and SAME transaction manager.
        // Neither instance's Java 'synchronized' has any visibility into the other instance.
        AiMetrics instanceA = new AiMetrics(quotaLimit);
        instanceA.setMetaRepository(meta);
        instanceA.setTransactionManager(txManager);

        AiMetrics instanceB = new AiMetrics(quotaLimit);
        instanceB.setMetaRepository(meta);
        instanceB.setTransactionManager(txManager);

        int threadsPerInstance = 20; // 40 total concurrent threads
        int totalThreads = threadsPerInstance * 2;
        ExecutorService executor = Executors.newFixedThreadPool(16);
        CountDownLatch startGate = new CountDownLatch(1);
        CountDownLatch doneGate = new CountDownLatch(totalThreads);

        AtomicInteger successA = new AtomicInteger(0);
        AtomicInteger successB = new AtomicInteger(0);
        AtomicInteger quotaExceededCount = new AtomicInteger(0);
        AtomicInteger unexpectedFailures = new AtomicInteger(0);

        // Submit 20 threads to Instance A
        for (int i = 0; i < threadsPerInstance; i++) {
            executor.submit(() -> {
                try {
                    startGate.await();
                    instanceA.reserveDailyQuota();
                    successA.incrementAndGet();
                } catch (ApiException e) {
                    if (e.status() == HttpStatus.TOO_MANY_REQUESTS && "AI_QUOTA_EXHAUSTED".equals(e.code())) {
                        quotaExceededCount.incrementAndGet();
                    } else {
                        unexpectedFailures.incrementAndGet();
                    }
                } catch (Exception e) {
                    unexpectedFailures.incrementAndGet();
                } finally {
                    doneGate.countDown();
                }
            });
        }

        // Submit 20 threads to Instance B
        for (int i = 0; i < threadsPerInstance; i++) {
            executor.submit(() -> {
                try {
                    startGate.await();
                    instanceB.reserveDailyQuota();
                    successB.incrementAndGet();
                } catch (ApiException e) {
                    if (e.status() == HttpStatus.TOO_MANY_REQUESTS && "AI_QUOTA_EXHAUSTED".equals(e.code())) {
                        quotaExceededCount.incrementAndGet();
                    } else {
                        unexpectedFailures.incrementAndGet();
                    }
                } catch (Exception e) {
                    unexpectedFailures.incrementAndGet();
                } finally {
                    doneGate.countDown();
                }
            });
        }

        // Unleash all 40 threads across both instances at the exact same millisecond
        startGate.countDown();
        assertTrue(doneGate.await(20, TimeUnit.SECONDS), "Timed out waiting for two-instance concurrent reservations");
        executor.shutdown();

        int totalSuccess = successA.get() + successB.get();
        assertEquals(quotaLimit, totalSuccess, "Total reservations across both independent instances must equal exactly quotaLimit");
        assertEquals(totalThreads - quotaLimit, quotaExceededCount.get(), "All excess requests across both instances must receive 429 AI_QUOTA_EXHAUSTED");
        assertEquals(0, unexpectedFailures.get(), "No unexpected concurrency failures");

        // Both instances must have participated in reservations
        assertTrue(successA.get() > 0, "Instance A must have handled some successful reservations");
        assertTrue(successB.get() > 0, "Instance B must have handled some successful reservations");

        // Verify shared persisted database state is exactly quotaLimit
        AppMeta stored = meta.findById(todayKey).orElseThrow();
        assertEquals(String.valueOf(quotaLimit), stored.getValue().trim(), "Persisted database counter must exactly match quota limit");

        // Both instances must report the exact shared database count
        assertEquals(quotaLimit, instanceA.getTodayRequests());
        assertEquals(quotaLimit, instanceB.getTodayRequests());
    }

    @Test
    @DisplayName("First-ever concurrent reservations across instances safely create the daily counter without missing-row race")
    void firstEverConcurrentReservationsAcrossInstancesCreateCounterSafely() throws InterruptedException {
        // Guarantee no daily row exists yet
        meta.deleteById(todayKey);

        AiMetrics instanceA = new AiMetrics(50);
        instanceA.setMetaRepository(meta);
        instanceA.setTransactionManager(txManager);

        AiMetrics instanceB = new AiMetrics(50);
        instanceB.setMetaRepository(meta);
        instanceB.setTransactionManager(txManager);

        int totalThreads = 30;
        ExecutorService executor = Executors.newFixedThreadPool(12);
        CountDownLatch startGate = new CountDownLatch(1);
        CountDownLatch doneGate = new CountDownLatch(totalThreads);
        AtomicInteger successCount = new AtomicInteger(0);

        for (int i = 0; i < totalThreads; i++) {
            final boolean useInstanceA = (i % 2 == 0);
            executor.submit(() -> {
                try {
                    startGate.await();
                    if (useInstanceA) instanceA.reserveDailyQuota();
                    else instanceB.reserveDailyQuota();
                    successCount.incrementAndGet();
                } catch (Exception ignored) {
                } finally {
                    doneGate.countDown();
                }
            });
        }

        startGate.countDown();
        assertTrue(doneGate.await(15, TimeUnit.SECONDS));
        executor.shutdown();

        assertEquals(totalThreads, successCount.get(), "All initial concurrent reservations must succeed");
        AppMeta stored = meta.findById(todayKey).orElseThrow();
        assertEquals(String.valueOf(totalThreads), stored.getValue().trim());
    }

    @Test
    @DisplayName("Invalid, blank, malformed or negative persisted counter values fail closed")
    void invalidPersistedCounterValuesFailClosed() {
        AiMetrics testMetrics = new AiMetrics(100);
        testMetrics.setMetaRepository(meta);
        testMetrics.setTransactionManager(txManager);

        // Case 1: Blank counter value in database
        meta.saveAndFlush(new AppMeta(todayKey, "   "));
        ApiException blankEx = assertThrows(ApiException.class, testMetrics::reserveDailyQuota);
        assertEquals(HttpStatus.SERVICE_UNAVAILABLE, blankEx.status());
        assertEquals("AI_QUOTA_COUNTER_INVALID", blankEx.code());

        // Case 2: Non-numeric malformed counter value
        meta.saveAndFlush(new AppMeta(todayKey, "corrupted_counter_value_99x"));
        ApiException malformedEx = assertThrows(ApiException.class, testMetrics::reserveDailyQuota);
        assertEquals(HttpStatus.SERVICE_UNAVAILABLE, malformedEx.status());
        assertEquals("AI_QUOTA_COUNTER_INVALID", malformedEx.code());

        // Case 3: Negative counter value
        meta.saveAndFlush(new AppMeta(todayKey, "-42"));
        ApiException negativeEx = assertThrows(ApiException.class, testMetrics::reserveDailyQuota);
        assertEquals(HttpStatus.SERVICE_UNAVAILABLE, negativeEx.status());
        assertEquals("AI_QUOTA_COUNTER_INVALID", negativeEx.code());
    }

    @Test
    @DisplayName("Missing transaction manager or missing database fails closed")
    void missingTransactionManagerOrDatabaseFailsClosed() {
        // Case 1: Missing transaction manager
        AiMetrics unmanagedMetrics = new AiMetrics(100);
        unmanagedMetrics.setMetaRepository(meta);
        unmanagedMetrics.setTransactionManager(null); // Explicitly null

        ApiException txEx = assertThrows(ApiException.class, unmanagedMetrics::reserveDailyQuota);
        assertEquals(HttpStatus.SERVICE_UNAVAILABLE, txEx.status());
        assertEquals("AI_QUOTA_TRANSACTION_UNAVAILABLE", txEx.code());

        // Case 2: Missing database / meta repository
        AiMetrics unbackedMetrics = new AiMetrics(100);
        unbackedMetrics.setMetaRepository(null); // Explicitly null
        unbackedMetrics.setTransactionManager(txManager);

        ApiException dbEx = assertThrows(ApiException.class, unbackedMetrics::reserveDailyQuota);
        assertEquals(HttpStatus.SERVICE_UNAVAILABLE, dbEx.status());
        assertEquals("AI_QUOTA_STORAGE_UNAVAILABLE", dbEx.code());
    }

    @Test
    @DisplayName("Missing ai_quota_mutex row fails closed with HTTP 503")
    void missingMutexRowFailsClosed() {
        AiMetrics testMetrics = new AiMetrics(100);
        testMetrics.setMetaRepository(meta);
        testMetrics.setTransactionManager(txManager);

        // Delete the mutex row
        meta.deleteById(AiMetrics.QUOTA_MUTEX_KEY);

        ApiException mutexEx = assertThrows(ApiException.class, testMetrics::reserveDailyQuota);
        assertEquals(HttpStatus.SERVICE_UNAVAILABLE, mutexEx.status());
        assertEquals("AI_QUOTA_MUTEX_MISSING", mutexEx.code());

        // Restore mutex row for subsequent tests
        meta.saveAndFlush(new AppMeta(AiMetrics.QUOTA_MUTEX_KEY, "0"));
    }

    @Test
    @DisplayName("Request reaching the limit is accepted and next request is rejected before AI provider is called")
    void requestReachingLimitHandledCorrectlyAndNextRejectedBeforeProvider() {
        metrics.setDailyLimit(3);

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

        // Crucial verification: providerCalls remains exactly 3 (never invoked)
        assertEquals(3, providerCalls.get(), "Provider must not be called when quota is exceeded");
    }

    @Test
    @DisplayName("Every accepted request is counted exactly once, even if provider throws an error or stream cancels")
    void everyAcceptedRequestCountedExactlyOnceEvenOnFailureOrStreamCancellation() {
        metrics.setDailyLimit(10);
        long initialCount = metrics.getTodayRequests();

        // 1. Upstream 500 error
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

        // 2. Stream cancellation / error
        assertThrows(Exception.class, () -> service.stream(
                new AiRequest(AiTask.TUTOR, "Topic", "Stream question", "Beginner", "English"),
                chunk -> {}
        ));

        // Quota was reserved upfront, so it increments by another exactly 1 (initialCount + 2)
        assertEquals(initialCount + 2, metrics.getTodayRequests(), "Stream reservation must be counted once even on provider stream failure");
    }

    @Test
    @DisplayName("Admin snapshot reports shared persisted count and is not inflated by stale local state")
    void adminSnapshotReportsSharedPersistedCountNotStaleLocalState() {
        AiMetrics instanceA = new AiMetrics(50);
        instanceA.setMetaRepository(meta);
        instanceA.setTransactionManager(txManager);

        AiMetrics instanceB = new AiMetrics(50);
        instanceB.setMetaRepository(meta);
        instanceB.setTransactionManager(txManager);

        // Instance A handles 3 reservations
        instanceA.reserveDailyQuota();
        instanceA.reserveDailyQuota();
        instanceA.reserveDailyQuota();

        // Instance B handles 4 reservations
        instanceB.reserveDailyQuota();
        instanceB.reserveDailyQuota();
        instanceB.reserveDailyQuota();
        instanceB.reserveDailyQuota();

        // Both instances' snapshots must report exactly 7 todayRequests
        var snapA = instanceA.snapshot();
        @SuppressWarnings("unchecked")
        var quotaA = (java.util.Map<String, Object>) snapA.get("dailyQuota");
        assertEquals(7L, quotaA.get("todayRequests"), "Instance A snapshot must report 7");

        var snapB = instanceB.snapshot();
        @SuppressWarnings("unchecked")
        var quotaB = (java.util.Map<String, Object>) snapB.get("dailyQuota");
        assertEquals(7L, quotaB.get("todayRequests"), "Instance B snapshot must report 7");
    }
}
