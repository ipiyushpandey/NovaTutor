package com.aitutor.config;

import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Optional;

public interface AppMetaRepository extends JpaRepository<AppMeta,String> {
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT m FROM AppMeta m WHERE m.key = :key")
    Optional<AppMeta> findByKeyForUpdate(@Param("key") String key);
}
