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
}
