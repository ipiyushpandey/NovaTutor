package com.aitutor.entity;

import jakarta.persistence.*;
import java.time.LocalDateTime;

/**
 * Token-bound pending email registration.
 *
 * Credentials remain isolated per verification token and are never written over
 * an existing unverified User row in place, preventing both pre-registration
 * account takeover and post-registration password overwrite hijacking.
 */
@Entity
@Table(name = "pending_registrations", indexes = {
        @Index(name = "idx_pending_reg_email", columnList = "email"),
        @Index(name = "idx_pending_reg_expires", columnList = "expiresAt")
})
public class PendingRegistration {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 100)
    private String name;

    @Column(nullable = false, length = 254)
    private String email;

    @Column(nullable = false, length = 255)
    private String passwordHash;

    @Column(nullable = false, unique = true, length = 128)
    private String tokenHash;

    @Column(nullable = false)
    private LocalDateTime expiresAt;

    private LocalDateTime sentAt;

    @Column(nullable = false)
    private LocalDateTime createdAt = LocalDateTime.now();

    public PendingRegistration() {}

    public PendingRegistration(String email, String name, String passwordHash, String tokenHash, LocalDateTime expiresAt, LocalDateTime sentAt) {
        this.email = email;
        this.name = name;
        this.passwordHash = passwordHash;
        this.tokenHash = tokenHash;
        this.expiresAt = expiresAt;
        this.sentAt = sentAt;
        this.createdAt = LocalDateTime.now();
    }

    public Long getId() { return id; }
    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
    public String getEmail() { return email; }
    public void setEmail(String email) { this.email = email; }
    public String getPasswordHash() { return passwordHash; }
    public void setPasswordHash(String passwordHash) { this.passwordHash = passwordHash; }
    public String getTokenHash() { return tokenHash; }
    public void setTokenHash(String tokenHash) { this.tokenHash = tokenHash; }
    public LocalDateTime getExpiresAt() { return expiresAt; }
    public void setExpiresAt(LocalDateTime expiresAt) { this.expiresAt = expiresAt; }
    public LocalDateTime getSentAt() { return sentAt; }
    public void setSentAt(LocalDateTime sentAt) { this.sentAt = sentAt; }
    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }
}
