package com.aitutor.service;

import com.aitutor.controller.ApiException;
import com.aitutor.entity.User;
import com.aitutor.repository.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;

import java.time.LocalDateTime;
import java.util.Objects;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.when;

class EmailVerificationServiceTest {
    private UserRepository users;
    private MailService mail;
    private EmailVerificationService service;
    private User user;

    @BeforeEach
    void setUp() {
        users = Mockito.mock(UserRepository.class);
        mail = Mockito.mock(MailService.class);
        when(mail.isConfigured()).thenReturn(true);
        when(mail.verificationEmail(any(), anyString(), anyInt())).thenReturn("<html>verify</html>");
        when(mail.passwordResetEmail(any(), anyString(), anyInt())).thenReturn("<html>reset</html>");
        when(mail.sendHtml(anyString(), anyString(), anyString())).thenReturn(true);
        service = new EmailVerificationService(users, mail, "https://novatutor.test");
        user = new User("Asha", "asha@example.com", "hash");
        when(users.save(any(User.class))).thenAnswer(inv -> inv.getArgument(0));
        when(users.findByVerificationTokenHash(anyString())).thenAnswer(inv ->
                Objects.equals(inv.getArgument(0), user.getVerificationTokenHash())
                        ? Optional.of(user) : Optional.empty());
        when(users.findByResetTokenHash(anyString())).thenAnswer(inv ->
                Objects.equals(inv.getArgument(0), user.getResetTokenHash())
                        ? Optional.of(user) : Optional.empty());
    }

    @Test
    void storesOnlyAHashAndConsumesTheTokenOnce() {
        String token = service.createVerificationToken(user);
        assertNotEquals(token, user.getVerificationTokenHash());
        assertEquals(64, user.getVerificationTokenHash().length());
        assertFalse(user.isEmailVerified());

        assertEquals(EmailVerificationService.VerificationResult.VERIFIED, service.verify(token));
        assertTrue(user.isEmailVerified());
        assertNull(user.getVerificationTokenHash());
        assertNull(user.getVerificationExpiresAt());

        // The same link cannot verify twice: the hash is gone.
        assertEquals(EmailVerificationService.VerificationResult.INVALID, service.verify(token));
    }

    @Test
    void rejectsExpiredVerificationLink() {
        String token = service.createVerificationToken(user);
        user.setVerificationExpiresAt(LocalDateTime.now().minusMinutes(1));
        assertEquals(EmailVerificationService.VerificationResult.EXPIRED, service.verify(token));
        assertFalse(user.isEmailVerified());
        assertNull(user.getVerificationTokenHash());
    }

    @Test
    void rejectsUnknownAndBlankTokens() {
        assertEquals(EmailVerificationService.VerificationResult.INVALID, service.verify("not-a-real-token"));
        assertEquals(EmailVerificationService.VerificationResult.INVALID, service.verify("  "));
    }

    @Test
    void resendIsRateLimitedInsideTheCooldownWindow() {
        EmailVerificationService.Issue first = service.issueVerification(user, true);
        assertTrue(first.sent());
        EmailVerificationService.Issue second = service.issueVerification(user, true);
        assertTrue(second.rateLimited());
        assertFalse(second.sent());
    }

    @Test
    void missingSmtpDoesNotMintATokenOrStartACooldown() {
        when(mail.isConfigured()).thenReturn(false);
        EmailVerificationService.Issue issue = service.issueVerification(user, true);
        assertFalse(issue.sent());
        assertFalse(issue.configured());
        assertFalse(issue.rateLimited());
        assertNull(user.getVerificationTokenHash());
        assertNull(user.getVerificationSentAt());
    }

    @Test
    void resetTokenIsSingleUseAndExpires() {
        String token = service.createResetToken(user);
        assertNotEquals(token, user.getResetTokenHash());
        assertNotNull(service.consumeResetToken(token, "newpassword"));

        // Clearing the hash (what a successful reset does) invalidates the link.
        service.clearResetToken(user);
        ApiException error = assertThrows(ApiException.class, () -> service.consumeResetToken(token, "newpassword"));
        assertEquals("INVALID_RESET_TOKEN", error.code());
    }

    @Test
    void expiredResetTokenIsRejectedAndCleared() {
        String token = service.createResetToken(user);
        user.setResetExpiresAt(LocalDateTime.now().minusSeconds(1));
        ApiException error = assertThrows(ApiException.class, () -> service.consumeResetToken(token, "newpassword"));
        assertEquals("EXPIRED_RESET_TOKEN", error.code());
        assertNull(user.getResetTokenHash());
    }

    @Test
    void weakResetPasswordIsRejectedBeforeTouchingTheToken() {
        String token = service.createResetToken(user);
        ApiException error = assertThrows(ApiException.class, () -> service.consumeResetToken(token, "123"));
        assertEquals("WEAK_PASSWORD", error.code());
        assertNotNull(user.getResetTokenHash());
    }

    @Test
    void pendingRegistrationBindsPasswordToVerificationTokenAgainstOverwriteAttack() {
        var pendingRepo = Mockito.mock(com.aitutor.repository.PendingRegistrationRepository.class);
        var pendingStore = new java.util.ArrayList<com.aitutor.entity.PendingRegistration>();
        when(pendingRepo.save(any(com.aitutor.entity.PendingRegistration.class))).thenAnswer(inv -> {
            var p = inv.getArgument(0, com.aitutor.entity.PendingRegistration.class);
            pendingStore.remove(p);
            pendingStore.add(p);
            return p;
        });
        when(pendingRepo.findByEmailOrderByCreatedAtDesc(anyString())).thenAnswer(inv -> {
            String em = inv.getArgument(0, String.class);
            return pendingStore.stream().filter(p -> p.getEmail().equals(em)).toList();
        });
        when(pendingRepo.findByTokenHash(anyString())).thenAnswer(inv -> {
            String h = inv.getArgument(0, String.class);
            return pendingStore.stream().filter(p -> p.getTokenHash().equals(h)).findFirst();
        });
        Mockito.doAnswer(inv -> {
            String em = inv.getArgument(0, String.class);
            pendingStore.removeIf(p -> p.getEmail().equals(em));
            return null;
        }).when(pendingRepo).deleteByEmail(anyString());

        var capturedLinks = new java.util.ArrayList<String>();
        when(mail.verificationEmail(any(), anyString(), anyInt())).thenAnswer(inv -> {
            capturedLinks.add(inv.getArgument(1, String.class));
            return "<html>verify</html>";
        });

        var materialized = new java.util.concurrent.atomic.AtomicReference<User>();
        var authService = Mockito.mock(AuthService.class);
        when(authService.completeVerifiedRegistration(anyString(), anyString(), anyString())).thenAnswer(inv -> {
            if (materialized.get() != null) {
                return new AuthService.RegistrationCompletion(materialized.get(), true);
            }
            User created = new User(inv.getArgument(0), inv.getArgument(1), inv.getArgument(2));
            created.setEmailVerified(true);
            materialized.set(created);
            return new AuthService.RegistrationCompletion(created, false);
        });

        var svc = new EmailVerificationService(users, pendingRepo, authService, mail, "https://novatutor.test");

        // 1. Victim registers first
        assertTrue(svc.issuePendingRegistration(new AuthService.PendingDraft("Victim", "victim@example.com", "victim-bcrypt-hash")).sent());
        // 2. Attacker registers same email with attacker password
        assertTrue(svc.issuePendingRegistration(new AuthService.PendingDraft("Attacker", "victim@example.com", "attacker-bcrypt-hash")).sent());
        assertEquals(2, capturedLinks.size());

        // 3. Resend refuses to arbitrarily pick one when competing pending rows exist
        assertFalse(svc.resendVerification("victim@example.com").sent());

        // 4. Victim clicks Email #1
        String victimToken = capturedLinks.get(0).substring(capturedLinks.get(0).indexOf("token=") + 6);
        String attackerToken = capturedLinks.get(1).substring(capturedLinks.get(1).indexOf("token=") + 6);
        assertEquals(EmailVerificationService.VerificationResult.VERIFIED, svc.verify(victimToken));
        assertNotNull(materialized.get());
        assertEquals("Victim", materialized.get().getName());
        assertEquals("victim-bcrypt-hash", materialized.get().getPassword());

        // 5. Attacker's token was purged and cannot replay
        assertEquals(EmailVerificationService.VerificationResult.INVALID, svc.verify(attackerToken));
    }

    @Test
    void passwordResetSkipsGuestsAndEnforcesCooldown() {
        User guest = new User("Guest", "guest-1@guest.novatutor.local", "hash");
        guest.setRole("GUEST");
        when(users.findByEmail("guest-1@guest.novatutor.local")).thenReturn(Optional.of(guest));
        assertFalse(service.requestPasswordReset("guest-1@guest.novatutor.local"));

        when(users.findByEmail("asha@example.com")).thenReturn(Optional.of(user));
        assertTrue(service.requestPasswordReset("asha@example.com"));
        // Immediate second request inside 60s cooldown must be suppressed
        assertFalse(service.requestPasswordReset("asha@example.com"));
    }
}
