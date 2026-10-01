package com.aitutor.dsa;

import com.aitutor.entity.User;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.LocalDateTime;

/**
 * Per-user, per-problem state for the DSA practice module:
 * solve status, attempt count, bookmark and the last saved code per language.
 */
@Entity
@Getter
@Setter
@NoArgsConstructor
@Table(name = "dsa_problem_state",
       uniqueConstraints = @UniqueConstraint(columnNames = {"user_id", "slug"}))
public class DsaProblemState {

    public static final String SOLVED = "SOLVED";
    public static final String ATTEMPTED = "ATTEMPTED";

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    Long id;

    @ManyToOne(optional = false)
    @JoinColumn(name = "user_id")
    User user;

    @Column(name = "slug", nullable = false, length = 120)
    String slug;

    /** SOLVED | ATTEMPTED */
    @Column(nullable = false, length = 16)
    String status;

    @Column(nullable = false)
    int attempts;

    /** Last language used, for restoring the editor. */
    @Column(length = 24)
    String lastLanguage;

    @Column(columnDefinition = "TEXT")
    String lastCode;

    @Column(nullable = false)
    boolean bookmarked;

    @Column(nullable = false)
    LocalDateTime firstAttemptAt;

    LocalDateTime solvedAt;

    LocalDateTime updatedAt;

    public DsaProblemState(User user, String slug) {
        this.user = user;
        this.slug = slug;
        this.status = ATTEMPTED;
        this.attempts = 0;
        this.firstAttemptAt = LocalDateTime.now();
        this.updatedAt = LocalDateTime.now();
    }
}
