-- NovaTutor Learning History Table Migration (TiDB / MySQL 8+ compatible)
-- Supports cross-session persistent learning history and quick resume

CREATE TABLE IF NOT EXISTS learning_history (
    id BIGINT NOT NULL AUTO_INCREMENT,
    user_id BIGINT NOT NULL,
    item_type VARCHAR(40) NOT NULL,
    item_key VARCHAR(120) NOT NULL,
    title VARCHAR(180) NOT NULL,
    category VARCHAR(120) NULL,
    target_route VARCHAR(200) NULL,
    content_snapshot LONGTEXT NULL,
    created_at DATETIME(6) NOT NULL,
    updated_at DATETIME(6) NOT NULL,
    PRIMARY KEY (id),
    INDEX idx_history_user_updated (user_id, updated_at),
    UNIQUE KEY ux_history_user_item (user_id, item_type, item_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
