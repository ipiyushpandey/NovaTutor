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
import java.util.HashSet;
import java.util.Set;

/**
 * Pre-JPA database schema safety initializer.
 * Runs immediately upon DataSource initialization, before Hibernate validates or updates entities.
 * Ensures critical new tables (such as learning_history) and their required columns exist even
 * if the production environment has JPA_DDL_AUTO=validate configured without prior manual SQL migration.
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

            boolean isMySqlFamily = dbProduct != null && (
                    dbProduct.toLowerCase().contains("mysql") ||
                    dbProduct.toLowerCase().contains("mariadb") ||
                    dbProduct.toLowerCase().contains("tidb")
            );

            String catalog = conn.getCatalog();
            String matchedTableName = findTable(meta, catalog, "learning_history");

            boolean usersExists = findTable(meta, catalog, "users") != null;

            if (matchedTableName == null) {
                log.info("DatabaseBootstrap: Table 'learning_history' missing. Auto-creating table before JPA validation...");
                try (Statement stmt = conn.createStatement()) {
                    StringBuilder ddl = new StringBuilder("""
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
                            PRIMARY KEY (id)
                    """);
                    if (usersExists) {
                        ddl.append(", CONSTRAINT fk_history_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE");
                    }
                    ddl.append(", INDEX idx_history_user_updated (user_id, updated_at)");
                    ddl.append(", UNIQUE KEY ux_history_user_item (user_id, item_type, item_key)");
                    ddl.append(")");
                    if (isMySqlFamily) {
                        ddl.append(" ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
                    }
                    stmt.execute(ddl.toString());
                    log.info("DatabaseBootstrap: Table 'learning_history' created successfully.");
                } catch (Exception ex) {
                    log.warn("DatabaseBootstrap: Notice during table creation: {}", ex.getMessage());
                }
            } else {
                // Table exists: verify column completeness
                verifyAndPatchColumns(conn, meta, catalog, matchedTableName);
                log.info("DatabaseBootstrap: Table 'learning_history' verified with all required columns.");
            }
        } catch (Exception e) {
            log.warn("DatabaseBootstrap: Schema safety check skipped: {}", e.getMessage());
        }
    }

    private String findTable(DatabaseMetaData meta, String catalog, String targetTable) {
        String[] candidates = { targetTable.toLowerCase(), targetTable.toUpperCase(), targetTable };
        for (String candidate : candidates) {
            try (ResultSet rs = meta.getTables(catalog, null, candidate, null)) {
                if (rs.next()) {
                    return candidate;
                }
            } catch (Exception ignored) {}
        }
        return null;
    }

    private void verifyAndPatchColumns(Connection conn, DatabaseMetaData meta, String catalog, String tableName) {
        Set<String> existingColumns = new HashSet<>();
        try (ResultSet rs = meta.getColumns(catalog, null, tableName, null)) {
            while (rs.next()) {
                String col = rs.getString("COLUMN_NAME");
                if (col != null) existingColumns.add(col.toLowerCase());
            }
        } catch (Exception ignored) {}

        try (Statement stmt = conn.createStatement()) {
            if (!existingColumns.contains("category")) {
                stmt.execute("ALTER TABLE " + tableName + " ADD COLUMN category VARCHAR(120) NULL");
            }
            if (!existingColumns.contains("target_route")) {
                stmt.execute("ALTER TABLE " + tableName + " ADD COLUMN target_route VARCHAR(200) NULL");
            }
            if (!existingColumns.contains("content_snapshot")) {
                stmt.execute("ALTER TABLE " + tableName + " ADD COLUMN content_snapshot LONGTEXT NULL");
            }
        } catch (Exception ex) {
            log.warn("DatabaseBootstrap: Notice during column patch on '{}': {}", tableName, ex.getMessage());
        }
    }
}
