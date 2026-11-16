package com.aitutor.service;

import com.aitutor.controller.ApiException;
import com.aitutor.entity.User;
import com.aitutor.repository.UserRepository;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.LocalDateTime;
import java.util.Base64;
import java.util.HexFormat;
import java.util.Optional;

/**
 * Owns the lifecycle of single-use, expiring email tokens.
 *
 * Only a SHA-256 hash of each token is persisted. The raw token exists in
 * memory just long enough to build the emailed link, so a database dump cannot
 * be replayed to verify an account or reset a password.
 */
@Service
public class EmailVerificationService {
    public static final int VERIFICATION_HOURS = 24;
    public static final int RESET_MINUTES = 30;
    private static final Duration RESEND_COOLDOWN = Duration.ofSeconds(60);

    private final UserRepository users;
    private final MailService mail;
    private final String publicUrl;
    private final SecureRandom random = new SecureRandom();

    public EmailVerificationService(UserRepository users, MailService mail,
                                    @Value("${app.public-url:https://novatutor.onrender.com}") String publicUrl) {
        this.users = users;
        this.mail = mail;
        this.publicUrl = (publicUrl == null || publicUrl.isBlank()) ? "https://novatutor.onrender.com" : publicUrl.trim().replaceAll("/+$", "");
    }

    public record Issue(boolean sent, boolean configured, boolean rateLimited) {}
    public enum VerificationResult { VERIFIED, ALREADY_VERIFIED, INVALID, EXPIRED }

    public Issue issueVerification(User user, boolean enforceCooldown) {
        if (user.isEmailVerified()) return new Issue(false, mail.isConfigured(), false);
        // Without a delivery channel, do not mint a token or start the resend
        // cooldown: the previous link stays valid and the caller can honestly
        // report that no email was sent.
        if (!mail.isConfigured()) return new Issue(false, false, false);
        LocalDateTime now = LocalDateTime.now();
        if (enforceCooldown && user.getVerificationSentAt() != null
                && user.getVerificationSentAt().plus(RESEND_COOLDOWN).isAfter(now)) {
            return new Issue(false, mail.isConfigured(), true);
        }
        String token = createVerificationToken(user);
        String link = publicUrl + "/#/verify-email?token=" + token;
        boolean sent = mail.sendHtml(user.getEmail(), "Verify your NovaTutor email",
                mail.verificationEmail(user.getName(), link, VERIFICATION_HOURS));
        return new Issue(sent, mail.isConfigured(), false);
    }

    /** Persists a fresh single-use verification token and returns the raw value for the email link. */
    String createVerificationToken(User user) {
        String token = newToken();
        user.setVerificationTokenHash(hash(token));
        user.setVerificationExpiresAt(LocalDateTime.now().plusHours(VERIFICATION_HOURS));
        user.setVerificationSentAt(LocalDateTime.now());
        users.save(user);
        return token;
    }

    public VerificationResult verify(String token) {
        if (token == null || token.isBlank()) return VerificationResult.INVALID;
        Optional<User> found = users.findByVerificationTokenHash(hash(token.trim()));
        if (found.isEmpty()) return VerificationResult.INVALID;
        User user = found.get();
        LocalDateTime expiry = user.getVerificationExpiresAt();
        if (expiry == null || expiry.isBefore(LocalDateTime.now())) {
            user.setVerificationTokenHash(null);
            user.setVerificationExpiresAt(null);
            users.save(user);
            return VerificationResult.EXPIRED;
        }
        if (user.isEmailVerified()) {
            clearVerification(user);
            return VerificationResult.ALREADY_VERIFIED;
        }
        user.setEmailVerified(true);
        clearVerification(user);
        users.save(user);
        return VerificationResult.VERIFIED;
    }

    /** Always succeeds from the caller's point of view: never reveals whether an account exists. */
    public boolean requestPasswordReset(String email) {
        if (email == null || email.isBlank() || !mail.isConfigured()) return false;
        Optional<User> found = users.findByEmail(email.trim().toLowerCase());
        if (found.isEmpty()) return false;
        User user = found.get();
        if (user.isBlocked() || !user.isActive()) return false;
        String token = createResetToken(user);
        String link = publicUrl + "/#/reset-password?token=" + token;
        return mail.sendHtml(user.getEmail(), "Reset your NovaTutor password",
                mail.passwordResetEmail(user.getName(), link, RESET_MINUTES));
    }

    /** Persists a fresh single-use reset token and returns the raw value for the email link. */
    String createResetToken(User user) {
        String token = newToken();
        user.setResetTokenHash(hash(token));
        user.setResetExpiresAt(LocalDateTime.now().plusMinutes(RESET_MINUTES));
        users.save(user);
        return token;
    }

    public User consumeResetToken(String token, String newPassword) {
        if (token == null || token.isBlank()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_RESET_TOKEN", "This reset link is invalid. Request a new one.");
        }
        if (newPassword == null || newPassword.length() < 6) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "WEAK_PASSWORD", "Password must be at least 6 characters.");
        }
        User user = users.findByResetTokenHash(hash(token.trim()))
                .orElseThrow(() -> new ApiException(HttpStatus.BAD_REQUEST, "INVALID_RESET_TOKEN", "This reset link is invalid or has already been used. Request a new one."));
        if (user.getResetExpiresAt() == null || user.getResetExpiresAt().isBefore(LocalDateTime.now())) {
            user.setResetTokenHash(null);
            user.setResetExpiresAt(null);
            users.save(user);
            throw new ApiException(HttpStatus.BAD_REQUEST, "EXPIRED_RESET_TOKEN", "This reset link has expired. Request a new one.");
        }
        return user;
    }

    public void clearResetToken(User user) {
        user.setResetTokenHash(null);
        user.setResetExpiresAt(null);
        users.save(user);
    }

    private void clearVerification(User user) {
        user.setVerificationTokenHash(null);
        user.setVerificationExpiresAt(null);
        user.setVerificationSentAt(null);
    }

    private String newToken() {
        byte[] bytes = new byte[32];
        random.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    static String hash(String raw) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(digest.digest(raw.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) {
            throw new IllegalStateException("SHA-256 is unavailable", e);
        }
    }
}
