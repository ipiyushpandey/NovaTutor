package com.aitutor.config;

import com.aitutor.repository.UserRepository;
import com.aitutor.security.JwtAuthenticationFilter;
import com.aitutor.security.JwtService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.crypto.password.PasswordEncoder;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Security regression: unauthenticated access must be 401 (not 403/500),
 * protected endpoints must reject anonymous callers, and public endpoints stay open.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class SecurityConfigTest {

    @Autowired TestRestTemplate rest;
    @Autowired PasswordEncoder encoder;
    @Autowired UserRepository users;
    @Autowired JwtService jwt;

    @Test
    void anonymousProtectedEndpointsReturn401() {
        for (String path : new String[]{
                "/api/auth/me", "/api/dsa/stats", "/api/dsa/problems",
                "/api/progress/1", "/api/analytics/1", "/api/admin/users",
                "/api/community/posts", "/api/users/leaderboard"}) {
            ResponseEntity<String> r = rest.getForEntity(path, String.class);
            assertEquals(HttpStatus.UNAUTHORIZED, r.getStatusCode(), path + " should be 401");
        }
    }

    @Test
    void publicEndpointsStayOpen() {
        assertEquals(HttpStatus.OK, rest.getForEntity("/actuator/health", String.class).getStatusCode());
        assertEquals(HttpStatus.OK, rest.getForEntity("/api/health", String.class).getStatusCode());
        assertEquals(HttpStatus.OK, rest.getForEntity("/api/courses", String.class).getStatusCode());
    }

    @Test
    void validTokenReachesProtectedEndpoint() {
        String email = "sec-test-" + System.currentTimeMillis() + "@test.local";
        users.save(new com.aitutor.entity.User("Sec Test", email, encoder.encode("test123456")));
        String token = jwt.token(email);
        var headers = new org.springframework.http.HttpHeaders();
        headers.setBearerAuth(token);
        ResponseEntity<String> r = rest.exchange("/api/dsa/stats", org.springframework.http.HttpMethod.GET,
                new org.springframework.http.HttpEntity<>(headers), String.class);
        assertEquals(HttpStatus.OK, r.getStatusCode());
        assertTrue(r.getBody().contains("328"));
    }

    @Test
    void garbageTokenIsRejected() {
        var headers = new org.springframework.http.HttpHeaders();
        headers.setBearerAuth("not-a-real-token");
        ResponseEntity<String> r = rest.exchange("/api/dsa/stats", org.springframework.http.HttpMethod.GET,
                new org.springframework.http.HttpEntity<>(headers), String.class);
        assertEquals(HttpStatus.UNAUTHORIZED, r.getStatusCode());
    }
}
