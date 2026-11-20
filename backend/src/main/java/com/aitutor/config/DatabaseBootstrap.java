package com.aitutor.config;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.BeansException;
import org.springframework.beans.factory.config.BeanPostProcessor;
import org.springframework.stereotype.Component;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.DatabaseMetaData;
import java.sql.ResultSet;
import java.sql.Statement;

/**
 * Pre-JPA database schema safety initializer.
 * Runs immediately upon DataSource initialization, before Hibernate validates or updates entities.
 * Ensures critical new tables (such as learning_history) exist even if the production environment
 * has JPA_DDL_AUTO=validate configured on Render without prior manual SQL migration.
 */
@Component
public class DatabaseBootstrap implements BeanPostProcessor {

    private static final Logger log = LoggerFactory.getLogger(DatabaseBootstrap.class);
    private boolean initialized = false;

    @Override
    public Object postProcessAfterInitialization(Object bean, String beanName) throws BeansException {
        if (bean instanceof DataSource dataSource && !initialized) {
            initialized = true;
            ensureSchemaSafety(dataSource);
        }
        return bean;
    }

    private void ensureSchemaSafety(DataSource dataSource) {
        try (Connection conn = dataSource.getConnection()) {
            DatabaseMetaData meta = conn.getMetaData();
            String dbProduct = meta.getDatabaseProductName();
            log.info("DatabaseBootstrap: Connected to {} - validating schema safety", dbProduct);

            boolean tableExists = false;
            try (ResultSet rs = meta.getTables(conn.getCatalog(), null, "learning_history", null)) {
                if (rs.next()) {
                    tableExists = true;
                }
            }
            if (!tableExists) {
                try (ResultSet rs = meta.getTables(conn.getCatalog(), null, "LEARNING_HISTORY", null)) {
                    if (rs.next()) {
                        tableExists = true;
                    }
                }
            }

            if (!tableExists) {
                log.info("DatabaseBootstrap: Table 'learning_history' missing. Auto-creating table before JPA validation...");
                try (Statement stmt = conn.createStatement()) {
                    stmt.execute("""
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
                            CONSTRAINT fk_history_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                            INDEX idx_history_user_updated (user_id, updated_at),
                            UNIQUE KEY ux_history_user_item (user_id, item_type, item_key)
                        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
                    """);
                    log.info("DatabaseBootstrap: Table 'learning_history' created successfully.");
                } catch (Exception ex) {
                    log.warn("DatabaseBootstrap: Notice during table creation: {}", ex.getMessage());
                }
            } else {
                log.info("DatabaseBootstrap: Table 'learning_history' verified.");
            }
        } catch (Exception e) {
            log.warn("DatabaseBootstrap: Schema safety check skipped: {}", e.getMessage());
        }
    }
}

