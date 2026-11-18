package com.aitutor.repository;

import com.aitutor.entity.Progress;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.*;
import org.springframework.data.repository.query.Param;
import java.util.*;

public interface ProgressRepository extends JpaRepository<Progress,Long> {
    @Query("select p from Progress p join fetch p.course where p.user.id = :userId")
    List<Progress> findByUserId(@Param("userId") Long userId);
    List<Progress> findByCourseId(Long courseId);
    Optional<Progress> findByUserIdAndCourseId(Long userId,Long courseId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select p from Progress p where p.user.id = :userId and p.course.id = :courseId")
    Optional<Progress> findByUserIdAndCourseIdForUpdate(@Param("userId") Long userId, @Param("courseId") Long courseId);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query(value = """
        INSERT IGNORE INTO progress (user_id, course_id, completed_lessons, total_lessons, percent)
        VALUES (:userId, :courseId, 0, :totalLessons, 0.0)
        """, nativeQuery = true)
    int ensureRowExists(@Param("userId") Long userId, @Param("courseId") Long courseId, @Param("totalLessons") int totalLessons);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("delete from Progress p where p.course.id = :courseId")
    void deleteByCourseId(@Param("courseId") Long courseId);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("delete from Progress p where p.user.id = :userId")
    void deleteByUserId(@Param("userId") Long userId);
}
