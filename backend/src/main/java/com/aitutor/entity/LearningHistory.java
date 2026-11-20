package com.aitutor.entity;

import com.fasterxml.jackson.annotation.JsonIgnore;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.LocalDateTime;
import java.time.ZoneId;

@Entity
@Table(name = "learning_history", indexes = {
        @Index(name = "idx_history_user_updated", columnList = "user_id, updatedAt"),
        @Index(name = "ux_history_user_item", columnList = "user_id, itemType, itemKey", unique = true)
})
@Getter
@Setter
@NoArgsConstructor
public class LearningHistory {
    private static final ZoneId ZONE = ZoneId.of("Asia/Kolkata");

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @JsonIgnore
    @ManyToOne(optional = false, fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    @Column(nullable = false, length = 40)
    private String itemType;

    @Column(nullable = false, length = 120)
    private String itemKey;

    @Column(nullable = false, length = 180)
    private String title;

    @Column(length = 120)
    private String category;

    @Column(length = 200)
    private String targetRoute;

    @Lob
    @Column(columnDefinition = "LONGTEXT")
    private String contentSnapshot;

    @Column(nullable = false)
    private LocalDateTime createdAt = LocalDateTime.now(ZONE);

    @Column(nullable = false)
    private LocalDateTime updatedAt = LocalDateTime.now(ZONE);

    public LearningHistory(User user, String itemType, String itemKey, String title,
                           String category, String targetRoute, String contentSnapshot) {
        this.user = user;
        this.itemType = itemType;
        this.itemKey = itemKey;
        this.title = title;
        this.category = category;
        this.targetRoute = targetRoute;
        this.contentSnapshot = contentSnapshot;
        this.createdAt = LocalDateTime.now(ZONE);
        this.updatedAt = LocalDateTime.now(ZONE);
    }

    public void touch(String title, String category, String targetRoute, String contentSnapshot) {
        if (title != null && !title.isBlank()) this.title = title;
        if (category != null && !category.isBlank()) this.category = category;
        if (targetRoute != null && !targetRoute.isBlank()) this.targetRoute = targetRoute;
        if (contentSnapshot != null && !contentSnapshot.isBlank()) this.contentSnapshot = contentSnapshot;
        this.updatedAt = LocalDateTime.now(ZONE);
    }
}
