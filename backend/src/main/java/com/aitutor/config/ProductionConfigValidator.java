package com.aitutor.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;
import org.springframework.beans.factory.annotation.Value;

/** Fails fast on missing production secrets/configuration. */
@Configuration
@Profile("prod")
public class ProductionConfigValidator {
    public ProductionConfigValidator(
            @Value("${DB_URL:}") String dbUrl,
            @Value("${DB_USERNAME:}") String dbUsername,
            @Value("${DB_PASSWORD:}") String dbPassword,
            @Value("${JWT_SECRET:}") String jwtSecret,
            @Value("${GEMINI_API_KEY:}") String geminiKey,
            @Value("${ADMIN_EMAIL:}") String adminEmail,
            @Value("${ADMIN_PASSWORD:}") String adminPassword,
            @Value("${CORS_ORIGINS:}") String corsOrigins,
            @Value("${CODE_RUNNER_ENABLED:false}") boolean codeRunnerEnabled,
            @Value("${CODE_RUNNER_PRODUCTION_ACK:}") String codeRunnerProductionAck,
            @Value("${app.code-runner.provider:remote}") String codeRunnerProvider) {
        this(dbUrl, dbUsername, dbPassword, jwtSecret, geminiKey, adminEmail, adminPassword,
                corsOrigins, codeRunnerEnabled, codeRunnerProductionAck, codeRunnerProvider,
                "native", true, true);
    }

    @org.springframework.beans.factory.annotation.Autowired
    public ProductionConfigValidator(
            @Value("${DB_URL:}") String dbUrl,
            @Value("${DB_USERNAME:}") String dbUsername,
            @Value("${DB_PASSWORD:}") String dbPassword,
            @Value("${JWT_SECRET:}") String jwtSecret,
            @Value("${GEMINI_API_KEY:}") String geminiKey,
            @Value("${ADMIN_EMAIL:}") String adminEmail,
            @Value("${ADMIN_PASSWORD:}") String adminPassword,
            @Value("${CORS_ORIGINS:}") String corsOrigins,
            @Value("${CODE_RUNNER_ENABLED:false}") boolean codeRunnerEnabled,
            @Value("${CODE_RUNNER_PRODUCTION_ACK:}") String codeRunnerProductionAck,
            @Value("${app.code-runner.provider:remote}") String codeRunnerProvider,
            @Value("${server.forward-headers-strategy:native}") String forwardHeadersStrategy,
            @Value("${app.rate-limit.enabled:true}") boolean rateLimitEnabled,
            @Value("${app.rate-limit.trust-proxy:true}") boolean trustProxy) {
        require("DB_URL", dbUrl);
        require("DB_USERNAME", dbUsername);
        require("DB_PASSWORD", dbPassword);
        require("JWT_SECRET", jwtSecret);
        require("GEMINI_API_KEY", geminiKey);
        require("ADMIN_EMAIL", adminEmail);
        require("ADMIN_PASSWORD", adminPassword);
        require("CORS_ORIGINS", corsOrigins);
        if (jwtSecret.getBytes(java.nio.charset.StandardCharsets.UTF_8).length < 32) {
            throw new IllegalStateException("JWT_SECRET must be at least 32 bytes in production");
        }
        String lowerCors = corsOrigins.toLowerCase(java.util.Locale.ROOT);
        if (lowerCors.contains("*") || lowerCors.contains("localhost") || lowerCors.contains("127.0.0.1")
                || lowerCors.contains("[::1]") || lowerCors.contains("0.0.0.0")) {
            throw new IllegalStateException("CORS_ORIGINS must not contain wildcards or local development origins in production");
        }
        for (String rawOrigin : corsOrigins.split(",")) {
            String origin = rawOrigin.trim().toLowerCase(java.util.Locale.ROOT);
            if (!origin.isBlank() && !origin.startsWith("https://")) {
                throw new IllegalStateException("CORS_ORIGINS entries must use https:// in production");
            }
        }
        if (adminPassword.length() < 12) {
            throw new IllegalStateException("ADMIN_PASSWORD must be at least 12 characters in production");
        }
        if (!rateLimitEnabled) {
            throw new IllegalStateException("app.rate-limit.enabled must remain true in production");
        }
        if (trustProxy && "framework".equalsIgnoreCase(forwardHeadersStrategy == null ? "" : forwardHeadersStrategy.trim())) {
            throw new IllegalStateException(
                    "server.forward-headers-strategy=framework strips X-Forwarded-For and trusts spoofable leftmost IPs; use native with trusted internal-proxies");
        }
        // The acknowledgement guards running containers on the application host
        // (including "auto" which can fall back to local Docker). The remote
        // runner executes submissions in its own isolated sandbox.
        String provider = codeRunnerProvider == null ? "" : codeRunnerProvider.trim().toLowerCase(java.util.Locale.ROOT);
        boolean mayUseLocalDocker = "docker".equals(provider) || "auto".equals(provider);
        if (codeRunnerEnabled && mayUseLocalDocker && !"I_UNDERSTAND_SANDBOX_RISK".equals(codeRunnerProductionAck)) {
            throw new IllegalStateException("CODE_RUNNER_PRODUCTION_ACK must equal I_UNDERSTAND_SANDBOX_RISK before enabling the production sandbox");
        }
    }

    private static void require(String name, String value) {
        if (value == null || value.isBlank()) throw new IllegalStateException(name + " must be configured in the prod profile");
    }
}
