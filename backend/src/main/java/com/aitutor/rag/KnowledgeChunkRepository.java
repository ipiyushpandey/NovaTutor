package com.aitutor.rag;

import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import java.util.List;

public interface KnowledgeChunkRepository extends JpaRepository<KnowledgeChunk, Long> {
    List<KnowledgeChunk> findAllByDocumentIdOrderByChunkIndex(Long documentId);
    List<KnowledgeChunk> findByDocumentIdOrderByChunkIndex(Long documentId, Pageable pageable);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("delete from KnowledgeChunk c where c.document.id = :documentId")
    void deleteByDocumentId(@Param("documentId") Long documentId);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("delete from KnowledgeChunk c where c.document.id in (select d.id from KnowledgeDocument d where d.owner.id = :ownerId)")
    void deleteByOwnerId(@Param("ownerId") Long ownerId);
}
