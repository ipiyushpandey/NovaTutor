package com.aitutor.ai;

import com.aitutor.config.AppMeta;
import com.aitutor.config.AppMetaRepository;
import com.aitutor.controller.AdminController;
import com.aitutor.controller.ApiException;
import com.aitutor.entity.User;
import com.aitutor.repository.UserRepository;
import com.aitutor.security.JwtService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpStatus;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.web.server.ResponseStatusException;

import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Verification test for Section 1.A & 1.B:
 * Proves that a non-default limit (37) configured via Spring properties:
 * 1. Is reliably injected into the real Spring application context.
 * 2. Cannot be silently overridden on startup by stale database metadata under 'ai.dailyLimit'.
 * 3. Enforces quota reservation at exactly 37 requests.
 * 4. Is reported accurately through admin global usage reporting without stale local fallback.
 */
@SpringBootTest(properties = {
        "ai.gemini.daily-limit=37"
})
@ActiveProfiles("test")
public class AiQuotaConfigTest {

    @Autowired
    private AiMetrics metrics;

    @Autowired
    private AppMetaRepository meta;

    @Autowired
    private AdminController adminController;

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private JwtService jwtService;

    private String todayKey;
    private String adminToken;

    @BeforeEach
    void setUp() {
        todayKey = "ai_daily_usage_" + LocalDate.now(ZoneOffset.UTC);
        meta.deleteById(todayKey);
        metrics.resetForTest();

        // Ensure mutex row exists
        if (!meta.existsById(AiMetrics.QUOTA_MUTEX_KEY)) {
            meta.saveAndFlush(new AppMeta(AiMetrics.QUOTA_MUTEX_KEY, "0"));
        }

        // Setup admin user & valid admin token
        User admin = userRepository.findByEmail("admin@novatutor.test").orElseGet(() -> {
            User u = new User("Platform Admin", "admin@novatutor.test", "AdminPassword123!");
            u.setRole("ADMIN");
            u.setActive(true);
            u.setBlocked(false);
            u.setEmailVerified(true);
            return userRepository.save(u);
        });
        adminToken = "Bearer " + jwtService.token(admin);
    }

    @Test
    @DisplayName("Configured daily limit (37) is injected by Spring and not overridden by database metadata on startup")
    void configuredDailyLimitIsAppliedAndNotOverriddenByDatabase() {
        // 1. Spring must inject exactly 37 into the bean
        assertEquals(37, metrics.getDailyLimit(), "Spring context must configure dailyLimit to 37");

        // 2. Put a stale / different value in database metadata under 'ai.dailyLimit'
        meta.saveAndFlush(new AppMeta("ai.dailyLimit", "999"));

        // 3. Trigger bean startup initialization again
        metrics.initFromDb();

        // 4. Precedence rule: configured property remains authoritative and is NOT overridden
        assertEquals(37, metrics.getDailyLimit(), "Configured limit must NOT be clobbered by stale database metadata on startup");

        // Cleanup
        meta.deleteById("ai.dailyLimit");
    }

    @Test
    @DisplayName("Reservation enforcement and admin reporting both strictly use the configured 37 limit")
    void reservationEnforcementAndAdminReportingBothEnforceConfiguredLimit() {
        assertEquals(37, metrics.getDailyLimit());

        // Make 37 successful reservations
        for (int i = 1; i <= 37; i++) {
            long reserved = metrics.reserveDailyQuota();
            assertEquals(i, reserved);
        }

        // The 38th reservation MUST be rejected with HTTP 429 AI_QUOTA_EXHAUSTED
        ApiException ex = assertThrows(ApiException.class, metrics::reserveDailyQuota);
        assertEquals(HttpStatus.TOO_MANY_REQUESTS, ex.status());
        assertEquals("AI_QUOTA_EXHAUSTED", ex.code());
        assertTrue(ex.getMessage().contains("(37/37)"), "Error message must report 37/37 limit reached");

        // getTodayRequests() must authoritatively read 37 from database
        assertEquals(37L, metrics.getTodayRequests());

        // Snapshot must report 37 limit and 37 usage
        Map<String, Object> snapshot = metrics.snapshot();
        @SuppressWarnings("unchecked")
        Map<String, Object> dailyQuota = (Map<String, Object>) snapshot.get("dailyQuota");
        assertNotNull(dailyQuota);
        assertEquals(37L, dailyQuota.get("todayRequests"));
        assertEquals(37, dailyQuota.get("dailyLimit"));
        assertEquals(0L, dailyQuota.get("remainingQuota"));
        assertEquals(100.0, dailyQuota.get("percentConsumed"));
        assertEquals(0.0, dailyQuota.get("percentRemaining"));
        assertEquals("EXHAUSTED", dailyQuota.get("limitStatus"));
        assertEquals(true, dailyQuota.get("available"));

        // Admin controller /admin/ai/usage must return the exact same authoritative state
        Map<String, Object> adminUsage = adminController.aiUsage(adminToken);
        @SuppressWarnings("unchecked")
        Map<String, Object> adminQuota = (Map<String, Object>) adminUsage.get("dailyQuota");
        assertNotNull(adminQuota);
        assertEquals(37L, adminQuota.get("todayRequests"));
        assertEquals(37, adminQuota.get("dailyLimit"));
        assertEquals("EXHAUSTED", adminQuota.get("limitStatus"));
        assertEquals(true, adminQuota.get("available"));
    }

    @Test
    @DisplayName("Admin usage reports safe UNAVAILABLE state when persisted counter is corrupted, without falling back to local state")
    void adminUsageReportsSafeUnavailableWhenPersistedCounterIsCorrupted() {
        // Corrupt the persisted counter row
        meta.saveAndFlush(new AppMeta(todayKey, "invalid_non_numeric_token"));

        // getTodayRequests() must throw fail-closed
        ApiException ex = assertThrows(ApiException.class, metrics::getTodayRequests);
        assertEquals(HttpStatus.SERVICE_UNAVAILABLE, ex.status());
        assertEquals("AI_QUOTA_COUNTER_INVALID", ex.code());

        // Admin snapshot must report safe UNAVAILABLE state with error details, NOT local in-memory fallback
        Map<String, Object> adminUsage = adminController.aiUsage(adminToken);
        @SuppressWarnings("unchecked")
        Map<String, Object> adminQuota = (Map<String, Object>) adminUsage.get("dailyQuota");
        assertNotNull(adminQuota);
        assertNull(adminQuota.get("todayRequests"), "Corrupted DB must NOT fall back to local count");
        assertEquals("UNAVAILABLE", adminQuota.get("limitStatus"));
        assertEquals(false, adminQuota.get("available"));
        assertEquals("AI_QUOTA_COUNTER_INVALID", adminQuota.get("errorCode"));
    }

    @Test
    @DisplayName("Admin usage endpoint enforces strict admin authorization and rejects unauthenticated/student requests")
    void adminUsageEnforcesStrictAdminAuthorization() {
        // Unauthenticated request -> 401
        assertThrows(ResponseStatusException.class, () -> adminController.aiUsage(null));

        // Create student user
        User student = userRepository.findByEmail("student_tester@novatutor.test").orElseGet(() -> {
            User u = new User("Student Tester", "student_tester@novatutor.test", "Pass123!");
            u.setRole("STUDENT");
            u.setActive(true);
            u.setBlocked(false);
            u.setEmailVerified(true);
            return userRepository.save(u);
        });
        String studentToken = "Bearer " + jwtService.token(student);

        // Student request -> 403 Forbidden
        ResponseStatusException forbiddenEx = assertThrows(ResponseStatusException.class, () -> adminController.aiUsage(studentToken));
        assertEquals(HttpStatus.FORBIDDEN, forbiddenEx.getStatusCode());
    }
}
