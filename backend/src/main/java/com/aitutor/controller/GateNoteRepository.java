package com.aitutor.controller;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

public interface GateNoteRepository extends JpaRepository<GateNote, Long> {

    /**
     * Metadata-only projection excluding the LONGBLOB `data` column so listing
     * GATE PDFs never hydrates megabytes of binary payloads into JVM heap.
     */
    interface GateNoteSummary {
        Long getId();
        String getSubjectKey();
        String getFilename();
        String getContentType();
        long getSizeBytes();
        LocalDateTime getUploadedAt();
    }

    @Query("""
        select g.id as id, g.subjectKey as subjectKey, g.filename as filename,
               g.contentType as contentType, g.sizeBytes as sizeBytes, g.uploadedAt as uploadedAt
        from GateNote g
        order by g.subjectKey asc, g.filename asc
        """)
    List<GateNoteSummary> findAllMetadataOrderBySubjectKeyAscFilenameAsc();

    List<GateNote> findAllByOrderBySubjectKeyAscFilenameAsc();
    Optional<GateNote> findByFilename(String filename);
    boolean existsByFilename(String filename);
}
