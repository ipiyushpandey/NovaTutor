package com.aitutor.rag;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDateTime;
import java.util.*;

public interface KnowledgeDocumentRepository extends JpaRepository<KnowledgeDocument, Long> {

    /**
     * Metadata-only projection excluding the LONGTEXT `extractedText` column
     * so listing and ownership checks never load multi-MB blobs into heap.
     */
    interface DocumentSummary {
        Long getId();
        String getFileName();
        String getContentType();
        long getSizeBytes();
        LocalDateTime getUploadedAt();
        Long getOwnerId();
    }

    @Query("""
        select d.id as id, d.fileName as fileName, d.contentType as contentType,
               d.sizeBytes as sizeBytes, d.uploadedAt as uploadedAt, o.id as ownerId
        from KnowledgeDocument d left join d.owner o
        where o.id = :ownerId
        order by d.uploadedAt desc
        """)
    List<DocumentSummary> findMetadataByOwnerIdOrderByUploadedAtDesc(@Param("ownerId") Long ownerId);

    @Query("""
        select d.id as id, d.fileName as fileName, d.contentType as contentType,
               d.sizeBytes as sizeBytes, d.uploadedAt as uploadedAt, o.id as ownerId
        from KnowledgeDocument d left join d.owner o
        order by d.uploadedAt desc
        """)
    List<DocumentSummary> findAllMetadataOrderByUploadedAtDesc();

    @Query("""
        select d.id as id, d.fileName as fileName, d.contentType as contentType,
               d.sizeBytes as sizeBytes, d.uploadedAt as uploadedAt, o.id as ownerId
        from KnowledgeDocument d left join d.owner o
        where d.id = :id
        """)
    Optional<DocumentSummary> findMetadataById(@Param("id") Long id);

    List<KnowledgeDocument> findAllByOwnerIdOrderByUploadedAtDesc(Long ownerId);
    List<KnowledgeDocument> findAllByOrderByUploadedAtDesc();
    List<KnowledgeDocument> findByOwnerId(Long ownerId);
    Optional<KnowledgeDocument> findByIdAndOwnerId(Long id, Long ownerId);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("delete from KnowledgeDocument d where d.owner.id = :ownerId")
    void deleteByOwnerId(@Param("ownerId") Long ownerId);
}
