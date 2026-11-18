package com.aitutor.service;

import com.aitutor.entity.User;
import com.aitutor.repository.UserRepository;
import org.springframework.beans.factory.annotation.Value;
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
    public static final String ROLE = "GUEST";
    private final UserRepository users;
    private final PasswordEncoder encoder;
    private final UserDataCleanupService cleanup;
    private final long ttlHours;

    public GuestService(UserRepository users, PasswordEncoder encoder, UserDataCleanupService cleanup,
                        @Value("${app.guest.ttl-hours:24}") long ttlHours) {
        this.users = users;
        this.encoder = encoder;
        this.cleanup = cleanup;
        this.ttlHours = Math.max(1, ttlHours);
    }

    @Transactional
    public User create() {
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

    /** Scheduled cleanup plus a cheap lazy sweep on every new guest login. */
    @Scheduled(fixedDelayString = "${app.guest.cleanup-ms:3600000}", initialDelayString = "${app.guest.cleanup-ms:3600000}")
    public void scheduledPurge() {
        purgeExpired();
    }

    @Transactional
    public void purgeExpired() {
        LocalDateTime cutoff = LocalDateTime.now().minusHours(ttlHours);
        List<User> expired = users.findByRoleAndCreatedAtBefore(ROLE, cutoff);
        for (User u : expired) cleanup.deleteUserAndData(u);
    }
}
