package com.aitutor.service;

import com.aitutor.controller.ApiException;
import com.aitutor.entity.User;
import com.aitutor.repository.UserRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.List;
import java.util.UUID;

/**
 * Isolated, disposable guest identities. Every guest gets its own database
 * user id, so existing ownership checks isolate progress, quizzes, notes,
 * conversations and preferences without a shared guest login. The account has
 * no usable password, is never email-verified through the registration flow,
 * and is purged with all owned data after the configured lifetime.
 *
 * This is deliberately a real role rather than a client-supplied flag: admin
 * endpoints require ADMIN, so GUEST can never reach them.
 */
@Service
public class GuestService {
    private static final Logger log = LoggerFactory.getLogger(GuestService.class);
    public static final String ROLE = "GUEST";
    private final UserRepository users;
    private final PasswordEncoder encoder;
    private final UserDataCleanupService cleanup;
    private final long ttlHours;
    private final long maxActiveGuests;

    public GuestService(UserRepository users, PasswordEncoder encoder, UserDataCleanupService cleanup,
                        @Value("${app.guest.ttl-hours:24}") long ttlHours) {
        this(users, encoder, cleanup, ttlHours, 200L);
    }

    @Autowired
    public GuestService(UserRepository users, PasswordEncoder encoder, UserDataCleanupService cleanup,
                        @Value("${app.guest.ttl-hours:24}") long ttlHours,
                        @Value("${app.guest.max-active:200}") long maxActiveGuests) {
        this.users = users;
        this.encoder = encoder;
        this.cleanup = cleanup;
        this.ttlHours = Math.max(1, ttlHours);
        this.maxActiveGuests = Math.max(10, maxActiveGuests);
    }

    public User create() {
        if (users.countByRole(ROLE) >= maxActiveGuests) {
            purgeExpired();
            if (users.countByRole(ROLE) >= maxActiveGuests) {
                throw new ApiException(HttpStatus.TOO_MANY_REQUESTS, "GUEST_CAPACITY_REACHED",
                        "Guest sessions are temporarily at capacity. Please sign in or try again shortly.");
            }
        }
        String suffix = UUID.randomUUID().toString();
        User u = new User("Guest Learner", "guest-" + suffix + "@guest.novatutor.local",
                encoder.encode(UUID.randomUUID().toString()));
        u.setRole(ROLE);
        u.setEmailVerified(true);
        u.setActive(true);
        u.setBlocked(false);
        return users.save(u);
    }

    @Transactional
    public void end(User user) {
        if (user != null && ROLE.equalsIgnoreCase(user.getRole())) {
            cleanup.deleteUserAndData(user);
        }
    }

    /** Scheduled cleanup executing each guest deletion in its own transactional boundary. */
    @Scheduled(fixedDelayString = "${app.guest.cleanup-ms:3600000}", initialDelayString = "${app.guest.cleanup-ms:3600000}")
    public void scheduledPurge() {
        purgeExpired();
    }

    public void purgeExpired() {
        LocalDateTime cutoff = LocalDateTime.now().minusHours(ttlHours);
        List<User> expired = users.findByRoleAndCreatedAtBefore(ROLE, cutoff);
        for (User u : expired) {
            try {
                cleanup.deleteUserAndData(u);
            } catch (RuntimeException ex) {
                log.warn("Failed to purge expired guest user {}: {}", u.getId(), ex.getMessage());
            }
        }
    }
}
