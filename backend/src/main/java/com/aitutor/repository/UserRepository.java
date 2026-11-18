package com.aitutor.repository;

import com.aitutor.entity.User;
import org.springframework.data.jpa.repository.JpaRepository;

import java.time.LocalDateTime;
import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface UserRepository extends JpaRepository<User, Long> {
    List<User> findByRoleAndCreatedAtBefore(String role, LocalDateTime cutoff);
    List<User> findByRoleNotOrderByNameAsc(String role);
    List<User> findTop8ByRoleNotOrderByCreatedAtDesc(String role);
    boolean existsByRoleIgnoreCase(String role);
    long countByRole(String role);
    long countByRoleNot(String role);
    long countByRoleNotAndActiveTrue(String role);
    long countByRoleNotAndBlockedTrue(String role);
    Optional<User> findByEmail(String email);
    List<User> findByIdIn(Collection<Long> ids);
    Optional<User> findByVerificationTokenHash(String hash);
    Optional<User> findByResetTokenHash(String hash);
    Optional<User> findByGoogleSubject(String googleSubject);
}
