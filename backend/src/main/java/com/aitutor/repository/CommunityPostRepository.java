package com.aitutor.repository;

import com.aitutor.entity.CommunityPost;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;public interface CommunityPostRepository extends JpaRepository<CommunityPost,Long>{
    java.util.List<CommunityPost> findByUserId(Long userId);
    List<CommunityPost> findTop100ByOrderByCreatedAtDesc();
}
