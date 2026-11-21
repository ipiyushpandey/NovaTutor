package com.aitutor.controller;

import com.aitutor.entity.LearningHistory;
import com.aitutor.entity.User;
import com.aitutor.repository.LearningHistoryRepository;
import com.aitutor.repository.UserRepository;
import com.aitutor.security.AuthenticatedUser;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.Optional;

@RestController
@RequestMapping("/api/history")
public class LearningHistoryController {

    private final LearningHistoryRepository historyRepository;
    private final AuthenticatedUser authenticatedUser;
    private final UserRepository userRepository;

    public LearningHistoryController(LearningHistoryRepository historyRepository,
                                     AuthenticatedUser authenticatedUser,
                                     UserRepository userRepository) {
        this.historyRepository = historyRepository;
        this.authenticatedUser = authenticatedUser;
        this.userRepository = userRepository;
    }

    public record RecordReq(
            String itemType,
            String itemKey,
            String title,
            String category,
            String targetRoute,
            String contentSnapshot
    ) {}

    public record HistoryItemDto(
            Long id,
            String itemType,
            String itemKey,
            String title,
            String category,
            String targetRoute,
            String contentSnapshot,
            LocalDateTime createdAt,
            LocalDateTime updatedAt
    ) {
        public static HistoryItemDto from(LearningHistory h) {
            return new HistoryItemDto(
                    h.getId(),
                    h.getItemType(),
                    h.getItemKey(),
                    h.getTitle(),
                    h.getCategory(),
                    h.getTargetRoute(),
                    h.getContentSnapshot(),
                    h.getCreatedAt(),
                    h.getUpdatedAt()
            );
        }
    }

    private static final java.util.Set<String> ALLOWED_HISTORY_TYPES = java.util.Set.of("AI_TEACHER");

    @GetMapping
    public List<HistoryItemDto> list(Authentication authentication) {
        User user = authenticatedUser.require(authentication);
        return historyRepository.findTop50ByUserIdAndItemTypeInOrderByUpdatedAtDesc(user.getId(), ALLOWED_HISTORY_TYPES)
                .stream()
                .map(HistoryItemDto::from)
                .toList();
    }

    @PostMapping("/record")
    @Transactional
    public HistoryItemDto record(@RequestBody RecordReq req, Authentication authentication) {
        User user = authenticatedUser.require(authentication);
        if (req == null || req.itemType() == null || req.itemType().isBlank()
                || req.itemKey() == null || req.itemKey().isBlank()
                || req.title() == null || req.title().isBlank()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_HISTORY_ITEM",
                    "itemType, itemKey, and title are required for learning history");
        }

        String safeType = req.itemType().trim().toUpperCase(java.util.Locale.ROOT);
        if (!ALLOWED_HISTORY_TYPES.contains(safeType)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "UNSUPPORTED_HISTORY_TYPE",
                    "Only AI Teacher interactions may be recorded in learning history");
        }

        if (req.contentSnapshot() == null || req.contentSnapshot().isBlank()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_HISTORY_ITEM",
                    "Meaningful content snapshot is required for learning history");
        }

        String safeKey = req.itemKey().trim();
        String safeTitle = req.title().trim();
        String safeCategory = req.category() != null ? req.category().trim() : "";
        String safeRoute = req.targetRoute() != null ? req.targetRoute().trim() : "learning-studio";
        String safeSnapshot = req.contentSnapshot().trim();

        Optional<LearningHistory> existing = historyRepository.findByUserIdAndItemTypeAndItemKey(
                user.getId(), safeType, safeKey);

        LearningHistory item;
        if (existing.isPresent()) {
            item = existing.get();
            item.touch(safeTitle, safeCategory, safeRoute, safeSnapshot);
        } else {
            User ref = userRepository.getReferenceById(user.getId());
            item = new LearningHistory(ref, safeType, safeKey, safeTitle, safeCategory, safeRoute, safeSnapshot);
        }

        LearningHistory saved = historyRepository.save(item);
        return HistoryItemDto.from(saved);
    }

    @DeleteMapping("/{id}")
    @Transactional
    public Map<String, Object> deleteItem(@PathVariable Long id, Authentication authentication) {
        User user = authenticatedUser.require(authentication);
        int deleted = historyRepository.deleteByUserIdAndId(user.getId(), id);
        return Map.of("success", true, "id", id, "deleted", deleted > 0);
    }

    @DeleteMapping
    @Transactional
    public Map<String, Object> clear(Authentication authentication) {
        User user = authenticatedUser.require(authentication);
        int deleted = historyRepository.deleteByUserIdAndItemTypeIn(user.getId(), ALLOWED_HISTORY_TYPES);
        return Map.of("success", true, "count", deleted);
    }
}
