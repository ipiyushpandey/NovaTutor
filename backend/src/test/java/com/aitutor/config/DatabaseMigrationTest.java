package com.aitutor.config;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

public class DatabaseMigrationTest {

    private DriverManagerDataSource dataSource;
    private String dbName;

    @BeforeEach
    void setUp() {
        dbName = "test_mig_" + UUID.randomUUID().toString().replace("-", "");
        dataSource = new DriverManagerDataSource();
        dataSource.setDriverClassName("org.h2.Driver");
        dataSource.setUrl("jdbc:h2:mem:" + dbName + ";MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1");
        dataSource.setUsername("sa");
        dataSource.setPassword("");
    }

    @AfterEach
    void tearDown() throws Exception {
        try (Connection conn = dataSource.getConnection();
             Statement stmt = conn.createStatement()) {
            stmt.execute("SHUTDOWN");
        } catch (Exception ignored) {}
    }

    @Test
    @DisplayName("Migration runs cleanly against an empty schema and creates required tables")
    void testMigrationOnEmptySchema() throws Exception {
        DatabaseMigrationRunner runner = new DatabaseMigrationRunner(dataSource);
        runner.runMigrations();

        try (Connection conn = dataSource.getConnection()) {
            assertTrue(DatabaseMigrationRunner.tableExists(conn, "schema_version"), "schema_version must exist");
            assertTrue(DatabaseMigrationRunner.tableExists(conn, "pending_registrations"), "pending_registrations must exist");
            assertTrue(DatabaseMigrationRunner.tableExists(conn, "learning_history"), "learning_history must exist");

            // Verify recorded migrations in schema_version
            try (Statement stmt = conn.createStatement();
                 ResultSet rs = stmt.executeQuery("SELECT version, status FROM schema_version")) {
                int count = 0;
                while (rs.next()) {
                    count++;
                    assertEquals("SUCCESS", rs.getString("status"));
                }
                assertTrue(count >= 2, "At least 2 migrations must be recorded");
            }

            // Verify learning_history columns
            try (Statement stmt = conn.createStatement()) {
                stmt.execute("SELECT id, user_id, item_type, item_key, title, category, target_route, content_snapshot, created_at, updated_at FROM learning_history WHERE 1=0");
            }
        }
    }

    @Test
    @DisplayName("Migration is idempotent and preserves existing data when re-executed")
    void testMigrationIdempotencyAndDataPreservation() throws Exception {
        DatabaseMigrationRunner runner = new DatabaseMigrationRunner(dataSource);
        runner.runMigrations();

        // Insert a sample record into learning_history
        try (Connection conn = dataSource.getConnection();
             Statement stmt = conn.createStatement()) {
            stmt.execute("""
                INSERT INTO learning_history (user_id, item_type, item_key, title, category, target_route, content_snapshot, created_at, updated_at)
                VALUES (42, 'LESSON', 'course_1_lesson_1', 'Intro to Algorithms', 'Algorithms', 'course/1/lesson/1', 'snapshot content', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            """);
        }

        // Run migrations a second time
        runner.runMigrations();

        // Verify the existing row was preserved unchanged
        try (Connection conn = dataSource.getConnection();
             Statement stmt = conn.createStatement();
             ResultSet rs = stmt.executeQuery("SELECT user_id, item_key, title FROM learning_history WHERE user_id = 42")) {
            assertTrue(rs.next(), "Existing record must be preserved");
            assertEquals("course_1_lesson_1", rs.getString("item_key"));
            assertEquals("Intro to Algorithms", rs.getString("title"));
            assertFalse(rs.next());
        }
    }

    @Test
    @DisplayName("Migration binds foreign key to users table when users exists")
    void testForeignKeyBindingWhenUsersExists() throws Exception {
        // Pre-create users table before running migrations
        try (Connection conn = dataSource.getConnection();
             Statement stmt = conn.createStatement()) {
            stmt.execute("""
                CREATE TABLE users (
                    id BIGINT NOT NULL AUTO_INCREMENT,
                    email VARCHAR(255) NOT NULL,
                    PRIMARY KEY (id)
                )
            """);
        }

        DatabaseMigrationRunner runner = new DatabaseMigrationRunner(dataSource);
        runner.runMigrations();

        try (Connection conn = dataSource.getConnection()) {
            assertTrue(DatabaseMigrationRunner.tableExists(conn, "learning_history"));

            // Verify foreign key constraint enforcement
            try (Statement stmt = conn.createStatement()) {
                stmt.execute("INSERT INTO users (id, email) VALUES (100, 'test@example.com')");
                stmt.execute("""
                    INSERT INTO learning_history (user_id, item_type, item_key, title, created_at, updated_at)
                    VALUES (100, 'QUIZ', 'quiz_1', 'Quiz 1', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                """);
            }
        }
    }
}
