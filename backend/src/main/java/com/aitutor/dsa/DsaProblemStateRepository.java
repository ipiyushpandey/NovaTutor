package com.aitutor.dsa;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface DsaProblemStateRepository extends JpaRepository<DsaProblemState, Long> {

    Optional<DsaProblemState> findByUserIdAndSlug(Long userId, String slug);

    List<DsaProblemState> findByUserId(Long userId);

    long countByUserIdAndStatus(Long userId, String status);

    long countByUserIdAndBookmarkedTrue(Long userId);

    void deleteByUserId(Long userId);
}
