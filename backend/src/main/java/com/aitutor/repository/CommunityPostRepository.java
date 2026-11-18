package com.aitutor.repository;

import com.aitutor.entity.CommunityPost;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import java.util.List;

public interface CommunityPostRepository extends JpaRepository<CommunityPost, Long> {
    List<CommunityPost> findByUserId(Long userId);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("delete from CommunityPost p where p.user.id = :userId")
    void deleteByUserId(@Param("userId") Long userId);

    @Query("select p from CommunityPost p join fetch p.user order by p.createdAt desc")
    List<CommunityPost> findRecentWithUser(Pageable pageable);

    List<CommunityPost> findTop100ByOrderByCreatedAtDesc();
}
