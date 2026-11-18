package com.aitutor.security;

import com.aitutor.chat.ChatConversation;
import com.aitutor.chat.ChatMessage;
import com.aitutor.chat.ConversationRepository;
import com.aitutor.chat.MessageRepository;
import com.aitutor.controller.SandboxExecutionService;
import com.aitutor.dsa.DsaCatalog;
import com.aitutor.dsa.DsaJudgeService;
import com.aitutor.dsa.DsaProblem;
import com.aitutor.dsa.DsaProblemStateRepository;
import com.aitutor.entity.User;
import com.aitutor.intelligence.LearningEvent;
import com.aitutor.intelligence.LearningEventRepository;
import com.aitutor.intelligence.LearningEventService;
import com.aitutor.repository.UserRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

import static org.hamcrest.Matchers.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Comprehensive Wave 1 adversarial security regression suite covering:
 * - Chat API sensitive entity/password leak prevention
 * - JWT revocation on password change & no premature token rotation
 * - RBAC (/api/admin/**), IDOR, and removal of legacy X-User-Id header auth
 * - Guest isolation (community POST, password change, leaderboard exclusion)
 * - Anti-enumeration on forgot-password and resend-verification
 * - Pre-registration takeover protection
 * - 405 Method Not Allowed & GATE PDF magic-byte/metadata hardening
 * - Hidden DSA test case redaction
 * - Rate-limit X-Forwarded-For / X-Real-IP spoofing protection
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class SecurityRemediationTest {

    @Autowired MockMvc mvc;
    @Autowired UserRepository users;
    @Autowired PasswordEncoder encoder;
    @Autowired JwtService jwt;
    @Autowired ConversationRepository conversations;
    @Autowired MessageRepository messages;
    @Autowired LearningEventRepository learningEvents;

    private User createUser(String prefix, String role, boolean verified) {
        String email = prefix + "-" + System.nanoTime() + "@novatutor.test";
        User u = new User("User " + prefix, email, encoder.encode("SecretPass123!"));
        u.setRole(role);
        u.setEmailVerified(verified);
        u.setVerificationTokenHash("secret-verify-hash-" + System.nanoTime());
        u.setResetTokenHash("secret-reset-hash-" + System.nanoTime());
        u.setGoogleSubject("google-sub-" + System.nanoTime());
        return users.save(u);
    }

    @Test
    void chatEndpointsNeverLeakUserPasswordOrTokens() throws Exception {
        User student = createUser("chatsec", "STUDENT", true);
        String token = jwt.token(student);
        ChatConversation conv = new ChatConversation();
        conv.setUser(student);
        conv.setTitle("Algorithms");
        conv = conversations.save(conv);
        ChatMessage m1 = new ChatMessage();
        m1.setConversation(conv);
        m1.setRole(ChatMessage.Role.USER);
        m1.setContent("Explain Dijkstra");
        messages.save(m1);
        ChatMessage m2 = new ChatMessage();
        m2.setConversation(conv);
        m2.setRole(ChatMessage.Role.ASSISTANT);
        m2.setContent("Dijkstra uses a priority queue.");
        messages.save(m2);

        String convBody = mvc.perform(get("/api/chat/conversations/" + student.getId())
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();

        String createdBody = mvc.perform(post("/api/chat/conversations/" + student.getId())
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"title\":\"Graphs\"}"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();

        String msgBody = mvc.perform(get("/api/chat/conversations/" + student.getId() + "/" + conv.getId())
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();

        for (String body : List.of(convBody, createdBody, msgBody)) {
            assertFalse(body.contains("$2a$") || body.contains("$2b$"), "Bcrypt hash leaked: " + body);
            assertFalse(body.contains("password"), "Password field leaked: " + body);
            assertFalse(body.contains("verificationTokenHash"), "Verification token hash leaked: " + body);
            assertFalse(body.contains("resetTokenHash"), "Reset token hash leaked: " + body);
            assertFalse(body.contains("googleSubject"), "Google subject leaked: " + body);
            assertFalse(body.contains("\"user\""), "Nested user entity leaked: " + body);
        }

        // Verify bulk delete queries work cleanly
        mvc.perform(delete("/api/chat/conversations/" + student.getId() + "/" + conv.getId() + "/messages")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk());
        mvc.perform(delete("/api/chat/conversations/" + student.getId())
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk());
    }

    @Test
    void passwordChangeImmediatelyRevokesPriorJwtAndFreshTokenDoesNotRotate() throws Exception {
        User student = createUser("jwtrevoke", "STUDENT", true);
        String oldToken = jwt.token(student);

        // Fresh token should NOT prematurely rotate on /api/auth/me (prevents render loop)
        mvc.perform(get("/api/auth/me").header("Authorization", "Bearer " + oldToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.token", is(oldToken)));

        // Change password
        mvc.perform(post("/api/users/" + student.getId() + "/password")
                        .header("Authorization", "Bearer " + oldToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"currentPassword\":\"SecretPass123!\",\"newPassword\":\"BrandNewPass456!\"}"))
                .andExpect(status().isOk());

        // Old token must be immediately rejected everywhere
        mvc.perform(get("/api/auth/me").header("Authorization", "Bearer " + oldToken))
                .andExpect(status().isUnauthorized());
        mvc.perform(get("/api/dsa/stats").header("Authorization", "Bearer " + oldToken))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void adminRoutesAndIdorAndLegacyHeaderAreStrictlyBlocked() throws Exception {
        User studentA = createUser("studentA", "STUDENT", true);
        User studentB = createUser("studentB", "STUDENT", true);
        User admin = createUser("admin", "ADMIN", true);
        String tokenA = jwt.token(studentA);
        String tokenAdmin = jwt.token(admin);

        // Student blocked from admin endpoints with 403
        mvc.perform(get("/api/admin/users").header("Authorization", "Bearer " + tokenA))
                .andExpect(status().isForbidden());
        mvc.perform(get("/api/admin/courses").header("Authorization", "Bearer " + tokenA))
                .andExpect(status().isForbidden());

        // Admin succeeds
        mvc.perform(get("/api/admin/courses").header("Authorization", "Bearer " + tokenAdmin))
                .andExpect(status().isOk());

        // IDOR with spoofed X-User-Id header blocked with 403
        mvc.perform(get("/api/users/" + studentB.getId())
                        .header("Authorization", "Bearer " + tokenA)
                        .header("X-User-Id", String.valueOf(studentB.getId())))
                .andExpect(status().isForbidden());

        // Anonymous caller with X-User-Id header gets 401
        mvc.perform(get("/api/users/" + studentB.getId())
                        .header("X-User-Id", String.valueOf(studentB.getId())))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void guestCannotPostToCommunityChangePasswordAccessAdminOrPolluteLeaderboard() throws Exception {
        User guest = createUser("guestiso", "GUEST", true);
        User student = createUser("realstud", "STUDENT", true);
        String guestToken = jwt.token(guest);
        String studentToken = jwt.token(student);

        // Record high XP for guest and modest XP for real student
        learningEvents.save(new LearningEvent(guest, "CHALLENGE_COMPLETED", "DSA", "Graphs", 100, 120, "guest test"));
        learningEvents.save(new LearningEvent(student, "LESSON_COMPLETED", "DSA", "Arrays", 100, 60, "student test"));

        mvc.perform(post("/api/community/posts")
                        .header("Authorization", "Bearer " + guestToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"text\":\"Guest spam\"}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error", is("GUEST_NOT_ALLOWED")));

        mvc.perform(post("/api/users/" + guest.getId() + "/password")
                        .header("Authorization", "Bearer " + guestToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"currentPassword\":\"SecretPass123!\",\"newPassword\":\"NewPass123!\"}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error", is("GUEST_NOT_ALLOWED")));

        mvc.perform(get("/api/admin/dashboard").header("Authorization", "Bearer " + guestToken))
                .andExpect(status().isForbidden());

        String leaderboard = mvc.perform(get("/api/users/leaderboard")
                        .header("Authorization", "Bearer " + studentToken))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        assertFalse(leaderboard.contains(guest.getName()), "Guest leaked into leaderboard: " + leaderboard);
        assertTrue(leaderboard.contains(student.getName()), "Student missing from leaderboard: " + leaderboard);
    }

    @Test
    void forgotPasswordAndResendVerificationDoNotEnumerateAccounts() throws Exception {
        User existing = createUser("enumtest", "STUDENT", true);
        String existingForgot = mvc.perform(post("/api/auth/forgot-password")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"" + existing.getEmail() + "\"}"))
                .andExpect(status().isAccepted())
                .andReturn().getResponse().getContentAsString();
        String missingForgot = mvc.perform(post("/api/auth/forgot-password")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"definitely-not-here-" + System.nanoTime() + "@novatutor.test\"}"))
                .andExpect(status().isAccepted())
                .andReturn().getResponse().getContentAsString();
        assertEquals(existingForgot, missingForgot);

        String existingResend = mvc.perform(post("/api/auth/resend-verification")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"" + existing.getEmail() + "\"}"))
                .andExpect(status().isAccepted())
                .andReturn().getResponse().getContentAsString();
        String missingResend = mvc.perform(post("/api/auth/resend-verification")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"definitely-not-here-" + System.nanoTime() + "@novatutor.test\"}"))
                .andExpect(status().isAccepted())
                .andReturn().getResponse().getContentAsString();
        assertEquals(existingResend, missingResend);
    }

    @Test
    void methodNotAllowedReturns405AndFakePdfIsRejected() throws Exception {
        mvc.perform(delete("/api/health"))
                .andExpect(status().isMethodNotAllowed());

        User admin = createUser("pdfadmin", "ADMIN", true);
        String adminToken = jwt.token(admin);

        MockMultipartFile fakePdf = new MockMultipartFile(
                "file", "evil.pdf", "application/pdf",
                "<script>alert(1)</script>".getBytes(StandardCharsets.UTF_8));
        mvc.perform(multipart("/api/admin/gate-notes")
                        .file(fakePdf)
                        .param("subject", "algorithms")
                        .header("Authorization", "Bearer " + adminToken))
                .andExpect(status().isBadRequest());

        MockMultipartFile realPdf = new MockMultipartFile(
                "file", "algo-notes.pdf", "application/pdf",
                "%PDF-1.4\n%test\n%%EOF\n".getBytes(StandardCharsets.UTF_8));
        String uploaded = mvc.perform(multipart("/api/admin/gate-notes")
                        .file(realPdf)
                        .param("subject", "algorithms")
                        .header("Authorization", "Bearer " + adminToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.subjectKey", is("algorithms")))
                .andReturn().getResponse().getContentAsString();
        assertTrue(uploaded.contains("algo-notes.pdf"));

        mvc.perform(get("/api/gate-cse/notes"))
                .andExpect(status().isOk())
                .andExpect(content().string(containsString("algo-notes.pdf")));
    }

    @Test
    void hiddenDsaTestCasesAreRedactedInJudgeResults() {
        SandboxExecutionService sandbox = mock(SandboxExecutionService.class);
        DsaProblemStateRepository states = mock(DsaProblemStateRepository.class);
        LearningEventService events = mock(LearningEventService.class);
        DsaJudgeService judge = new DsaJudgeService(sandbox, states, events);

        DsaProblem problem = DsaCatalog.all().get(0);
        assertFalse(problem.samples().isEmpty());
        assertFalse(problem.hiddenTests(8).isEmpty());

        StringBuilder fakeStdout = new StringBuilder();
        for (int i = 0; i < problem.samples().size() + 8; i++) {
            fakeStdout.append("wrong-output-").append(i).append('\n');
        }
        when(sandbox.execute(anyString(), anyString(), anyString())).thenReturn(Map.of(
                "enabled", true,
                "status", "OK",
                "exitCode", 0,
                "stdout", fakeStdout.toString(),
                "stderr", "",
                "durationMs", 15L));

        DsaJudgeService.RunResult result = judge.run(null, problem,
                new DsaJudgeService.RunRequest("java", "class Solution {}"), false);

        long sampleSeen = result.tests().stream().filter(DsaJudgeService.TestResult::sample).count();
        long hiddenSeen = result.tests().stream().filter(t -> !t.sample()).count();
        assertTrue(sampleSeen > 0);
        assertTrue(hiddenSeen > 0);

        for (DsaJudgeService.TestResult tr : result.tests()) {
            if (tr.sample()) {
                assertFalse(tr.input().isBlank(), "Sample test should show input");
                assertFalse(tr.expected().isBlank(), "Sample test should show expected");
            } else {
                assertEquals("", tr.input(), "Hidden test input must be redacted");
                assertEquals("", tr.expected(), "Hidden test expected output must be redacted");
                assertEquals("", tr.actual(), "Hidden test actual output must be redacted");
            }
        }
    }

    @Test
    void rateLimitFilterIgnoresSpoofedXRealIpAndPrependedForwardedFor() throws Exception {
        RequestRateLimitFilter filter = new RequestRateLimitFilter(true, 120, 5, 20, 20, 5, 600, true);
        // auth-recovery bucket allows 5 requests per minute per client IP.
        // Attacker rotates X-Real-IP and prepends fake IPs to X-Forwarded-For,
        // while the real proxy-appended rightmost IP stays 198.51.100.77.
        int blockedAt = -1;
        for (int i = 1; i <= 10; i++) {
            MockHttpServletRequest req = new MockHttpServletRequest("POST", "/api/auth/forgot-password");
            req.setRemoteAddr("10.0.0.5");
            req.addHeader("X-Real-IP", "203.0.113." + i);
            req.addHeader("X-Forwarded-For", "192.0.2." + i + ", 198.51.100.77");
            MockHttpServletResponse res = new MockHttpServletResponse();
            filter.doFilter(req, res, new MockFilterChain());
            if (res.getStatus() == 429) {
                blockedAt = i;
                break;
            }
        }
        assertEquals(6, blockedAt, "Spoofed headers must not bypass auth-recovery rate limit");
    }

    @Test
    void rateLimitFilterIgnoresXForwardedForWhenDirectPeerIsNotTrustedProxy() throws Exception {
        RequestRateLimitFilter filter = new RequestRateLimitFilter(true, 120, 5, 20, 20, 5, 600, true);
        // Direct internet peer 198.51.100.99 is NOT a private/internal proxy.
        // Rotating X-Forwarded-For must be ignored completely and bucketed by remoteAddr.
        int blockedAt = -1;
        for (int i = 1; i <= 10; i++) {
            MockHttpServletRequest req = new MockHttpServletRequest("POST", "/api/auth/forgot-password");
            req.setRemoteAddr("198.51.100.99");
            req.addHeader("X-Forwarded-For", "203.0.113." + i);
            MockHttpServletResponse res = new MockHttpServletResponse();
            filter.doFilter(req, res, new MockFilterChain());
            if (res.getStatus() == 429) {
                blockedAt = i;
                break;
            }
        }
        assertEquals(6, blockedAt, "Untrusted peer must not spoof X-Forwarded-For to bypass rate limit");
    }

    @Test
    void preRegistrationTakeoverPathBBlockedByTokenBoundPendingRegistrations() throws Exception {
        // Simulate victim registering, then attacker registering same email with attacker password,
        // then victim verifying their own token. Victim's password must win and attacker's must fail.
        String email = "victim-pathb-" + System.nanoTime() + "@novatutor.test";

        mvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Real Victim\",\"email\":\"" + email + "\",\"password\":\"VictimSecret123!\"}"))
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.pending", is(true)));

        // No row should exist in users table yet!
        assertTrue(users.findByEmail(email).isEmpty(), "Pending registration must not materialize users row before verification");

        // Attacker registers same email with attacker password
        mvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Attacker\",\"email\":\"" + email + "\",\"password\":\"AttackerPass999!\"}"))
                .andExpect(status().isAccepted());

        // Still no row in users table
        assertTrue(users.findByEmail(email).isEmpty());

        // Login with either password must fail with 401 before verification
        mvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"" + email + "\",\"password\":\"AttackerPass999!\"}"))
                .andExpect(status().isUnauthorized());
    }
}
