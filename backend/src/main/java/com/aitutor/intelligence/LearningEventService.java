package com.aitutor.intelligence;

import com.aitutor.entity.User;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;

@Service
public class LearningEventService {
    private static final int MAX_SUBJECT = 120;
    private static final int MAX_TOPIC = 180;
    private static final int MAX_DETAILS = 1000;
    private static final int MAX_DEDUPE = 180;

    private final LearningEventRepository repository;

    public LearningEventService(LearningEventRepository repository) { this.repository = repository; }

    @Transactional
    public LearningEvent record(User user, String type, String subject, String topic, Integer score, Integer durationSeconds, String details) {
        return record(user, type, subject, topic, score, durationSeconds, details, null);
    }

    /**
     * Atomically inserts a deduplicated learning event and returns {@code true}
     * if and only if this call actually inserted a new row (never throws on
     * concurrent duplicates and never poisons an enclosing JPA transaction).
     */
    @Transactional
    public boolean recordIfAbsent(User user, String type, String subject, String topic,
                                  Integer score, Integer durationSeconds, String details, String dedupeKey) {
        if (user == null) throw new IllegalArgumentException("Learning event user is required");
        String normalizedType = type == null ? "" : type.trim().toUpperCase(java.util.Locale.ROOT);
        if (normalizedType.isBlank()) throw new IllegalArgumentException("Learning event type is required");
        String safeSubject = clamp(subject, MAX_SUBJECT);
        String safeTopic = clamp(topic, MAX_TOPIC);
        String safeDetails = clamp(details, MAX_DETAILS);
        if (dedupeKey != null && !dedupeKey.isBlank()) {
            String key = clampDedupeKey(dedupeKey.trim());
            int inserted = repository.insertIfAbsent(
                    user.getId(), normalizedType, safeSubject, safeTopic, score, durationSeconds, safeDetails, key,
                    java.time.LocalDateTime.now(LearningEventAnalyticsService.LEARNING_ZONE));
            return inserted > 0;
        }
        repository.save(new LearningEvent(user, normalizedType, safeSubject, safeTopic, score, durationSeconds, safeDetails));
        return true;
    }

    @Transactional
    public LearningEvent record(User user, String type, String subject, String topic, Integer score, Integer durationSeconds, String details, String dedupeKey) {
        if (user == null) throw new IllegalArgumentException("Learning event user is required");
        String normalizedType = type == null ? "" : type.trim().toUpperCase(java.util.Locale.ROOT);
        if (normalizedType.isBlank()) throw new IllegalArgumentException("Learning event type is required");
        String safeSubject = clamp(subject, MAX_SUBJECT);
        String safeTopic = clamp(topic, MAX_TOPIC);
        String safeDetails = clamp(details, MAX_DETAILS);
        if (dedupeKey != null && !dedupeKey.isBlank()) {
            String key = clampDedupeKey(dedupeKey.trim());
            var existing = repository.findByUserIdAndDedupeKey(user.getId(), key);
            if (existing.isPresent()) return existing.get();
            repository.insertIfAbsent(
                    user.getId(), normalizedType, safeSubject, safeTopic, score, durationSeconds, safeDetails, key,
                    java.time.LocalDateTime.now(LearningEventAnalyticsService.LEARNING_ZONE));
            return repository.findByUserIdAndDedupeKey(user.getId(), key)
                    .orElseGet(() -> new LearningEvent(user, normalizedType, safeSubject, safeTopic, score, durationSeconds, safeDetails, key));
        }
        return repository.save(new LearningEvent(user, normalizedType, safeSubject, safeTopic, score, durationSeconds, safeDetails));
    }

    private static String clamp(String value, int max) {
        if (value == null) return null;
        return value.length() <= max ? value : value.substring(0, max);
    }

    private static String clampDedupeKey(String key) {
        if (key.length() <= MAX_DEDUPE) return key;
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            String digest = HexFormat.of().formatHex(md.digest(key.getBytes(StandardCharsets.UTF_8)));
            return key.substring(0, 110) + ":" + digest;
        } catch (Exception e) {
            return key.substring(0, MAX_DEDUPE);
        }
    }
}
