package com.aitutor.service;

import com.aitutor.controller.ApiException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;

import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.PublicKey;
import java.security.Signature;
import java.security.spec.RSAPublicKeySpec;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.HashMap;
import java.util.Map;

/**
 * Verifies Google ID tokens locally against Google's published JWKS.
 *
 * Checks, in order: RS256 signature with the key named in the token header,
 * issuer, audience, expiry, and that Google has verified the email. The email
 * claim is therefore trustworthy server-side; the browser never supplies an
 * identity we accept on its word.
 */
@Service
public class GoogleIdTokenVerifier {
    private static final String CERTS_URL = "https://www.googleapis.com/oauth2/v3/certs";
    private static final String[] ISSUERS = {"accounts.google.com", "https://accounts.google.com"};
    private static final long KEY_TTL_SECONDS = 3600;
    private static final long FORCED_REFRESH_COOLDOWN_SECONDS = 60;
    private static final long CLOCK_SKEW_SECONDS = 60;

    private final String clientId;
    private final ObjectMapper mapper;
    private final RestClient http;
    private volatile Map<String, CachedKey> keys = Map.of();
    private volatile long keysFetchedAt = 0;

    public GoogleIdTokenVerifier(@Value("${app.google.client-id:}") String clientId, ObjectMapper mapper) {
        this.clientId = clientId == null ? "" : clientId.trim();
        this.mapper = mapper;
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(Duration.ofSeconds(5));
        factory.setReadTimeout(Duration.ofSeconds(10));
        this.http = RestClient.builder().requestFactory(factory).build();
    }

    public boolean isConfigured() { return !clientId.isBlank(); }
    /** Only the public OAuth client id is exposed; it is not a secret. */
    public String clientId() { return clientId; }

    public GoogleUser verify(String credential) {
        if (!isConfigured()) {
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "GOOGLE_NOT_CONFIGURED",
                    "Google sign-in is not configured on this server yet.");
        }
        if (credential == null || credential.isBlank()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "GOOGLE_TOKEN_MISSING", "Google did not return a sign-in token.");
        }
        try {
            String[] parts = credential.split("\\.");
            if (parts.length != 3) throw new IllegalArgumentException("Malformed token");
            JsonNode header = mapper.readTree(Base64.getUrlDecoder().decode(parts[0]));
            String kid = header.path("kid").asText("");
            String alg = header.path("alg").asText("");
            if (!"RS256".equals(alg)) throw new IllegalArgumentException("Unsupported token algorithm");

            PublicKey key = publicKey(kid);
            if (key == null) {
                refreshKeys(true);
                key = publicKey(kid);
            }
            if (key == null) throw new IllegalArgumentException("Unknown signing key");

            return parseAndVerify(credential, key, clientId, mapper, Instant.now().getEpochSecond());
        } catch (ApiException e) {
            throw e;
        } catch (Exception e) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "GOOGLE_TOKEN_INVALID",
                    "Google sign-in could not be verified. Please try again.");
        }
    }

    /**
     * Pure verification step, package-visible so tests can sign their own token
     * with a locally generated RSA key instead of contacting Google.
     */
    static GoogleUser parseAndVerify(String credential, PublicKey key, String clientId,
                                     ObjectMapper mapper, long nowSeconds) throws Exception {
        String[] parts = credential.split("\\.");
        if (parts.length != 3) throw new IllegalArgumentException("Malformed token");
        Signature signature = Signature.getInstance("SHA256withRSA");
        signature.initVerify(key);
        signature.update((parts[0] + "." + parts[1]).getBytes(StandardCharsets.US_ASCII));
        if (!signature.verify(Base64.getUrlDecoder().decode(parts[2]))) {
            throw new IllegalArgumentException("Bad signature");
        }
        JsonNode claims = mapper.readTree(Base64.getUrlDecoder().decode(parts[1]));

        String issuer = claims.path("iss").asText("");
        boolean issuerOk = false;
        for (String allowed : ISSUERS) if (allowed.equals(issuer)) issuerOk = true;
        if (!issuerOk) throw new IllegalArgumentException("Bad issuer");

        if (!audienceMatches(claims.path("aud"), clientId)) throw new IllegalArgumentException("Bad audience");

        long exp = claims.path("exp").asLong(0);
        if (exp == 0 || exp + CLOCK_SKEW_SECONDS < nowSeconds) throw new IllegalArgumentException("Expired token");
        long iat = claims.path("iat").asLong(0);
        if (iat > nowSeconds + CLOCK_SKEW_SECONDS) throw new IllegalArgumentException("Token issued in the future");

        String email = claims.path("email").asText("").trim().toLowerCase();
        String subject = claims.path("sub").asText("").trim();
        if (email.isEmpty() || subject.isEmpty()) throw new IllegalArgumentException("Missing identity claims");
        if (!claims.path("email_verified").asBoolean(false)) throw new IllegalArgumentException("Email not verified by Google");
        String name = claims.path("name").asText("").trim();
        return new GoogleUser(email, subject, name);
    }

    private static boolean audienceMatches(JsonNode audience, String clientId) {
        if (clientId == null || clientId.isBlank()) return false;
        if (audience.isArray()) {
            for (JsonNode node : audience) if (clientId.equals(node.asText())) return true;
            return false;
        }
        return clientId.equals(audience.asText());
    }

    private PublicKey publicKey(String kid) {
        CachedKey cached = keys.get(kid);
        if (cached != null) return cached.key;
        refreshKeys(false);
        cached = keys.get(kid);
        return cached == null ? null : cached.key;
    }

    private synchronized void refreshKeys(boolean force) {
        long now = Instant.now().getEpochSecond();
        if (!force && now - keysFetchedAt < KEY_TTL_SECONDS && !keys.isEmpty()) return;
        if (force && now - keysFetchedAt < FORCED_REFRESH_COOLDOWN_SECONDS && !keys.isEmpty()) return;
        try {
            String body = http.get().uri(CERTS_URL).retrieve().body(String.class);
            JsonNode root = mapper.readTree(body == null ? "{}" : body);
            Map<String, CachedKey> fresh = new HashMap<>();
            for (JsonNode key : root.path("keys")) {
                if (!"RSA".equals(key.path("kty").asText())) continue;
                BigInteger modulus = new BigInteger(1, Base64.getUrlDecoder().decode(key.path("n").asText()));
                BigInteger exponent = new BigInteger(1, Base64.getUrlDecoder().decode(key.path("e").asText()));
                PublicKey publicKey = KeyFactory.getInstance("RSA")
                        .generatePublic(new RSAPublicKeySpec(modulus, exponent));
                fresh.put(key.path("kid").asText(), new CachedKey(publicKey));
            }
            if (!fresh.isEmpty()) {
                this.keys = Map.copyOf(fresh);
                this.keysFetchedAt = now;
            }
        } catch (Exception ignored) {
            // A transient JWKS outage must not crash the app; verification fails
            // closed with an honest error instead.
        }
    }

    private record CachedKey(PublicKey key) {}
    public record GoogleUser(String email, String subject, String name) {}
}
