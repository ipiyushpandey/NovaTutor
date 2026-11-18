package com.aitutor.controller;

import com.aitutor.entity.CommunityPost;
import com.aitutor.entity.User;
import com.aitutor.repository.CommunityPostRepository;
import com.aitutor.security.AuthenticatedUser;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import java.util.List;

@RestController
@RequestMapping("/api/community")
public class CommunityController {
    private final CommunityPostRepository posts;
    private final AuthenticatedUser authenticatedUser;

    public CommunityController(CommunityPostRepository posts, AuthenticatedUser authenticatedUser) {
        this.posts = posts;
        this.authenticatedUser = authenticatedUser;
    }

    @GetMapping("/posts")
    public List<Item> posts() {
        return posts.findRecentWithUser(PageRequest.of(0, 100)).stream()
                .map(p -> new Item(p.getId(), p.getUser().getName(), p.getText(), p.getCreatedAt().toString()))
                .toList();
    }

    @PostMapping("/posts")
    public Item create(Authentication authentication,
                       @RequestBody Request request) {
        User user = authenticatedUser.require(authentication);
        if ("GUEST".equalsIgnoreCase(user.getRole())) {
            throw new ApiException(HttpStatus.FORBIDDEN, "GUEST_NOT_ALLOWED",
                    "Sign in with a student account to post in the community.");
        }
        String text = request == null || request.text() == null ? "" : request.text().trim();
        if (text.isBlank()) throw new IllegalArgumentException("Discussion cannot be empty");
        if (text.length() > 4000) throw new IllegalArgumentException("Discussion is too long");
        CommunityPost saved = posts.save(new CommunityPost(user, text));
        return new Item(saved.getId(), user.getName(), saved.getText(), saved.getCreatedAt().toString());
    }

    public record Request(String text) {}
    public record Item(Long id,String author,String text,String createdAt) {}
}
