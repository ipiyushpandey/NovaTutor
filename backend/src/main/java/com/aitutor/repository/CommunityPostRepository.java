package com.aitutor.repository;

import com.aitutor.entity.CommunityPost;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import java.util.List;public interface CommunityPostRepository extends JpaRepository<CommunityPost,Long>{
    java.util.List<CommunityPost> findByUserId(Long userId);
    @Modifying @Query("delete from CommunityPost p where p.user.id = :userId") void deleteByUserId(@Param("userId") Long userId);
    List<CommunityPost> findTop100ByOrderByCreatedAtDesc();
}
