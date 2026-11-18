package com.aitutor.chat;

import com.fasterxml.jackson.annotation.JsonIgnore;
import jakarta.persistence.*;
import java.time.LocalDateTime;

@Entity
@Table(name = "chat_messages", indexes = {@Index(name = "idx_chat_message_conversation", columnList = "conversation_id,createdAt")})
public class ChatMessage {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @JsonIgnore
    @ManyToOne(optional = false)
    private ChatConversation conversation;

    @Enumerated(EnumType.STRING)
    private Role role;

    @Lob
    private String content;

    private LocalDateTime createdAt = LocalDateTime.now();

    public enum Role { USER, ASSISTANT }

    public Long getId() { return id; }
    public ChatConversation getConversation() { return conversation; }
    public void setConversation(ChatConversation c) { conversation = c; }
    public Role getRole() { return role; }
    public void setRole(Role r) { role = r; }
    public String getContent() { return content; }
    public void setContent(String c) { content = c; }
    public LocalDateTime getCreatedAt() { return createdAt; }
}
