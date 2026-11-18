package com.aitutor.intelligence;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import java.util.*;

public interface QuizAttemptRepository extends JpaRepository<QuizAttempt, Long> {
    List<QuizAttempt> findTop100ByUserIdOrderBySubmittedAtDesc(Long userId);
    List<QuizAttempt> findTop200ByUserIdOrderBySubmittedAtDesc(Long userId);
    List<QuizAttempt> findByUserId(Long userId);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("delete from QuizAttempt a where a.user.id = :userId")
    void deleteByUserId(@Param("userId") Long userId);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("delete from QuizAttempt a where a.course.id = :courseId")
    void deleteByCourseId(@Param("courseId") Long courseId);
}
