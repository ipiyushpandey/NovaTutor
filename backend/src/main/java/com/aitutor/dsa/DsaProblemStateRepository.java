package com.aitutor.dsa;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

public interface DsaProblemStateRepository extends JpaRepository<DsaProblemState, Long> {

    Optional<DsaProblemState> findByUserIdAndSlug(Long userId, String slug);

    List<DsaProblemState> findByUserId(Long userId);

    long countByUserIdAndStatus(Long userId, String status);

    long countByUserIdAndBookmarkedTrue(Long userId);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("delete from DsaProblemState s where s.user.id = :userId")
    void deleteByUserId(@Param("userId") Long userId);
}
