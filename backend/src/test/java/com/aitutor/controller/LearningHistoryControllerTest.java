package com.aitutor.controller;

import com.aitutor.entity.LearningHistory;
import com.aitutor.entity.User;
import com.aitutor.repository.LearningHistoryRepository;
import com.aitutor.repository.UserRepository;
import com.aitutor.security.AuthenticatedUser;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;

import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class LearningHistoryControllerTest {

    private LearningHistoryRepository historyRepository;
    private AuthenticatedUser authenticatedUser;
    private UserRepository userRepository;
    private LearningHistoryController controller;
    private Authentication auth;
    private User testUser;

    @BeforeEach
    void setUp() {
        historyRepository = mock(LearningHistoryRepository.class);
        authenticatedUser = mock(AuthenticatedUser.class);
        userRepository = mock(UserRepository.class);
        controller = new LearningHistoryController(historyRepository, authenticatedUser, userRepository);
        auth = mock(Authentication.class);

        testUser = new User();
        testUser.setId(42L);
        testUser.setEmail("student@novatutor.test");
        when(authenticatedUser.require(auth)).thenReturn(testUser);
        when(userRepository.getReferenceById(42L)).thenReturn(testUser);
    }

    @Test
    @DisplayName("record allows AI_TEACHER with valid data")
    void testRecordAiTeacherSuccess() {
        LearningHistoryController.RecordReq req = new LearningHistoryController.RecordReq(
                "AI_TEACHER",
                "tutor_binary_search",
                "Binary Search in Java",
                "Algorithms",
                "learning-studio",
                "{\"topic\":\"Binary Search\",\"answer\":\"O(log n) time\"}"
        );

        when(historyRepository.findByUserIdAndItemTypeAndItemKey(42L, "AI_TEACHER", "tutor_binary_search"))
                .thenReturn(Optional.empty());

        when(historyRepository.save(any(LearningHistory.class))).thenAnswer(inv -> {
            LearningHistory h = inv.getArgument(0);
            h.setId(100L);
            return h;
        });

        LearningHistoryController.HistoryItemDto dto = controller.record(req, auth);
        assertNotNull(dto);
        assertEquals("AI_TEACHER", dto.itemType());
        assertEquals("Binary Search in Java", dto.title());
        verify(historyRepository).save(any(LearningHistory.class));
    }

    @Test
    @DisplayName("record rejects unsupported types like QUIZ, DPP, LESSON, DSA with 400 UNSUPPORTED_HISTORY_TYPE")
    void testRecordRejectsUnsupportedTypes() {
        List<String> forbidden = List.of("QUIZ", "DPP", "LESSON", "DSA", "GATE_CSE", "NAVIGATION", "PROFILE");

        for (String type : forbidden) {
            LearningHistoryController.RecordReq req = new LearningHistoryController.RecordReq(
                    type,
                    "item_123",
                    "Title for " + type,
                    "Category",
                    "route",
                    "{\"snapshot\":\"data\"}"
            );

            ApiException ex = assertThrows(ApiException.class, () -> controller.record(req, auth),
                    "Expected record to reject " + type);
            assertEquals(HttpStatus.BAD_REQUEST, ex.status());
            assertEquals("UNSUPPORTED_HISTORY_TYPE", ex.code());
        }
        verify(historyRepository, never()).save(any());
    }

    @Test
    @DisplayName("record rejects null or blank content snapshot")
    void testRecordRejectsBlankSnapshot() {
        LearningHistoryController.RecordReq req = new LearningHistoryController.RecordReq(
                "AI_TEACHER",
                "tutor_topic",
                "Valid Title",
                "Category",
                "learning-studio",
                "   "
        );

        ApiException ex = assertThrows(ApiException.class, () -> controller.record(req, auth));
        assertEquals(HttpStatus.BAD_REQUEST, ex.status());
        assertEquals("INVALID_HISTORY_ITEM", ex.code());
        verify(historyRepository, never()).save(any());
    }

    @Test
    @DisplayName("list filters strictly for AI_TEACHER, hiding legacy or unrelated records")
    void testListFiltersStrictlyForAiTeacher() {
        LearningHistory aiItem = new LearningHistory(testUser, "AI_TEACHER", "tutor_trees", "Tree Traversal", "DSA", "learning-studio", "{}");
        aiItem.setId(1L);

        when(historyRepository.findTop50ByUserIdAndItemTypeInOrderByUpdatedAtDesc(eq(42L), anyCollection()))
                .thenReturn(List.of(aiItem));

        List<LearningHistoryController.HistoryItemDto> list = controller.list(auth);
        assertEquals(1, list.size());
        assertEquals("AI_TEACHER", list.get(0).itemType());

        // Verify the repository was called with the restricted collection containing AI_TEACHER
        verify(historyRepository).findTop50ByUserIdAndItemTypeInOrderByUpdatedAtDesc(eq(42L), eq(Set.of("AI_TEACHER")));
    }

    @Test
    @DisplayName("deleteItem deletes only the record owned by the authenticated user")
    void testDeleteItemScopedToUser() {
        when(historyRepository.deleteByUserIdAndId(42L, 99L)).thenReturn(1);

        Map<String, Object> res = controller.deleteItem(99L, auth);
        assertTrue((Boolean) res.get("success"));
        assertTrue((Boolean) res.get("deleted"));
        assertEquals(99L, res.get("id"));
        verify(historyRepository).deleteByUserIdAndId(42L, 99L);
    }

    @Test
    @DisplayName("clear deletes only AI_TEACHER records for the authenticated user")
    void testClearDeletesOnlyAiTeacherForUser() {
        when(historyRepository.deleteByUserIdAndItemTypeIn(eq(42L), anyCollection())).thenReturn(5);

        Map<String, Object> res = controller.clear(auth);
        assertTrue((Boolean) res.get("success"));
        assertEquals(5, res.get("count"));
        verify(historyRepository).deleteByUserIdAndItemTypeIn(eq(42L), eq(Set.of("AI_TEACHER")));
    }
}
