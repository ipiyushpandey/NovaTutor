package com.aitutor.config;

import com.aitutor.repository.UserRepository;
import com.aitutor.security.JwtAuthenticationFilter;
import com.aitutor.security.JwtService;
import com.aitutor.security.RequestRateLimitFilter;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.context.annotation.*;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.core.env.Environment;
import org.springframework.core.env.Profiles;
import org.springframework.web.cors.*;
import org.springframework.web.filter.CorsFilter;

import java.util.*;

@Configuration
public class SecurityConfig {
    @Bean PasswordEncoder passwordEncoder(){ return new BCryptPasswordEncoder(); }

    @Bean
    JwtAuthenticationFilter jwtAuthenticationFilter(
            JwtService jwt,
            UserRepository users,
            @Value("${app.guest.ttl-hours:24}") long guestTtlHours) {
        return new JwtAuthenticationFilter(jwt, users, guestTtlHours);
    }

    @Bean
    CorsConfigurationSource corsConfigurationSource(
            @Value("${app.cors.allowed-origins:http://localhost:*,http://127.0.0.1:*,http://[::1]:*}") String allowedOrigins,
            Environment environment) {
        CorsConfiguration cors = new CorsConfiguration();
        LinkedHashSet<String> origins = new LinkedHashSet<>();
        for (String raw : allowedOrigins.split(",")) {
            String value = raw.trim();
            if (!value.isBlank()) origins.add(value);
        }
        // Local wildcard origins are allowed only outside production. A production
        // deployment must provide an explicit CORS_ORIGINS allow-list.
        if (!environment.acceptsProfiles(Profiles.of("prod"))) {
            origins.add("http://localhost:*");
            origins.add("http://127.0.0.1:*");
            origins.add("http://[::1]:*");
        }
        cors.setAllowedOriginPatterns(new ArrayList<>(origins));
        cors.setAllowedMethods(List.of("GET","POST","PUT","DELETE","PATCH","OPTIONS"));
        cors.setAllowedHeaders(List.of("Authorization","Content-Type","Accept","Origin"));
        cors.setExposedHeaders(List.of("Authorization"));
        cors.setAllowCredentials(false);
        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", cors);
        return source;
    }


    @Bean
    RequestRateLimitFilter requestRateLimitFilter(
            @Value("${app.rate-limit.enabled:true}") boolean enabled,
            @Value("${app.rate-limit.requests-per-minute:120}") int generalRpm,
            @Value("${app.rate-limit.auth-per-minute:10}") int authRpm,
            @Value("${app.rate-limit.ai-per-minute:20}") int aiRpm,
            @Value("${app.rate-limit.code-per-minute:20}") int codeRpm,
            @Value("${app.rate-limit.upload-per-10-minutes:5}") int upload10m,
            @Value("${app.rate-limit.admin-per-minute:600}") int adminRpm,
            @Value("${app.rate-limit.trust-proxy:false}") boolean trustProxy) {
        return new RequestRateLimitFilter(enabled, generalRpm, authRpm, aiRpm, codeRpm, upload10m, adminRpm, trustProxy);
    }

    @Bean
    org.springframework.boot.web.servlet.FilterRegistrationBean<JwtAuthenticationFilter> disableJwtAutoRegistration(
            JwtAuthenticationFilter filter) {
        var reg = new org.springframework.boot.web.servlet.FilterRegistrationBean<>(filter);
        reg.setEnabled(false);
        return reg;
    }

    @Bean
    org.springframework.boot.web.servlet.FilterRegistrationBean<RequestRateLimitFilter> disableRateLimitAutoRegistration(
            RequestRateLimitFilter filter) {
        var reg = new org.springframework.boot.web.servlet.FilterRegistrationBean<>(filter);
        reg.setEnabled(false);
        return reg;
    }

    @Bean
    SecurityFilterChain filter(HttpSecurity http, @Qualifier("corsConfigurationSource") CorsConfigurationSource corsSource, JwtAuthenticationFilter jwtFilter, RequestRateLimitFilter rateLimitFilter) throws Exception {
        return http
                .csrf(c -> c.disable())
                .cors(c -> c.configurationSource(corsSource))
                .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authorizeHttpRequests(a -> a
                        .requestMatchers(org.springframework.http.HttpMethod.OPTIONS, "/**").permitAll()
                        .requestMatchers("/api/auth/login", "/api/auth/register", "/api/auth/guest", "/api/auth/me",
                                "/api/auth/verify-email", "/api/auth/resend-verification",
                                "/api/auth/forgot-password", "/api/auth/reset-password",
                                "/api/auth/google", "/api/auth/providers",
                                "/api/health", "/actuator/health/**", "/error", "/api/gate-cse/notes/**", "/api/courses", "/api/courses/**").permitAll()
                        .requestMatchers("/api/admin/**").hasRole("ADMIN")
                        .anyRequest().authenticated())
                .exceptionHandling(e -> e
                        .authenticationEntryPoint((request, response, authException) -> {
                            response.setStatus(jakarta.servlet.http.HttpServletResponse.SC_UNAUTHORIZED);
                            response.setContentType("application/json");
                            response.getWriter().write("{\"error\":\"unauthorized\",\"message\":\"Login required\"}");
                        })
                        .accessDeniedHandler((request, response, accessDeniedException) -> {
                            response.setStatus(jakarta.servlet.http.HttpServletResponse.SC_FORBIDDEN);
                            response.setContentType("application/json");
                            response.getWriter().write("{\"error\":\"forbidden\",\"message\":\"Access denied\"}");
                        }))
                .addFilterBefore(jwtFilter, UsernamePasswordAuthenticationFilter.class)
                .addFilterAfter(rateLimitFilter, JwtAuthenticationFilter.class)
                .build();
    }
}
