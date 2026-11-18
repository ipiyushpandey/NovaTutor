package com.aitutor.security;

import com.aitutor.controller.ApiException;
import com.aitutor.entity.User;
import com.aitutor.repository.UserRepository;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Service;

@Service
public class AuthenticatedUser {
    private final UserRepository users;
    public AuthenticatedUser(UserRepository users) { this.users = users; }

    public User require(Authentication authentication) {
        if (authentication == null || !authentication.isAuthenticated() || authentication.getName() == null
                || "anonymousUser".equals(authentication.getName())) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "UNAUTHENTICATED", "Login required");
        }
        return users.findByEmail(authentication.getName())
                .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "UNAUTHENTICATED", "Account not found"));
    }

    public void requireSame(Authentication authentication, Long requestedId) {
        User user = require(authentication);
        boolean admin = "ADMIN".equalsIgnoreCase(user.getRole()) || "OWNER".equalsIgnoreCase(user.getRole());
        if (!admin && !user.getId().equals(requestedId)) {
            throw new AccessDeniedException("You can only access your own account data");
        }
    }
}
