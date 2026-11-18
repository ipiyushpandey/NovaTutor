package com.aitutor.service;

import com.aitutor.controller.ApiException;
import com.aitutor.entity.User;
import com.aitutor.repository.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.security.crypto.password.PasswordEncoder;

import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class AuthServiceTest {
    private static final String ADMIN_EMAIL = "owner@novatutor.test";
    private static final String ADMIN_PASSWORD = "owner-secret-123";
    private UserRepository repo;
    private PasswordEncoder encoder;
    private AuthService service;

    @BeforeEach
    void setUp() {
        repo = Mockito.mock(UserRepository.class);
        encoder = Mockito.mock(PasswordEncoder.class);
        when(encoder.encode(anyString())).thenReturn("encoded");
        when(repo.save(any(User.class))).thenAnswer(inv -> inv.getArgument(0));
        service = new AuthService(repo, encoder, ADMIN_EMAIL, ADMIN_PASSWORD);
    }

    @Test
    void registrationCreatesAnUnverifiedAccount() {
        when(repo.findByEmail("student@example.com")).thenReturn(Optional.empty());
        User user = service.register("Student", "Student@Example.com", "password123");
        assertFalse(user.isEmailVerified());
        assertEquals("student@example.com", user.getEmail());
        assertEquals("STUDENT", user.getRole());
        verify(repo).save(user);
    }

    @Test
    void duplicateVerifiedEmailIsRejected() {
        User existing = new User("A", "student@example.com", "hash");
        existing.setEmailVerified(true);
        when(repo.findByEmail("student@example.com")).thenReturn(Optional.of(existing));
        ApiException error = assertThrows(ApiException.class,
                () -> service.register("B", "student@example.com", "password123"));
        assertEquals("EMAIL_TAKEN", error.code());
    }

    @Test
    void duplicateUnverifiedEmailDoesNotOverwriteExistingCredentialsInPlace() {
        User existing = new User("Victim", "student@example.com", "victim-hash");
        existing.setEmailVerified(false);
        existing.setVerificationTokenHash("victim-token-hash");
        when(repo.findByEmail("student@example.com")).thenReturn(Optional.of(existing));
        User returned = service.register("Attacker", "student@example.com", "attacker-password-123");
        assertSame(existing, returned);
        assertEquals("Victim", returned.getName());
        assertEquals("victim-hash", returned.getPassword());
        assertEquals("victim-token-hash", returned.getVerificationTokenHash());
        verify(repo, never()).save(existing);
    }

    @Test
    void googleLoginOverLegacyUnverifiedRowRotatesPasswordAndClearsTokens() {
        User preRegistered = new User("Attacker", "victim@example.com", "attacker-known-hash");
        preRegistered.setEmailVerified(false);
        preRegistered.setVerificationTokenHash("attacker-verify-hash");
        preRegistered.setResetTokenHash("attacker-reset-hash");
        when(repo.findByGoogleSubject("victim-google-sub")).thenReturn(Optional.empty());
        when(repo.findByEmail("victim@example.com")).thenReturn(Optional.of(preRegistered));

        User linked = service.googleLogin("victim@example.com", "victim-google-sub", "Real Victim");
        assertTrue(linked.isEmailVerified());
        assertEquals("victim-google-sub", linked.getGoogleSubject());
        assertEquals("Real Victim", linked.getName());
        assertNotEquals("attacker-known-hash", linked.getPassword());
        assertNull(linked.getVerificationTokenHash());
        assertNull(linked.getResetTokenHash());
    }

    @Test
    void blockedAccountWithWrongPasswordReturnsInvalidCredentialsNotDisabled() {
        User blocked = new User("Blocked", "blocked@example.com", "real-hash");
        blocked.setEmailVerified(true);
        blocked.setBlocked(true);
        when(repo.findByEmail("blocked@example.com")).thenReturn(Optional.of(blocked));
        when(encoder.matches("wrong-pass", "real-hash")).thenReturn(false);

        ApiException err = assertThrows(ApiException.class,
                () -> service.login("blocked@example.com", "wrong-pass"));
        assertEquals("INVALID_CREDENTIALS", err.code());
        assertEquals(401, err.status().value());
    }

    @Test
    void weakAndMalformedInputIsRejected() {
        assertEquals("WEAK_PASSWORD", assertThrows(ApiException.class,
                () -> service.register("A", "a@b.com", "123")).code());
        assertEquals("EMAIL_INVALID", assertThrows(ApiException.class,
                () -> service.register("A", "not-an-email", "password123")).code());
        assertEquals("NAME_REQUIRED", assertThrows(ApiException.class,
                () -> service.register(" ", "a@b.com", "password123")).code());
    }

    @Test
    void unverifiedAccountCannotSignIn() {
        User user = new User("A", "student@example.com", "hash");
        user.setEmailVerified(false);
        when(repo.findByEmail("student@example.com")).thenReturn(Optional.of(user));
        when(encoder.matches("password123", "hash")).thenReturn(true);
        ApiException error = assertThrows(ApiException.class, () -> service.login("student@example.com", "password123"));
        assertEquals("EMAIL_UNVERIFIED", error.code());
        assertEquals(403, error.status().value());
    }

    @Test
    void wrongPasswordIsRejectedWithoutLeakingWhetherTheAccountExists() {
        User user = new User("A", "student@example.com", "hash");
        user.setEmailVerified(true);
        when(repo.findByEmail("student@example.com")).thenReturn(Optional.of(user));
        when(repo.findByEmail("missing@example.com")).thenReturn(Optional.empty());
        when(encoder.matches(anyString(), anyString())).thenReturn(false);
        assertEquals("INVALID_CREDENTIALS",
                assertThrows(ApiException.class, () -> service.login("student@example.com", "nope")).code());
        assertEquals("INVALID_CREDENTIALS",
                assertThrows(ApiException.class, () -> service.login("missing@example.com", "nope")).code());
    }

    @Test
    void verifiedStudentCanSignIn() {
        User user = new User("A", "student@example.com", "hash");
        user.setEmailVerified(true);
        when(repo.findByEmail("student@example.com")).thenReturn(Optional.of(user));
        when(encoder.matches("password123", "hash")).thenReturn(true);
        AuthService.LoginOutcome outcome = service.login("student@example.com", "password123");
        assertFalse(outcome.adminPasswordRecovered());
        assertEquals("STUDENT", outcome.user().getRole());
    }

    @Test
    void configuredAdminPasswordRepairsTheOwnerHashOnly() {
        User owner = new User("Owner", ADMIN_EMAIL, "stale-hash");
        owner.setRole("ADMIN");
        owner.setEmailVerified(true);
        when(repo.findByEmail(ADMIN_EMAIL)).thenReturn(Optional.of(owner));
        when(encoder.matches(eq(ADMIN_PASSWORD), anyString())).thenReturn(false);

        AuthService.LoginOutcome outcome = service.login(ADMIN_EMAIL, ADMIN_PASSWORD);
        assertTrue(outcome.adminPasswordRecovered());
        assertEquals("encoded", owner.getPassword());
        verify(encoder).encode(ADMIN_PASSWORD);
        verify(repo, atLeastOnce()).save(owner);
    }

    @Test
    void adminRecoveryDoesNotApplyToStudentsOrWrongSecrets() {
        User student = new User("S", "student@example.com", "stale");
        student.setEmailVerified(true);
        when(repo.findByEmail("student@example.com")).thenReturn(Optional.of(student));
        when(encoder.matches(anyString(), anyString())).thenReturn(false);
        assertFalse(service.recoverConfiguredAdminPassword(student, ADMIN_PASSWORD));

        User owner = new User("O", ADMIN_EMAIL, "stale");
        owner.setRole("ADMIN");
        assertFalse(service.recoverConfiguredAdminPassword(owner, "wrong-secret"));
        assertEquals("stale", owner.getPassword());
    }

    @Test
    void googleLoginCreatesAVerifiedProfileOnFirstUse() {
        when(repo.findByGoogleSubject("google-sub")).thenReturn(Optional.empty());
        when(repo.findByEmail("new@example.com")).thenReturn(Optional.empty());
        User user = service.googleLogin("New@Example.com", "google-sub", "New Student");
        assertTrue(user.isEmailVerified());
        assertEquals("google-sub", user.getGoogleSubject());
        assertEquals("new@example.com", user.getEmail());
        assertEquals("New Student", user.getName());
    }

    @Test
    void googleLoginLinksAnExistingVerifiedAccountOnce() {
        User existing = new User("A", "student@example.com", "hash");
        existing.setEmailVerified(true);
        when(repo.findByGoogleSubject("google-sub")).thenReturn(Optional.empty());
        when(repo.findByEmail("student@example.com")).thenReturn(Optional.of(existing));
        User linked = service.googleLogin("student@example.com", "google-sub", "A");
        assertEquals("google-sub", linked.getGoogleSubject());
        assertTrue(linked.isEmailVerified());

        // A different Google identity can never take over the linked email.
        when(repo.findByGoogleSubject("other-sub")).thenReturn(Optional.empty());
        assertEquals("ACCOUNT_LINK_CONFLICT", assertThrows(ApiException.class,
                () -> service.googleLogin("student@example.com", "other-sub", "A")).code());
    }

    @Test
    void googleLoginRejectsBlockedAccounts() {
        User blocked = new User("A", "student@example.com", "hash");
        blocked.setEmailVerified(true);
        blocked.setBlocked(true);
        when(repo.findByGoogleSubject("google-sub")).thenReturn(Optional.of(blocked));
        assertEquals("ACCOUNT_DISABLED", assertThrows(ApiException.class,
                () -> service.googleLogin("student@example.com", "google-sub", "A")).code());
    }
}
