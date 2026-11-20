-- NovaTutor v2.5 Audit Remediation Migration (TiDB / MySQL 8+ compatible)
-- Apply BEFORE deploying with spring.jpa.hibernate.ddl-auto=validate

CREATE TABLE IF NOT EXISTS pending_registrations (
    id BIGINT NOT NULL AUTO_INCREMENT,
    email VARCHAR(254) NOT NULL,
    name VARCHAR(100) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    token_hash VARCHAR(128) NOT NULL,
    expires_at DATETIME(6) NOT NULL,
    sent_at DATETIME(6) NULL,
    created_at DATETIME(6) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uk_pending_reg_token_hash (token_hash),
    KEY idx_pending_reg_email (email),
    KEY idx_pending_reg_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Widen dsa_problem_state.last_code from TEXT (64 KiB) to MEDIUMTEXT (16 MiB)
-- so large student submissions do not truncate/fail with MySQL error 1406 on TiDB.
-- Note: Checked conditionally if table exists.
