package com.aitutor.security;

import com.aitutor.entity.User;
import io.jsonwebtoken.*;
import io.jsonwebtoken.security.Keys;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.Base64;
import java.util.Date;

/**
 * Signs and verifies NovaTutor access JWTs with:
 * - Password-hash fingerprint (`pwf`) so password change/reset immediately
 *   revokes every previously issued token without requiring a schema change.
 * - Absolute session start (`sid`) so sliding `/api/auth/me` refreshes cannot
 *   extend a session beyond `app.jwt.max-session-ms`.
 */
@Service
public class JwtService {
    private static final String CLAIM_PWF = "pwf";
    private static final String CLAIM_SID = "sid";

    private final SecretKey key;
    private final byte[] secretBytes;
    private final long expMs;
    private final long maxSessionMs;

    public record ParsedToken(String email, String passwordFingerprint, long sessionStartedAtMs, long issuedAtMs, long expiresAtMs) {}

    public JwtService(
            @Value("${app.jwt.secret}") String secret,
            @Value("${app.jwt.expiration-ms}") long expMs,
            @Value("${app.jwt.max-session-ms:604800000}") long maxSessionMs) {
        if (secret == null || secret.isBlank()) {
            throw new IllegalStateException("JWT_SECRET must be configured before starting NovaTutor");
        }
        byte[] bytes = secret.getBytes(StandardCharsets.UTF_8);
        if (bytes.length < 32) {
            throw new IllegalStateException("JWT_SECRET must be at least 32 bytes");
        }
        this.secretBytes = bytes;
        this.key = Keys.hmacShaKeyFor(bytes);
        this.expMs = expMs;
        this.maxSessionMs = Math.max(expMs, maxSessionMs);
    }

    public String token(User user) {
        return token(user, System.currentTimeMillis());
    }

    public String token(User user, long sessionStartedAtMs) {
        long now = System.currentTimeMillis();
        long boundedSessionStart = sessionStartedAtMs > 0 ? Math.min(sessionStartedAtMs, now) : now;
        long absoluteCap = boundedSessionStart + maxSessionMs;
        long expiresAt = Math.min(now + expMs, absoluteCap);
        return Jwts.builder()
                .subject(user.getEmail())
                .claim(CLAIM_PWF, passwordFingerprint(user.getPassword()))
                .claim(CLAIM_SID, boundedSessionStart)
                .issuedAt(new Date(now))
                .expiration(new Date(Math.max(now + 1000L, expiresAt)))
                .signWith(key)
                .compact();
    }

    /** Convenience overload for legacy callers/tests that only have an email. */
    public String token(String email) {
        long now = System.currentTimeMillis();
        return Jwts.builder()
                .subject(email)
                .claim(CLAIM_SID, now)
                .issuedAt(new Date(now))
                .expiration(new Date(now + expMs))
                .signWith(key)
                .compact();
    }

    public ParsedToken parse(String token) {
        Claims claims = Jwts.parser().verifyWith(key).build().parseSignedClaims(token).getPayload();
        String email = claims.getSubject();
        String pwf = claims.get(CLAIM_PWF, String.class);
        long iat = claims.getIssuedAt() != null ? claims.getIssuedAt().getTime() : System.currentTimeMillis();
        long exp = claims.getExpiration() != null ? claims.getExpiration().getTime() : iat + expMs;
        Number sidNum = claims.get(CLAIM_SID, Number.class);
        long sid = sidNum != null ? sidNum.longValue() : iat;
        return new ParsedToken(email, pwf, sid, iat, exp);
    }

    public String email(String token) {
        return parse(token).email();
    }

    public boolean matchesPassword(User user, String tokenPwf) {
        if (user == null || user.getPassword() == null) return false;
        // Tokens minted via token(User) always include pwf; require match when present.
        if (tokenPwf == null || tokenPwf.isBlank()) return false;
        String expected = passwordFingerprint(user.getPassword());
        return MessageDigest.isEqual(
                expected.getBytes(StandardCharsets.UTF_8),
                tokenPwf.getBytes(StandardCharsets.UTF_8));
    }

    public boolean isSessionWithinAbsoluteLimit(long sessionStartedAtMs) {
        long now = Instant.now().toEpochMilli();
        return sessionStartedAtMs > 0 && (now - sessionStartedAtMs) < maxSessionMs;
    }

    /**
     * Avoid unnecessary token rotation on fresh tokens (prevents client bootstrap
     * re-fetch cascades when /auth/me is called seconds after login). Only rotate
     * once at least 25% of the access token TTL has elapsed.
     */
    public boolean shouldRotate(ParsedToken parsed) {
        long now = System.currentTimeMillis();
        long age = Math.max(0L, now - parsed.issuedAtMs());
        return age >= Math.max(60_000L, expMs / 4);
    }

    String passwordFingerprint(String encodedPassword) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            md.update(secretBytes);
            md.update((byte) ':');
            md.update((encodedPassword == null ? "" : encodedPassword).getBytes(StandardCharsets.UTF_8));
            byte[] full = md.digest();
            byte[] prefix = new byte[16];
            System.arraycopy(full, 0, prefix, 0, 16);
            return Base64.getUrlEncoder().withoutPadding().encodeToString(prefix);
        } catch (Exception e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }
}
