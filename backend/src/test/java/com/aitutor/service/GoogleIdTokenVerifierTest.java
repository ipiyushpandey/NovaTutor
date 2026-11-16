package com.aitutor.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.Signature;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class GoogleIdTokenVerifierTest {
    private static final String CLIENT_ID = "1234567890-nova.apps.googleusercontent.com";
    private KeyPair keyPair;
    private KeyPair otherKeyPair;
    private ObjectMapper mapper;
    private long now;

    @BeforeEach
    void setUp() throws Exception {
        KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
        generator.initialize(2048);
        keyPair = generator.generateKeyPair();
        otherKeyPair = generator.generateKeyPair();
        mapper = new ObjectMapper();
        now = 1_700_000_000L;
    }

    @Test
    void acceptsAValidVerifiedGoogleToken() throws Exception {
        String token = token(keyPair, claims("accounts.google.com", CLIENT_ID, now + 3600, true));
        GoogleIdTokenVerifier.GoogleUser user =
                GoogleIdTokenVerifier.parseAndVerify(token, keyPair.getPublic(), CLIENT_ID, mapper, now);
        assertEquals("student@example.com", user.email());
        assertEquals("google-sub-123", user.subject());
        assertEquals("Asha Verma", user.name());
    }

    @Test
    void rejectsWrongAudience() throws Exception {
        String token = token(keyPair, claims("accounts.google.com", "someone-else", now + 3600, true));
        assertThrows(IllegalArgumentException.class,
                () -> GoogleIdTokenVerifier.parseAndVerify(token, keyPair.getPublic(), CLIENT_ID, mapper, now));
    }

    @Test
    void rejectsWrongIssuer() throws Exception {
        String token = token(keyPair, claims("https://evil.example.com", CLIENT_ID, now + 3600, true));
        assertThrows(IllegalArgumentException.class,
                () -> GoogleIdTokenVerifier.parseAndVerify(token, keyPair.getPublic(), CLIENT_ID, mapper, now));
    }

    @Test
    void rejectsExpiredToken() throws Exception {
        String token = token(keyPair, claims("https://accounts.google.com", CLIENT_ID, now - 3600, true));
        assertThrows(IllegalArgumentException.class,
                () -> GoogleIdTokenVerifier.parseAndVerify(token, keyPair.getPublic(), CLIENT_ID, mapper, now));
    }

    @Test
    void rejectsUnverifiedEmailClaim() throws Exception {
        String token = token(keyPair, claims("accounts.google.com", CLIENT_ID, now + 3600, false));
        assertThrows(IllegalArgumentException.class,
                () -> GoogleIdTokenVerifier.parseAndVerify(token, keyPair.getPublic(), CLIENT_ID, mapper, now));
    }

    @Test
    void rejectsSignatureFromAnotherKey() throws Exception {
        String token = token(otherKeyPair, claims("accounts.google.com", CLIENT_ID, now + 3600, true));
        assertThrows(IllegalArgumentException.class,
                () -> GoogleIdTokenVerifier.parseAndVerify(token, keyPair.getPublic(), CLIENT_ID, mapper, now));
    }

    @Test
    void rejectsTamperedPayload() throws Exception {
        String token = token(keyPair, claims("accounts.google.com", CLIENT_ID, now + 3600, true));
        String[] parts = token.split("\\.");
        String tampered = parts[0] + "." + parts[1].substring(0, parts[1].length() - 2) + "AA." + parts[2];
        assertThrows(IllegalArgumentException.class,
                () -> GoogleIdTokenVerifier.parseAndVerify(tampered, keyPair.getPublic(), CLIENT_ID, mapper, now));
    }

    @Test
    void handlesAudienceArrays() throws Exception {
        Map<String, Object> claims = claims("accounts.google.com", "other-client", now + 3600, true);
        claims.put("aud", java.util.List.of("other-client", CLIENT_ID));
        String token = token(keyPair, claims);
        assertNotNull(GoogleIdTokenVerifier.parseAndVerify(token, keyPair.getPublic(), CLIENT_ID, mapper, now));
    }

    private Map<String, Object> claims(String issuer, String audience, long exp, boolean emailVerified) {
        Map<String, Object> claims = new LinkedHashMap<>();
        claims.put("iss", issuer);
        claims.put("aud", audience);
        claims.put("sub", "google-sub-123");
        claims.put("email", "Student@Example.com");
        claims.put("email_verified", emailVerified);
        claims.put("name", "Asha Verma");
        claims.put("iat", exp - 3600);
        claims.put("exp", exp);
        return claims;
    }

    private String token(KeyPair pair, Map<String, Object> claims) throws Exception {
        Base64.Encoder encoder = Base64.getUrlEncoder().withoutPadding();
        String header = encoder.encodeToString(
                "{\"alg\":\"RS256\",\"kid\":\"test-key\",\"typ\":\"JWT\"}".getBytes(StandardCharsets.UTF_8));
        String payload = encoder.encodeToString(mapper.writeValueAsBytes(claims));
        String signingInput = header + "." + payload;
        Signature signature = Signature.getInstance("SHA256withRSA");
        signature.initSign(pair.getPrivate());
        signature.update(signingInput.getBytes(StandardCharsets.US_ASCII));
        return signingInput + "." + encoder.encodeToString(signature.sign());
    }
}
