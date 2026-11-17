package com.aitutor.chat;
import org.springframework.data.jpa.repository.JpaRepository; import org.springframework.data.jpa.repository.Modifying; import org.springframework.data.jpa.repository.Query; import org.springframework.data.repository.query.Param; import java.util.*;
public interface MessageRepository extends JpaRepository<ChatMessage,Long>{
    @Modifying @Query("delete from ChatMessage m where m.conversation.id in (select c.id from ChatConversation c where c.user.id = :userId)") void deleteByUserId(@Param("userId") Long userId);
    List<ChatMessage> findTop20ByConversationIdOrderByCreatedAtDesc(Long conversationId);
    List<ChatMessage> findByConversationIdOrderByCreatedAtAsc(Long conversationId);
    void deleteByConversationId(Long conversationId);
}
