package com.aitutor.service;

import com.aitutor.chat.ChatConversation;
import com.aitutor.chat.ConversationRepository;
import com.aitutor.chat.MessageRepository;
import com.aitutor.dsa.DsaProblemStateRepository;
import com.aitutor.entity.User;
import com.aitutor.intelligence.LearningEventRepository;
import com.aitutor.intelligence.QuizAttemptRepository;
import com.aitutor.rag.KnowledgeChunkRepository;
import com.aitutor.rag.KnowledgeDocumentRepository;
import com.aitutor.repository.CommunityPostRepository;
import com.aitutor.repository.ProgressRepository;
import com.aitutor.repository.UserRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Single cascade used by admin deletion and guest cleanup. Keeping one
 * implementation prevents the two paths from drifting and leaving orphans
 * that make a later user delete fail on a foreign-key constraint.
 */
@Service
public class UserDataCleanupService {
    private final UserRepository users;
    private final ConversationRepository conversations;
    private final MessageRepository messages;
    private final ProgressRepository progress;
    private final LearningEventRepository learningEvents;
    private final QuizAttemptRepository attempts;
    private final DsaProblemStateRepository dsaStates;
    private final CommunityPostRepository communityPosts;
    private final KnowledgeDocumentRepository knowledgeDocs;
    private final KnowledgeChunkRepository knowledgeChunks;
    private final com.aitutor.repository.LearningHistoryRepository learningHistory;

    public UserDataCleanupService(UserRepository users, ConversationRepository conversations,
                                  MessageRepository messages, ProgressRepository progress,
                                  LearningEventRepository learningEvents, QuizAttemptRepository attempts,
                                  DsaProblemStateRepository dsaStates, CommunityPostRepository communityPosts,
                                  KnowledgeDocumentRepository knowledgeDocs, KnowledgeChunkRepository knowledgeChunks,
                                  com.aitutor.repository.LearningHistoryRepository learningHistory) {
        this.users = users;
        this.conversations = conversations;
        this.messages = messages;
        this.progress = progress;
        this.learningEvents = learningEvents;
        this.attempts = attempts;
        this.dsaStates = dsaStates;
        this.communityPosts = communityPosts;
        this.knowledgeDocs = knowledgeDocs;
        this.knowledgeChunks = knowledgeChunks;
        this.learningHistory = learningHistory;
    }

    /**
     * Every dependent row is removed with a bulk statement rather than loading
     * entities. Loading them kept managed children pointing at the user row and
     * made Hibernate fail at commit with a TransientObjectException (the real
     * cause of the admin "Something went wrong" deletion error).
     */
    @Transactional
    public void deleteUserAndData(User user) {
        Long userId = user.getId();
        messages.deleteByUserId(userId);
        conversations.deleteByUserId(userId);
        progress.deleteByUserId(userId);
        learningEvents.deleteByUserId(userId);
        learningHistory.deleteByUserId(userId);
        attempts.deleteByUserId(userId);
        dsaStates.deleteByUserId(userId);
        communityPosts.deleteByUserId(userId);
        knowledgeChunks.deleteByOwnerId(userId);
        knowledgeDocs.deleteByOwnerId(userId);
        users.deleteById(userId);
    }
}
