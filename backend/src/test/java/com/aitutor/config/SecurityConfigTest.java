package com.aitutor.config;

import com.aitutor.entity.User;
import com.aitutor.repository.UserRepository;
import com.aitutor.security.JwtService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import static org.hamcrest.Matchers.containsString;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Security regression: unauthenticated access must be 401 (not 403/500),
 * protected endpoints must reject anonymous callers, and public endpoints stay open.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class SecurityConfigTest {

    @Autowired MockMvc mvc;
    @Autowired PasswordEncoder encoder;
    @Autowired UserRepository users;
    @Autowired JwtService jwt;

    @Test
    void anonymousProtectedEndpointsReturn401() throws Exception {
        for (String path : new String[]{
                "/api/auth/me", "/api/dsa/stats", "/api/dsa/problems",
                "/api/progress/1", "/api/analytics/1", "/api/admin/users",
                "/api/community/posts", "/api/users/leaderboard"}) {
            mvc.perform(get(path))
                    .andExpect(status().isUnauthorized());
        }
    }

    @Test
    void publicEndpointsStayOpen() throws Exception {
        mvc.perform(get("/actuator/health")).andExpect(status().isOk());
        mvc.perform(get("/api/health")).andExpect(status().isOk());
        mvc.perform(get("/api/courses")).andExpect(status().isOk());
    }

    @Test
    void validTokenReachesProtectedEndpoint() throws Exception {
        String email = "sec-test-" + System.currentTimeMillis() + "@test.local";
        User u = new User("Sec Test", email, encoder.encode("test123456"));
        u.setEmailVerified(true);
        users.save(u);
        String token = jwt.token(email);
        mvc.perform(get("/api/dsa/stats").header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(content().string(containsString("328")));
    }

    @Test
    void garbageTokenIsRejected() throws Exception {
        mvc.perform(get("/api/dsa/stats").header("Authorization", "Bearer not-a-real-token"))
                .andExpect(status().isUnauthorized());
    }
}
