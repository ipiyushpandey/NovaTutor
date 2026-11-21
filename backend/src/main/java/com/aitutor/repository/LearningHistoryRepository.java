package com.aitutor.repository;

import com.aitutor.entity.LearningHistory;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface LearningHistoryRepository extends JpaRepository<LearningHistory, Long> {
    List<LearningHistory> findTop50ByUserIdOrderByUpdatedAtDesc(Long userId);

    List<LearningHistory> findTop50ByUserIdAndItemTypeInOrderByUpdatedAtDesc(Long userId, Collection<String> itemTypes);

    List<LearningHistory> findByUserIdOrderByUpdatedAtDesc(Long userId, Pageable pageable);

    Optional<LearningHistory> findByUserIdAndItemTypeAndItemKey(Long userId, String itemType, String itemKey);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("DELETE FROM LearningHistory h WHERE h.user.id = :userId AND h.id = :id")
    int deleteByUserIdAndId(@Param("userId") Long userId, @Param("id") Long id);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("DELETE FROM LearningHistory h WHERE h.user.id = :userId AND h.itemType IN :itemTypes")
    int deleteByUserIdAndItemTypeIn(@Param("userId") Long userId, @Param("itemTypes") Collection<String> itemTypes);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("DELETE FROM LearningHistory h WHERE h.user.id = :userId")
    int deleteByUserId(@Param("userId") Long userId);
}
