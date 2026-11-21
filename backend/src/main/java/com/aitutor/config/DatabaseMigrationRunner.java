package com.aitutor.config;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.InitializingBean;
import org.springframework.core.io.Resource;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;
import org.springframework.stereotype.Component;

import javax.sql.DataSource;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.sql.*;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Reliable, versioned database migration runner.
 * Executes versioned SQL migrations (from classpath:db/migration/V*.sql)
 * before Hibernate validates or updates entities.
 *
 * Tracks applied migrations in the schema_version table.
 * Idempotent, safe for existing data, compatible with MySQL 8, TiDB, and H2.
 * Fails fast with an IllegalStateException if required schema migration fails.
 */
@Component("databaseMigrationRunner")
public class DatabaseMigrationRunner implements InitializingBean {

    private static final Logger log = LoggerFactory.getLogger(DatabaseMigrationRunner.class);
    private static final Pattern VERSION_PATTERN = Pattern.compile("^(V[0-9_]+)__(.+)\\.sql$");

    private final DataSource dataSource;

    public DatabaseMigrationRunner(DataSource dataSource) {
        this.dataSource = dataSource;
    }

    @Override
    public void afterPropertiesSet() throws Exception {
        runMigrations();
    }

    public synchronized void runMigrations() {
        log.info("DatabaseMigrationRunner: Starting database schema migration check...");
        try (Connection conn = dataSource.getConnection()) {
            DatabaseMetaData meta = conn.getMetaData();
            String dbProduct = meta.getDatabaseProductName();
            log.info("DatabaseMigrationRunner: Connected to {} ({})", dbProduct, meta.getDatabaseProductVersion());

            // 1. Ensure version tracking table exists
            initSchemaVersionTable(conn);

            // 2. Load and sort migration scripts from classpath
            List<MigrationScript> scripts = discoverMigrationScripts();
            log.info("DatabaseMigrationRunner: Discovered {} migration script(s)", scripts.size());

            // 3. Get already applied versions
            Set<String> appliedVersions = getAppliedVersions(conn);

            // 4. Execute pending migrations in version order
            for (MigrationScript script : scripts) {
                if (appliedVersions.contains(script.version)) {
                    log.info("DatabaseMigrationRunner: Migration {} already applied. Skipping.", script.version);
                    continue;
                }

                long start = System.currentTimeMillis();
                log.info("DatabaseMigrationRunner: Applying migration {} ({})", script.version, script.description);
                executeMigration(conn, script);
                long elapsed = System.currentTimeMillis() - start;

                recordMigrationSuccess(conn, script.version, script.description, elapsed);
                log.info("DatabaseMigrationRunner: Migration {} applied successfully in {} ms.", script.version, elapsed);
            }

            // 5. Schema verification guarantee: ensure critical learning_history table and columns exist
            verifyLearningHistoryCompleteness(conn);

            log.info("DatabaseMigrationRunner: All database schema migrations verified successfully.");
        } catch (SQLException e) {
            String msg = "DatabaseMigrationRunner: Schema migration failed: " + e.getMessage();
            log.error(msg, e);
            throw new IllegalStateException(msg, e);
        } catch (Exception e) {
            String msg = "DatabaseMigrationRunner: Unexpected error during migration: " + e.getMessage();
            log.error(msg, e);
            throw new IllegalStateException(msg, e);
        }
    }

    private void initSchemaVersionTable(Connection conn) throws SQLException {
        String sql = """
            CREATE TABLE IF NOT EXISTS schema_version (
                version VARCHAR(100) NOT NULL PRIMARY KEY,
                description VARCHAR(255) NOT NULL,
                installed_on TIMESTAMP NOT NULL,
                execution_time_ms BIGINT NOT NULL,
                status VARCHAR(30) NOT NULL
            )
        """;
        try (Statement stmt = conn.createStatement()) {
            stmt.execute(sql);
        }
    }

    private Set<String> getAppliedVersions(Connection conn) throws SQLException {
        Set<String> applied = new HashSet<>();
        String sql = "SELECT version FROM schema_version WHERE status = 'SUCCESS'";
        try (Statement stmt = conn.createStatement();
             ResultSet rs = stmt.executeQuery(sql)) {
            while (rs.next()) {
                applied.add(rs.getString("version"));
            }
        }
        return applied;
    }

    private void recordMigrationSuccess(Connection conn, String version, String description, long executionTimeMs) throws SQLException {
        String sql = """
            INSERT INTO schema_version (version, description, installed_on, execution_time_ms, status)
            VALUES (?, ?, CURRENT_TIMESTAMP, ?, 'SUCCESS')
            ON DUPLICATE KEY UPDATE status = 'SUCCESS', execution_time_ms = VALUES(execution_time_ms)
        """;
        try {
            try (PreparedStatement pstmt = conn.prepareStatement(sql)) {
                pstmt.setString(1, version);
                pstmt.setString(2, description);
                pstmt.setLong(3, executionTimeMs);
                pstmt.executeUpdate();
            }
        } catch (SQLException e) {
            // Fallback for databases without ON DUPLICATE KEY (e.g. standard H2 / PostgreSQL)
            String fallbackDelete = "DELETE FROM schema_version WHERE version = ?";
            try (PreparedStatement delStmt = conn.prepareStatement(fallbackDelete)) {
                delStmt.setString(1, version);
                delStmt.executeUpdate();
            }
            String fallbackInsert = "INSERT INTO schema_version (version, description, installed_on, execution_time_ms, status) VALUES (?, ?, CURRENT_TIMESTAMP, ?, 'SUCCESS')";
            try (PreparedStatement insStmt = conn.prepareStatement(fallbackInsert)) {
                insStmt.setString(1, version);
                insStmt.setString(2, description);
                insStmt.setLong(3, executionTimeMs);
                insStmt.executeUpdate();
            }
        }
    }

    private void executeMigration(Connection conn, MigrationScript script) throws SQLException {
        List<String> statements = parseStatements(script.content);
        for (String rawStmt : statements) {
            String stmtStr = rawStmt.trim();
            if (stmtStr.isEmpty()) continue;

            // Conditional execution for table-dependent ALTER statements
            if (stmtStr.toUpperCase().startsWith("ALTER TABLE DSA_PROBLEM_STATE")) {
                if (!tableExists(conn, "dsa_problem_state")) {
                    log.info("DatabaseMigrationRunner: Skipping '{}' because table dsa_problem_state does not exist yet.", stmtStr);
                    continue;
                }
            }

            try (Statement stmt = conn.createStatement()) {
                stmt.execute(stmtStr);
            } catch (SQLException e) {
                // If table already exists or column already exists, treat idempotently
                String err = e.getMessage().toLowerCase();
                if (err.contains("already exists") || err.contains("duplicate column")) {
                    log.info("DatabaseMigrationRunner: Idempotent notice for statement: {}", e.getMessage());
                } else {
                    log.error("DatabaseMigrationRunner: Error executing SQL statement in {}:\n{}\nCause: {}", script.version, stmtStr, e.getMessage());
                    throw e;
                }
            }
        }
    }

    private void verifyLearningHistoryCompleteness(Connection conn) throws SQLException {
        if (!tableExists(conn, "learning_history")) {
            log.info("DatabaseMigrationRunner: Table 'learning_history' does not exist yet; creating it now...");
            String ddl = """
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
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            """;
            try (Statement stmt = conn.createStatement()) {
                stmt.execute(ddl);
            }
        }

        // Verify all required columns: fast check with 0-row query prevents slow JDBC DatabaseMetaData calls
        boolean columnsComplete = false;
        try (Statement stmt = conn.createStatement()) {
            stmt.execute("SELECT id, user_id, item_type, item_key, title, category, target_route, content_snapshot, created_at, updated_at FROM learning_history WHERE 1=0");
            columnsComplete = true;
        } catch (SQLException ignored) {}

        if (!columnsComplete) {
            Set<String> columns = getColumnNames(conn, "learning_history");
            try (Statement stmt = conn.createStatement()) {
                if (!columns.contains("category")) {
                    stmt.execute("ALTER TABLE learning_history ADD COLUMN category VARCHAR(120) NULL");
                    log.info("DatabaseMigrationRunner: Added missing column 'category' to learning_history.");
                }
                if (!columns.contains("target_route")) {
                    stmt.execute("ALTER TABLE learning_history ADD COLUMN target_route VARCHAR(200) NULL");
                    log.info("DatabaseMigrationRunner: Added missing column 'target_route' to learning_history.");
                }
                if (!columns.contains("content_snapshot")) {
                    stmt.execute("ALTER TABLE learning_history ADD COLUMN content_snapshot LONGTEXT NULL");
                    log.info("DatabaseMigrationRunner: Added missing column 'content_snapshot' to learning_history.");
                }
                if (!columns.contains("created_at")) {
                    stmt.execute("ALTER TABLE learning_history ADD COLUMN created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)");
                    log.info("DatabaseMigrationRunner: Added missing column 'created_at' to learning_history.");
                }
                if (!columns.contains("updated_at")) {
                    stmt.execute("ALTER TABLE learning_history ADD COLUMN updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)");
                    log.info("DatabaseMigrationRunner: Added missing column 'updated_at' to learning_history.");
                }
            }
        }

        // Check foreign key: ensure referenced 'users' table exists before adding foreign key
        if (tableExists(conn, "users")) {
            try (Statement stmt = conn.createStatement()) {
                stmt.execute("ALTER TABLE learning_history ADD CONSTRAINT fk_history_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE");
                log.info("DatabaseMigrationRunner: Added fk_history_user constraint to learning_history.");
            } catch (SQLException ex) {
                String msg = ex.getMessage() != null ? ex.getMessage().toLowerCase() : "";
                if (msg.contains("duplicate") || msg.contains("already exists") || msg.contains("errno: 121") || ex.getErrorCode() == 1826 || ex.getErrorCode() == 1022) {
                    log.debug("DatabaseMigrationRunner: Foreign key fk_history_user already present.");
                } else {
                    log.warn("DatabaseMigrationRunner: Could not add fk_history_user constraint: {}", ex.getMessage());
                }
            }
        } else {
            log.info("DatabaseMigrationRunner: Referenced table 'users' does not exist yet; fk_history_user constraint will be attached once users table is created.");
        }

        // Final assertion: ensure table exists
        if (!tableExists(conn, "learning_history")) {
            throw new IllegalStateException("DatabaseMigrationRunner: Schema validation failed - table 'learning_history' is missing!");
        }
    }

    public static boolean tableExists(Connection conn, String tableName) {
        try (Statement stmt = conn.createStatement()) {
            stmt.execute("SELECT 1 FROM " + tableName + " WHERE 1=0");
            return true;
        } catch (SQLException e) {
            String sqlState = e.getSQLState();
            int errorCode = e.getErrorCode();
            String msg = e.getMessage() != null ? e.getMessage().toLowerCase() : "";
            // MySQL 1146, H2 42102, ANSI SQLState 42S02
            if (errorCode == 1146 || "42S02".equalsIgnoreCase(sqlState) || "42102".equalsIgnoreCase(sqlState)
                    || msg.contains("not found") || msg.contains("doesn't exist")) {
                return false;
            }
            // Scoped fallback to current catalog and schema only
            try {
                DatabaseMetaData meta = conn.getMetaData();
                String catalog = conn.getCatalog();
                String schema = conn.getSchema();
                for (String c : new String[]{tableName, tableName.toLowerCase(), tableName.toUpperCase()}) {
                    try (ResultSet rs = meta.getTables(catalog, schema, c, new String[]{"TABLE"})) {
                        if (rs.next()) return true;
                    }
                }
            } catch (Exception ignored) {}
            return false;
        }
    }

    private static Set<String> getColumnNames(Connection conn, String tableName) {
        Set<String> cols = new HashSet<>();
        try {
            DatabaseMetaData meta = conn.getMetaData();
            String catalog = conn.getCatalog();
            String schema = conn.getSchema();
            try (ResultSet rs = meta.getColumns(catalog, schema, tableName, null)) {
                while (rs.next()) {
                    String col = rs.getString("COLUMN_NAME");
                    if (col != null) cols.add(col.toLowerCase());
                }
            }
            if (cols.isEmpty()) {
                try (ResultSet rs = meta.getColumns(null, null, tableName, null)) {
                    while (rs.next()) {
                        String col = rs.getString("COLUMN_NAME");
                        if (col != null) cols.add(col.toLowerCase());
                    }
                }
            }
        } catch (Exception ignored) {}
        return cols;
    }

    private static boolean hasForeignKey(Connection conn, String tableName, String fkName) {
        try {
            DatabaseMetaData meta = conn.getMetaData();
            String catalog = conn.getCatalog();
            String schema = conn.getSchema();
            try (ResultSet rs = meta.getImportedKeys(catalog, schema, tableName)) {
                while (rs.next()) {
                    String name = rs.getString("FK_NAME");
                    if (name != null && name.equalsIgnoreCase(fkName)) return true;
                }
            }
            try (ResultSet rs = meta.getImportedKeys(null, null, tableName)) {
                while (rs.next()) {
                    String name = rs.getString("FK_NAME");
                    if (name != null && name.equalsIgnoreCase(fkName)) return true;
                }
            }
        } catch (Exception ignored) {}
        return false;
    }

    private List<MigrationScript> discoverMigrationScripts() {
        List<MigrationScript> list = new ArrayList<>();
        try {
            PathMatchingResourcePatternResolver resolver = new PathMatchingResourcePatternResolver();
            Resource[] resources = resolver.getResources("classpath*:db/migration/V*.sql");
            for (Resource r : resources) {
                String filename = r.getFilename();
                if (filename == null) continue;
                Matcher m = VERSION_PATTERN.matcher(filename);
                if (m.matches()) {
                    String version = m.group(1);
                    String description = m.group(2).replace('_', ' ');
                    String content;
                    try (BufferedReader reader = new BufferedReader(new InputStreamReader(r.getInputStream(), StandardCharsets.UTF_8))) {
                        StringBuilder sb = new StringBuilder();
                        String line;
                        while ((line = reader.readLine()) != null) {
                            sb.append(line).append("\n");
                        }
                        content = sb.toString();
                    }
                    list.add(new MigrationScript(version, description, content, filename));
                }
            }
        } catch (Exception e) {
            log.warn("DatabaseMigrationRunner: Error discovering migration scripts: {}", e.getMessage());
        }
        list.sort(Comparator.comparing(a -> a.version));
        return list;
    }

    private List<String> parseStatements(String sql) {
        List<String> statements = new ArrayList<>();
        StringBuilder current = new StringBuilder();
        for (String line : sql.split("\n")) {
            String trimmed = line.trim();
            if (trimmed.startsWith("--") || trimmed.startsWith("//")) {
                continue;
            }
            current.append(line).append("\n");
            if (trimmed.endsWith(";")) {
                String stmt = current.toString().trim();
                if (stmt.endsWith(";")) {
                    stmt = stmt.substring(0, stmt.length() - 1).trim();
                }
                if (!stmt.isEmpty()) {
                    statements.add(stmt);
                }
                current.setLength(0);
            }
        }
        String remaining = current.toString().trim();
        if (!remaining.isEmpty()) {
            if (remaining.endsWith(";")) {
                remaining = remaining.substring(0, remaining.length() - 1).trim();
            }
            if (!remaining.isEmpty()) {
                statements.add(remaining);
            }
        }
        return statements;
    }

    private static class MigrationScript {
        final String version;
        final String description;
        final String content;
        final String filename;

        MigrationScript(String version, String description, String content, String filename) {
            this.version = version;
            this.description = description;
            this.content = content;
            this.filename = filename;
        }
    }
}
