package com.aitutor.security;

import com.aitutor.entity.User;
import com.aitutor.repository.UserRepository;
import com.aitutor.service.GuestService;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.time.LocalDateTime;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Validates the NovaTutor JWT once per request and establishes the authenticated
 * user for Spring Security. Enforces active/unblocked/verified status, password
 * fingerprint revocation, absolute session lifetime, guest expiry, and
 * user-path ownership checks.
 */
public class JwtAuthenticationFilter extends OncePerRequestFilter {
    private static final Pattern USER_PATH = Pattern.compile(
            "^/api/(?:users|chat/conversations|progress|analytics|intelligence|adaptive|mentor/state|learning-recommendations|nova-brain|learning/next)/(?<id>\\d+)(?:/|$)"
    );

    private final JwtService jwt;
    private final UserRepository users;
    private final long guestTtlHours;

    public JwtAuthenticationFilter(JwtService jwt, UserRepository users) {
        this(jwt, users, 24L);
    }

    public JwtAuthenticationFilter(JwtService jwt, UserRepository users, long guestTtlHours) {
        this.jwt = jwt;
        this.users = users;
        this.guestTtlHours = Math.max(1L, guestTtlHours);
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String header = request.getHeader("Authorization");
        if (header != null && header.startsWith("Bearer ")) {
            String token = header.substring(7).trim();
            if (!token.isBlank()) {
                try {
                    JwtService.ParsedToken parsed = jwt.parse(token);
                    User user = users.findByEmail(parsed.email()).orElse(null);
                    if (user == null) {
                        unauthorized(response, "Account not found");
                        return;
                    }
                    if (user.isBlocked() || !user.isActive()) {
                        unauthorized(response, "Account is inactive or blocked");
                        return;
                    }
                    if (!user.isEmailVerified()) {
                        unauthorized(response, "Verify your email address to continue");
                        return;
                    }
                    if (!jwt.isSessionWithinAbsoluteLimit(parsed.sessionStartedAtMs())) {
                        unauthorized(response, "Your session has reached its maximum lifetime. Sign in again.");
                        return;
                    }
                    // Revoke tokens immediately after any password change/reset.
                    if (!jwt.matchesPassword(user, parsed.passwordFingerprint())) {
                        unauthorized(response, "Session invalidated. Please sign in again.");
                        return;
                    }
                    if (GuestService.ROLE.equalsIgnoreCase(user.getRole())
                            && user.getCreatedAt() != null
                            && user.getCreatedAt().isBefore(LocalDateTime.now().minusHours(guestTtlHours))) {
                        unauthorized(response, "Guest session has expired. Start a new session.");
                        return;
                    }

                    var authorities = List.of(new SimpleGrantedAuthority("ROLE_" +
                            String.valueOf(user.getRole() == null ? "STUDENT" : user.getRole()).toUpperCase()));
                    var authentication = new UsernamePasswordAuthenticationToken(parsed.email(), null, authorities);
                    authentication.setDetails(user.getId());
                    SecurityContextHolder.getContext().setAuthentication(authentication);

                    Matcher matcher = USER_PATH.matcher(request.getRequestURI());
                    if (matcher.find()) {
                        Long requestedId = Long.valueOf(matcher.group("id"));
                        boolean admin = authorities.stream().anyMatch(a ->
                                "ROLE_ADMIN".equals(a.getAuthority()) || "ROLE_OWNER".equals(a.getAuthority()));
                        if (!admin && !requestedId.equals(user.getId())) {
                            forbidden(response, "You can only access your own account data");
                            return;
                        }
                    }
                } catch (RuntimeException ex) {
                    unauthorized(response, "Invalid or expired session");
                    return;
                }
            }
        }
        chain.doFilter(request, response);
    }

    private void unauthorized(HttpServletResponse response, String message) throws IOException {
        SecurityContextHolder.clearContext();
        response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
        response.setContentType("application/json");
        response.getWriter().write("{\"error\":\"unauthorized\",\"message\":\"" + escapeJson(message) + "\"}");
    }

    private void forbidden(HttpServletResponse response, String message) throws IOException {
        response.setStatus(HttpServletResponse.SC_FORBIDDEN);
        response.setContentType("application/json");
        response.getWriter().write("{\"error\":\"forbidden\",\"message\":\"" + escapeJson(message) + "\"}");
    }

    private static String escapeJson(String value) {
        return value == null ? "" : value.replace("\\", "\\\\").replace("\"", "\\\"");
    }
}
