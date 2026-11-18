package com.aitutor.chat;

import com.aitutor.entity.User;
import com.aitutor.repository.UserRepository;
import com.aitutor.security.AuthenticatedUser;
import org.springframework.security.core.Authentication;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.*;

@RestController
@RequestMapping("/api/chat")
public class ChatController {
    private final ConversationRepository cr;
    private final MessageRepository mr;
    private final UserRepository ur;
    private final AiServiceBridge ai;
    private final AuthenticatedUser authenticatedUser;

    public ChatController(ConversationRepository c, MessageRepository m, UserRepository u, AiServiceBridge a, AuthenticatedUser au) {
        this.cr = c;
        this.mr = m;
        this.ur = u;
        this.ai = a;
        this.authenticatedUser = au;
    }

    public record NewChat(String title) {}
    public record Send(String message, String topic, String task, String level, String language) {}
    public record ConversationView(Long id, String title, LocalDateTime createdAt, LocalDateTime updatedAt) {}
    public record Item(Long id, String role, String content) {}

    private static ConversationView toView(ChatConversation c) {
        return new ConversationView(c.getId(), c.getTitle(), c.getCreatedAt(), c.getUpdatedAt());
    }

    private User user(Long id) {
        return ur.findById(id).orElseThrow();
    }

    @GetMapping("/conversations/{userId}")
    public List<ConversationView> list(@PathVariable Long userId, Authentication authentication) {
        authenticatedUser.requireSame(authentication, userId);
        return cr.findByUserIdOrderByUpdatedAtDesc(userId).stream()
                .map(ChatController::toView)
                .toList();
    }

    @PostMapping("/conversations/{userId}")
    public ConversationView create(@PathVariable Long userId,
                                   @RequestBody(required = false) NewChat n,
                                   Authentication authentication) {
        authenticatedUser.requireSame(authentication, userId);
        ChatConversation c = new ChatConversation();
        c.setUser(user(userId));
        String title = (n == null || n.title() == null || n.title().isBlank())
                ? "New learning session"
                : n.title().trim();
        if (title.length() > 255) title = title.substring(0, 255);
        c.setTitle(title);
        return toView(cr.save(c));
    }

    @GetMapping("/conversations/{userId}/{id}")
    public List<Item> messages(@PathVariable Long userId,
                               @PathVariable Long id,
                               Authentication authentication) {
        authenticatedUser.requireSame(authentication, userId);
        cr.findByIdAndUserId(id, userId).orElseThrow();
        var x = new ArrayList<>(mr.findTop20ByConversationIdOrderByCreatedAtDesc(id));
        Collections.reverse(x);
        return x.stream().map(m -> new Item(m.getId(), m.getRole().name(), m.getContent())).toList();
    }

    @DeleteMapping("/conversations/{userId}/{id}/messages")
    @Transactional
    public void clear(@PathVariable Long userId,
                      @PathVariable Long id,
                      Authentication authentication) {
        authenticatedUser.requireSame(authentication, userId);
        cr.findByIdAndUserId(id, userId).orElseThrow();
        mr.deleteByConversationId(id);
    }

    @DeleteMapping("/conversations/{userId}")
    @Transactional
    public void deleteHistory(@PathVariable Long userId, Authentication authentication) {
        authenticatedUser.requireSame(authentication, userId);
        mr.deleteByUserId(userId);
        cr.deleteByUserId(userId);
    }

    @PostMapping("/conversations/{userId}/{id}/messages")
    public Item send(@PathVariable Long userId,
                     @PathVariable Long id,
                     @RequestBody Send s,
                     Authentication authentication) {
        authenticatedUser.requireSame(authentication, userId);
        if (s == null || s.message() == null || s.message().isBlank()) {
            throw new IllegalArgumentException("Message cannot be empty");
        }
        ChatConversation c = cr.findByIdAndUserId(id, userId).orElseThrow();
        ChatMessage u = new ChatMessage();
        u.setConversation(c);
        u.setRole(ChatMessage.Role.USER);
        u.setContent(s.message());
        mr.save(u);
        String context = new ArrayList<>(mr.findTop20ByConversationIdOrderByCreatedAtDesc(id)).stream()
                .sorted(Comparator.comparing(ChatMessage::getCreatedAt))
                .map(m -> m.getRole().name() + ": " + m.getContent())
                .reduce((a, b) -> a + "\n" + b)
                .orElse("");
        String ans = ai.ask(
                s.task() == null ? "TUTOR" : s.task(),
                s.topic(),
                s.message(),
                s.level() == null ? "beginner" : s.level(),
                (s.language() == null || s.language().isBlank() ? "English/Hinglish" : s.language()),
                context
        ).answer();
        ChatMessage a = new ChatMessage();
        a.setConversation(c);
        a.setRole(ChatMessage.Role.ASSISTANT);
        a.setContent(ans);
        mr.save(a);
        c.touch();
        cr.save(c);
        return new Item(a.getId(), "ASSISTANT", ans);
    }
}
