package com.aitutor.repository;

import com.aitutor.entity.PendingRegistration;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

public interface PendingRegistrationRepository extends JpaRepository<PendingRegistration, Long> {
    Optional<PendingRegistration> findByTokenHash(String tokenHash);

    List<PendingRegistration> findByEmailOrderByCreatedAtDesc(String email);

    @Modifying(clearAutomatically = true, flushAutomatically = true)
    void deleteByEmail(String email);

    @Modifying(clearAutomatically = true, flushAutomatically = true)
    void deleteByExpiresAtBefore(LocalDateTime cutoff);
}
