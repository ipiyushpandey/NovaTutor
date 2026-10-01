package com.aitutor.intelligence;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.sql.Date;
import java.time.LocalDate;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class LearningEventAnalyticsServiceTest {
    @Mock LearningEventRepository repository;

    @Test
    void last28DaysAlwaysReturnsExactly28IndiaCalendarDays() {
        var service = new LearningEventAnalyticsService(repository);
        // Use a date inside the 28-day window relative to the real clock so the
        // test stays deterministic instead of time-bombing when the hardcoded
        // date drifts out of the window.
        LocalDate expectedDay = LocalDate.now(LearningEventAnalyticsService.LEARNING_ZONE).minusDays(3);
        when(repository.findDailyActivity(anyLong(), any(), any())).thenReturn(List.of(daily(expectedDay.toString(), 3, 1800, 25)));

        var result = service.last28Days(7L);

        assertEquals(28, result.size());
        assertEquals(3, result.get(expectedDay).count());
        assertTrue(result.values().stream().filter(x -> x.count() > 0).count() <= 28);
    }

    @Test
    void streakUsesRealActiveDatesAndDoesNotCountGeneratedSignals() {
        var service = new LearningEventAnalyticsService(repository);
        when(repository.findActiveDates(7L)).thenReturn(List.of(
                Date.valueOf(LocalDate.now(LearningEventAnalyticsService.LEARNING_ZONE)),
                Date.valueOf(LocalDate.now(LearningEventAnalyticsService.LEARNING_ZONE).minusDays(1)),
                Date.valueOf(LocalDate.now(LearningEventAnalyticsService.LEARNING_ZONE).minusDays(2))
        ));

        assertEquals(3, service.streak(7L));
        assertFalse(LearningEventAnalyticsService.countsAsActivity("DPP_GENERATED"));
        assertFalse(LearningEventAnalyticsService.countsAsActivity("ADAPTIVE_SHOWN"));
        assertTrue(LearningEventAnalyticsService.countsAsActivity("LESSON_COMPLETED"));
    }

    private static LearningEventRepository.DailyActivityProjection daily(String date, long count, long seconds, long xp) {
        return new LearningEventRepository.DailyActivityProjection() {
            public String getActivityDate() { return date; }
            public long getActivityCount() { return count; }
            public long getStudySeconds() { return seconds; }
            public long getXp() { return xp; }
        };
    }
}
