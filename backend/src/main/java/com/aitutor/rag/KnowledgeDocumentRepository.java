package com.aitutor.rag;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import java.util.*;
public interface KnowledgeDocumentRepository extends JpaRepository<KnowledgeDocument,Long>{
 List<KnowledgeDocument> findAllByOwnerIdOrderByUploadedAtDesc(Long ownerId);
 List<KnowledgeDocument> findAllByOrderByUploadedAtDesc();
 List<KnowledgeDocument> findByOwnerId(Long ownerId);
 Optional<KnowledgeDocument> findByIdAndOwnerId(Long id, Long ownerId);
 @Modifying @Query("delete from KnowledgeDocument d where d.owner.id = :ownerId") void deleteByOwnerId(@Param("ownerId") Long ownerId);
}
