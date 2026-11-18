package com.aitutor.service;

import com.aitutor.controller.ApiException;
import com.aitutor.entity.User;
import com.aitutor.repository.UserRepository;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Optional;
import java.util.UUID;

@Service
public class AuthService {
    private final UserRepository repo;
    private final PasswordEncoder encoder;
    private final String adminEmail;
    private final String adminPassword;

    public AuthService(UserRepository r, PasswordEncoder e,
                       @Value("${app.admin.email:}") String adminEmail,
                       @Value("${app.admin.password:}") String adminPassword) {
        repo = r; encoder = e;
        this.adminEmail = adminEmail == null ? "" : adminEmail.trim().toLowerCase();
        this.adminPassword = adminPassword == null ? "" : adminPassword;
    }

    public record LoginOutcome(User user, boolean adminPasswordRecovered) {}

    /**
     * Creates a pending, unverified account. An existing unverified account is
     * returned so the caller can resend its verification link; an existing
     * verified account is rejected so duplicate accounts can never be created.
     */
    public User register(String name, String email, String password) {
        String cleanEmail = normalizeEmail(email);
        if (name == null || name.isBlank()) throw new ApiException(HttpStatus.BAD_REQUEST, "NAME_REQUIRED", "Name is required");
        if (name.trim().length() > 100) throw new ApiException(HttpStatus.BAD_REQUEST, "NAME_TOO_LONG", "Name is too long");
        if (password == null || password.length() < 6) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "WEAK_PASSWORD", "Password must be at least 6 characters");
        }
        if (password.length() > 128) throw new ApiException(HttpStatus.BAD_REQUEST, "PASSWORD_TOO_LONG", "Password is too long");
        Optional<User> existing = repo.findByEmail(cleanEmail);
        if (existing.isPresent()) {
            User pending = existing.get();
            if (pending.isEmailVerified()) {
                throw new ApiException(HttpStatus.CONFLICT, "EMAIL_TAKEN", "An account with this email already exists. Sign in instead.");
            }
            // Prevent pre-registration account takeover: update the pending row with
            // the latest registrant's name & password and invalidate any prior link.
            pending.setName(name.trim());
            pending.setPassword(encoder.encode(password));
            pending.setVerificationTokenHash(null);
            pending.setVerificationExpiresAt(null);
            return repo.save(pending);
        }
        User u = new User(name.trim(), cleanEmail, encoder.encode(password));
        u.setEmailVerified(false);
        applyBootstrapRole(u);
        return repo.save(u);
    }

    public LoginOutcome login(String email, String password) {
        User u = find(email);
        if (u.isBlocked() || !u.isActive()) {
            throw new ApiException(HttpStatus.FORBIDDEN, "ACCOUNT_DISABLED", "This account is inactive or blocked.");
        }
        boolean recovered = false;
        if (!matchesPassword(password, u.getPassword())) {
            if (!recoverConfiguredAdminPassword(u, password)) {
                throw new ApiException(HttpStatus.UNAUTHORIZED, "INVALID_CREDENTIALS", "Invalid email or password");
            }
            recovered = true;
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
    public User googleLogin(String email, String subject, String name) {
        String cleanEmail = normalizeEmail(email);
        if (subject == null || subject.isBlank()) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "GOOGLE_TOKEN_INVALID", "Google did not return an account identifier.");
        }
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
            if (!u.isEmailVerified()) { u.setEmailVerified(true); repo.save(u); }
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
            // Google has proven ownership of this address, so link it and mark it verified.
            u.setGoogleSubject(subject);
            u.setEmailVerified(true);
            repo.save(u);
            return syncOwnerRole(u);
        }
        if (isAdminEmail(cleanEmail)) {
            throw new ApiException(HttpStatus.FORBIDDEN, "PORTAL_MISMATCH",
                    "Administrator accounts must use the Admin sign-in.");
        }
        String displayName = (name == null || name.isBlank()) ? cleanEmail.split("@")[0] : name.trim();
        if (displayName.length() > 100) displayName = displayName.substring(0, 100);
        User u = new User(displayName, cleanEmail, encoder.encode(UUID.randomUUID() + "-" + UUID.randomUUID()));
        u.setGoogleSubject(subject);
        u.setEmailVerified(true);
        applyBootstrapRole(u);
        return repo.save(u);
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

    private String normalizeEmail(String email) {
        if (email == null || email.isBlank()) throw new ApiException(HttpStatus.BAD_REQUEST, "EMAIL_REQUIRED", "Email is required");
        String clean = email.trim().toLowerCase();
        if (clean.length() > 254 || !clean.matches("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$")) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "EMAIL_INVALID", "Enter a valid email address");
        }
        return clean;
    }
}
