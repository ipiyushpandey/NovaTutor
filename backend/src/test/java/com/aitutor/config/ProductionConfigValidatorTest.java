package com.aitutor.config;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class ProductionConfigValidatorTest {
    private static final String SECRET = "01234567890123456789012345678901";

    @Test
    void acceptsSafeProductionConfigurationWithSandboxDisabled() {
        assertDoesNotThrow(() -> new ProductionConfigValidator(
                "jdbc:mysql://db:3306/ai_tutor", "novatutor", "strong-db-password", SECRET,
                "gemini-key", "admin@example.com", "strong-admin-password", "https://app.example.com",
                false, "", "remote"));
    }

    @Test
    void rejectsProductionSandboxWithoutExplicitAcknowledgement() {
        IllegalStateException ex = assertThrows(IllegalStateException.class, () -> new ProductionConfigValidator(
                "jdbc:mysql://db:3306/ai_tutor", "novatutor", "strong-db-password", SECRET,
                "gemini-key", "admin@example.com", "strong-admin-password", "https://app.example.com",
                true, "", "docker"));
        assertTrue(ex.getMessage().contains("CODE_RUNNER_PRODUCTION_ACK"));
    }

    /**
     * The acknowledgement exists because a local Docker runner executes student
     * code on the application host. A remote runner executes it elsewhere, so
     * enabling the judge in production must not require that acknowledgement.
     */
    @Test
    void acceptsRemoteRunnerWithoutSandboxAcknowledgement() {
        assertDoesNotThrow(() -> new ProductionConfigValidator(
                "jdbc:mysql://db:3306/ai_tutor", "novatutor", "strong-db-password", SECRET,
                "gemini-key", "admin@example.com", "strong-admin-password", "https://app.example.com",
                true, "", "remote"));
    }

    @Test
    void rejectsLocalCorsInProduction() {
        assertThrows(IllegalStateException.class, () -> new ProductionConfigValidator(
                "jdbc:mysql://db:3306/ai_tutor", "novatutor", "strong-db-password", SECRET,
                "gemini-key", "admin@example.com", "strong-admin-password", "http://localhost:5173",
                false, "", "remote"));
    }

    @Test
    void rejectsWildcardCorsInProduction() {
        assertThrows(IllegalStateException.class, () -> new ProductionConfigValidator(
                "jdbc:mysql://db:3306/ai_tutor", "novatutor", "strong-db-password", SECRET,
                "gemini-key", "admin@example.com", "strong-admin-password", "*",
                false, "", "remote"));
    }

    @Test
    void rejectsAutoCodeRunnerWithoutSandboxAck() {
        assertThrows(IllegalStateException.class, () -> new ProductionConfigValidator(
                "jdbc:mysql://db:3306/ai_tutor", "novatutor", "strong-db-password", SECRET,
                "gemini-key", "admin@example.com", "strong-admin-password", "https://app.example.com",
                true, "", "auto"));
    }

    @Test
    void rejectsFrameworkForwardHeadersWhenTrustProxyIsEnabled() {
        IllegalStateException ex = assertThrows(IllegalStateException.class, () -> new ProductionConfigValidator(
                "jdbc:mysql://db:3306/ai_tutor", "novatutor", "strong-db-password", SECRET,
                "gemini-key", "admin@example.com", "strong-admin-password", "https://app.example.com",
                false, "", "remote", "framework", true, true));
        assertTrue(ex.getMessage().contains("forward-headers-strategy"));
    }

    @Test
    void rejectsPlainHttpAndUppercaseLocalhostCorsAndDisabledRateLimit() {
        assertThrows(IllegalStateException.class, () -> new ProductionConfigValidator(
                "jdbc:mysql://db:3306/ai_tutor", "novatutor", "strong-db-password", SECRET,
                "gemini-key", "admin@example.com", "strong-admin-password", "http://app.example.com",
                false, "", "remote", "native", true, true));
        assertThrows(IllegalStateException.class, () -> new ProductionConfigValidator(
                "jdbc:mysql://db:3306/ai_tutor", "novatutor", "strong-db-password", SECRET,
                "gemini-key", "admin@example.com", "strong-admin-password", "https://LOCALHOST:5173",
                false, "", "remote", "native", true, true));
        assertThrows(IllegalStateException.class, () -> new ProductionConfigValidator(
                "jdbc:mysql://db:3306/ai_tutor", "novatutor", "strong-db-password", SECRET,
                "gemini-key", "admin@example.com", "strong-admin-password", "https://app.example.com",
                false, "", "remote", "native", false, true));
    }
}
