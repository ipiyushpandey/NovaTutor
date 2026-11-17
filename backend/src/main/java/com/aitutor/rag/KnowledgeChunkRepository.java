package com.aitutor.rag;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import java.util.List;
public interface KnowledgeChunkRepository extends JpaRepository<KnowledgeChunk,Long>{ List<KnowledgeChunk> findAllByDocumentIdOrderByChunkIndex(Long documentId); @Modifying @Query("delete from KnowledgeChunk c where c.document.owner.id = :ownerId") void deleteByOwnerId(@Param("ownerId") Long ownerId); }
