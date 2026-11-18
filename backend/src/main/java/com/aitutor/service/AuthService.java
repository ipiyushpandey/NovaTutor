package com.aitutor.service;

import com.aitutor.controller.ApiException;
import com.aitutor.entity.User;
import com.aitutor.repository.PendingRegistrationRepository;
import com.aitutor.repository.UserRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;

@Service
public class AuthService {
    private final UserRepository repo;
    private final PendingRegistrationRepository pendingRegistrations;
    private final PasswordEncoder encoder;
    private final String adminEmail;
    private final String adminPassword;

    public AuthService(UserRepository r, PasswordEncoder e,
                       @Value("${app.admin.email:}") String adminEmail,
                       @Value("${app.admin.password:}") String adminPassword) {
        this(r, null, e, adminEmail, adminPassword);
    }

    @Autowired
    public AuthService(UserRepository r,
                       PendingRegistrationRepository pendingRegistrations,
                       PasswordEncoder e,
                       @Value("${app.admin.email:}") String adminEmail,
                       @Value("${app.admin.password:}") String adminPassword) {
        this.repo = r;
        this.pendingRegistrations = pendingRegistrations;
        this.encoder = e;
        this.adminEmail = adminEmail == null ? "" : adminEmail.trim().toLowerCase(Locale.ROOT);
        this.adminPassword = adminPassword == null ? "" : adminPassword;
    }

    public record LoginOutcome(User user, boolean adminPasswordRecovered) {}
    public record PendingDraft(String name, String email, String passwordHash) {}
    public record RegistrationCompletion(User user, boolean alreadyVerified) {}

    /**
     * Validates a new registration and produces an encoded pending draft WITHOUT
     * creating or overwriting any row in `users`. Each registration is bound to
     * its own verification token in `pending_registrations`, preventing both
     * pre-registration takeover and post-registration password overwrite hijacking.
     */
    public PendingDraft preparePendingRegistration(String name, String email, String password) {
        String cleanEmail = normalizeEmail(email);
        if (name == null || name.isBlank()) throw new ApiException(HttpStatus.BAD_REQUEST, "NAME_REQUIRED", "Name is required");
        if (name.trim().length() > 100) throw new ApiException(HttpStatus.BAD_REQUEST, "NAME_TOO_LONG", "Name is too long");
        if (password == null || password.length() < 6) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "WEAK_PASSWORD", "Password must be at least 6 characters");
        }
        if (password.length() > 128) throw new ApiException(HttpStatus.BAD_REQUEST, "PASSWORD_TOO_LONG", "Password is too long");
        Optional<User> existing = repo.findByEmail(cleanEmail);
        if (existing.isPresent() && existing.get().isEmailVerified()) {
            throw new ApiException(HttpStatus.CONFLICT, "EMAIL_TAKEN", "An account with this email already exists. Sign in instead.");
        }
        return new PendingDraft(name.trim(), cleanEmail, encoder.encode(password));
    }

    /**
     * Materializes (or activates a legacy unverified row for) an email ONLY after
     * its specific verification token has been proven. Never overwrites a verified account.
     */
    @Transactional
    public RegistrationCompletion completeVerifiedRegistration(String name, String email, String passwordHash) {
        String cleanEmail = normalizeEmail(email);
        Optional<User> existing = repo.findByEmail(cleanEmail);
        if (existing.isPresent()) {
            User u = existing.get();
            if (u.isEmailVerified()) {
                return new RegistrationCompletion(u, true);
            }
            u.setName(name);
            u.setPassword(passwordHash);
            u.setEmailVerified(true);
            u.setVerificationTokenHash(null);
            u.setVerificationExpiresAt(null);
            u.setVerificationSentAt(null);
            u.setResetTokenHash(null);
            u.setResetExpiresAt(null);
            applyBootstrapRole(u);
            return new RegistrationCompletion(repo.save(u), false);
        }
        User u = new User(name, cleanEmail, passwordHash);
        u.setEmailVerified(true);
        applyBootstrapRole(u);
        return new RegistrationCompletion(repo.save(u), false);
    }

    /**
     * Legacy helper retained for direct unit tests. Rejects verified duplicates and
     * NEVER overwrites an existing unverified row's password in place.
     */
    public User register(String name, String email, String password) {
        PendingDraft draft = preparePendingRegistration(name, email, password);
        Optional<User> existing = repo.findByEmail(draft.email());
        if (existing.isPresent()) {
            return existing.get();
        }
        User u = new User(draft.name(), draft.email(), draft.passwordHash());
        u.setEmailVerified(false);
        applyBootstrapRole(u);
        return repo.save(u);
    }

    public LoginOutcome login(String email, String password) {
        User u = find(email);
        // Verify credentials BEFORE revealing disabled/unverified account state to prevent enumeration.
        boolean recovered = false;
        if (!matchesPassword(password, u.getPassword())) {
            if (!recoverConfiguredAdminPassword(u, password)) {
                throw new ApiException(HttpStatus.UNAUTHORIZED, "INVALID_CREDENTIALS", "Invalid email or password");
            }
            recovered = true;
        }
        if (u.isBlocked() || !u.isActive()) {
            throw new ApiException(HttpStatus.FORBIDDEN, "ACCOUNT_DISABLED", "This account is inactive or blocked.");
        }
        if (!u.isEmailVerified()) {
            throw new ApiException(HttpStatus.FORBIDDEN, "EMAIL_UNVERIFIED",
                    "Verify your email address before signing in. Check your inbox or resend the verification link.");
        }
        u = syncOwnerRole(u);
        return new LoginOutcome(u, recovered);
    }

    /**
     * Break-glass recovery for the owner account.
     *
     * The configured ADMIN_PASSWORD is an operator secret held only in the
     * server environment. When it matches the owner account's email, it may
     * replace a stale database hash. This never weakens authentication for
     * students, never stores plain text, and never touches any other account.
     */
    boolean recoverConfiguredAdminPassword(User u, String supplied) {
        if (adminPassword.isBlank() || adminEmail.isBlank() || supplied == null) return false;
        if (!adminEmail.equalsIgnoreCase(u.getEmail())) return false;
        if (!"ADMIN".equalsIgnoreCase(u.getRole())) return false;
        boolean equal = MessageDigest.isEqual(
                adminPassword.getBytes(StandardCharsets.UTF_8),
                supplied.getBytes(StandardCharsets.UTF_8));
        if (!equal) return false;
        u.setPassword(encoder.encode(supplied));
        repo.save(u);
        return true;
    }

    public boolean matchesPassword(String rawPassword, String encodedPassword) {
        return rawPassword != null && encodedPassword != null && encoder.matches(rawPassword, encodedPassword);
    }

    public User find(String email) {
        return repo.findByEmail(normalizeEmail(email))
                .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "INVALID_CREDENTIALS", "Invalid email or password"));
    }

    public Optional<User> findOptional(String email) {
        try { return Optional.of(find(email)); } catch (RuntimeException e) { return Optional.empty(); }
    }

    public void setPassword(User user, String rawPassword) {
        if (rawPassword == null || rawPassword.length() < 6) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "WEAK_PASSWORD", "Password must be at least 6 characters");
        }
        if (rawPassword.length() > 128) throw new ApiException(HttpStatus.BAD_REQUEST, "PASSWORD_TOO_LONG", "Password is too long");
        user.setPassword(encoder.encode(rawPassword));
        repo.save(user);
    }

    /** Creates or safely links the account behind a verified Google identity. */
    @Transactional
    public User googleLogin(String email, String subject, String name) {
        String cleanEmail = normalizeEmail(email);
        if (subject == null || subject.isBlank()) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "GOOGLE_TOKEN_INVALID", "Google did not return an account identifier.");
        }
        String displayName = (name == null || name.isBlank()) ? cleanEmail.split("@")[0] : name.trim();
        if (displayName.length() > 100) displayName = displayName.substring(0, 100);

        Optional<User> bySubject = repo.findByGoogleSubject(subject);
        if (bySubject.isPresent()) {
            User u = bySubject.get();
            if (u.isBlocked() || !u.isActive()) {
                throw new ApiException(HttpStatus.FORBIDDEN, "ACCOUNT_DISABLED", "This account is inactive or blocked.");
            }
            if ("ADMIN".equalsIgnoreCase(u.getRole())) {
                throw new ApiException(HttpStatus.FORBIDDEN, "PORTAL_MISMATCH",
                        "Administrator accounts must use the Admin sign-in.");
            }
            if (!u.isEmailVerified()) {
                u.setEmailVerified(true);
                repo.save(u);
            }
            if (pendingRegistrations != null) pendingRegistrations.deleteByEmail(cleanEmail);
            return syncOwnerRole(u);
        }
        Optional<User> byEmail = repo.findByEmail(cleanEmail);
        if (byEmail.isPresent()) {
            User u = byEmail.get();
            if (u.isBlocked() || !u.isActive()) {
                throw new ApiException(HttpStatus.FORBIDDEN, "ACCOUNT_DISABLED", "This account is inactive or blocked.");
            }
            if ("ADMIN".equalsIgnoreCase(u.getRole()) || isAdminEmail(cleanEmail)) {
                throw new ApiException(HttpStatus.FORBIDDEN, "PORTAL_MISMATCH",
                        "Administrator accounts must use the Admin sign-in.");
            }
            if (u.getGoogleSubject() != null && !u.getGoogleSubject().isBlank()
                    && !u.getGoogleSubject().equals(subject)) {
                throw new ApiException(HttpStatus.CONFLICT, "ACCOUNT_LINK_CONFLICT",
                        "This email is already linked to a different Google account.");
            }
            // SECURITY (CRITICAL-SEC-02): If the existing row was never email-verified,
            // an attacker may have pre-registered it with a known password. Rotate the
            // password to an unguessable random secret, replace display name, and clear
            // all pending verification/reset tokens before linking Google identity.
            if (!u.isEmailVerified()) {
                u.setPassword(encoder.encode(UUID.randomUUID() + "-" + UUID.randomUUID()));
                u.setName(displayName);
                u.setVerificationTokenHash(null);
                u.setVerificationExpiresAt(null);
                u.setVerificationSentAt(null);
                u.setResetTokenHash(null);
                u.setResetExpiresAt(null);
            }
            u.setGoogleSubject(subject);
            u.setEmailVerified(true);
            repo.save(u);
            if (pendingRegistrations != null) pendingRegistrations.deleteByEmail(cleanEmail);
            return syncOwnerRole(u);
        }
        if (isAdminEmail(cleanEmail)) {
            throw new ApiException(HttpStatus.FORBIDDEN, "PORTAL_MISMATCH",
                    "Administrator accounts must use the Admin sign-in.");
        }
        User u = new User(displayName, cleanEmail, encoder.encode(UUID.randomUUID() + "-" + UUID.randomUUID()));
        u.setGoogleSubject(subject);
        u.setEmailVerified(true);
        applyBootstrapRole(u);
        User saved = repo.save(u);
        if (pendingRegistrations != null) pendingRegistrations.deleteByEmail(cleanEmail);
        return saved;
    }

    public User syncOwnerRole(User user) {
        if (user == null || GuestService.ROLE.equalsIgnoreCase(user.getRole())) return user;
        if (!adminEmail.isBlank()) {
            if (adminEmail.equalsIgnoreCase(user.getEmail()) && !"ADMIN".equalsIgnoreCase(user.getRole())) {
                user.setRole("ADMIN");
                return repo.save(user);
            }
            return user;
        }
        // Never auto-promote arbitrary users when ADMIN_EMAIL is not configured.
        return user;
    }

    public boolean isAdminEmail(String email) {
        return !adminEmail.isBlank() && adminEmail.equalsIgnoreCase(email == null ? "" : email.trim());
    }

    private void applyBootstrapRole(User u) {
        if (GuestService.ROLE.equalsIgnoreCase(u.getRole())) return;
        if (!adminEmail.isBlank()) {
            if (adminEmail.equalsIgnoreCase(u.getEmail())) u.setRole("ADMIN");
        } else if (repo.count() == 0 && !repo.existsByRoleIgnoreCase("ADMIN")) {
            u.setRole("ADMIN");
        }
    }

    public String normalizeEmail(String email) {
        if (email == null || email.isBlank()) throw new ApiException(HttpStatus.BAD_REQUEST, "EMAIL_REQUIRED", "Email is required");
        String clean = email.trim().toLowerCase(Locale.ROOT);
        if (clean.length() > 254 || !clean.matches("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$")) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "EMAIL_INVALID", "Enter a valid email address");
        }
        return clean;
    }
}
