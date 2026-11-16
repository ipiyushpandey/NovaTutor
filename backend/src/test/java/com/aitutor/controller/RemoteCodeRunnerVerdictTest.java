package com.aitutor.controller;

import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;

/**
 * Locks the Judge0 verdict mapping.
 *
 * Judge0 has no dedicated memory-limit status: an over-limit process is killed
 * with SIGKILL and arrives as a runtime-error status (usually NZEC, id 11) with
 * the reported memory pinned to the configured limit. These tests cover the
 * observed provider payloads, including the ambiguous ones that must stay a
 * plain runtime error.
 */
class RemoteCodeRunnerVerdictTest {

    private static final int MEMORY_LIMIT_KB = 262144;

    private final RemoteCodeRunner runner =
            new RemoteCodeRunner("https://judge.invalid", "", 5, 100000, MEMORY_LIMIT_KB);

    @Test
    void mapsProviderKillAtMemoryLimitToMemoryLimit() {
        Map<String, Object> out = result(11, "Exited with error status 137",
                "run.sh: line 1: 3 Killed  /usr/local/python script.py", MEMORY_LIMIT_KB, null);
        assertEquals("MEMORY_LIMIT", out.get("status"));
        assertEquals(-1, out.get("exitCode"));
        assertEquals(MEMORY_LIMIT_KB, out.get("memoryLimitKb"));
    }

    @Test
    void mapsJavaOutOfMemoryReportToMemoryLimit() {
        Map<String, Object> out = result(11, "",
                "Exception in thread \"main\" java.lang.OutOfMemoryError: Java heap space",
                MEMORY_LIMIT_KB, 1);
        assertEquals("MEMORY_LIMIT", out.get("status"));
    }

    @Test
    void ordinaryRuntimeErrorStaysRuntimeError() {
        Map<String, Object> out = result(7, "", "Segmentation fault", 2048, 139);
        assertEquals("RUNTIME_ERROR", out.get("status"));
    }

    @Test
    void exit137WithoutMemoryPressureIsNotMemoryLimit() {
        Map<String, Object> out = result(11, "Exited with error status 137",
                "Killed", 2048, 137);
        assertEquals("RUNTIME_ERROR", out.get("status"));
    }

    @Test
    void ambiguousKillAtLimitWithoutSignalStaysRuntimeError() {
        Map<String, Object> out = result(11, "", "", MEMORY_LIMIT_KB, null);
        assertEquals("RUNTIME_ERROR", out.get("status"));
    }

    @Test
    void timeLimitIsTimeout() {
        assertEquals("TIMEOUT", result(5, "", "", 1024, null).get("status"));
    }

    @Test
    void compilationErrorIsCompileError() {
        Map<String, Object> out = result(6, "", "", 0, 1);
        assertEquals("COMPILE_ERROR", out.get("status"));
    }

    @Test
    void acceptedAndWrongAnswerAreJudgedByNovaTutorOutputComparison() {
        assertEquals("PASSED", result(3, "", "", 1024, 0).get("status"));
        assertEquals("PASSED", result(4, "", "", 1024, 0).get("status"));
    }

    @Test
    void internalProviderFailureIsUnavailableNeverAccepted() {
        Map<String, Object> out = result(13, "internal", "", 0, null);
        assertEquals("RUNNER_UNAVAILABLE", out.get("status"));
        assertNotEquals("PASSED", out.get("status"));
    }

    @Test
    void queuedOrProcessingStatusIsUnavailableNeverAccepted() {
        assertEquals("RUNNER_UNAVAILABLE", result(1, "", "", 0, null).get("status"));
        assertEquals("RUNNER_UNAVAILABLE", result(2, "", "", 0, null).get("status"));
    }

    @Test
    void unknownVerdictFailsClosed() {
        Map<String, Object> out = result(99, "unexpected", "", 0, null);
        assertEquals("RUNTIME_ERROR", out.get("status"));
        assertNotEquals("PASSED", out.get("status"));
    }

    private Map<String, Object> result(int statusId, String message, String stderr,
                                       long memoryKb, Integer exitCode) {
        String json = "{"
                + "\"stdout\":\"\","
                + "\"stderr\":" + quote(stderr) + ","
                + "\"compile_output\":\"\","
                + "\"time\":\"0.10\","
                + "\"memory\":" + memoryKb + ","
                + "\"message\":" + quote(message) + ","
                + "\"exit_code\":" + (exitCode == null ? "null" : exitCode) + ","
                + "\"status\":{\"id\":" + statusId + ",\"description\":\"provider\"}"
                + "}";
        return runner.toResult(RemoteCodeRunner.Json.parse(json), json, System.nanoTime());
    }

    private static String quote(String value) {
        return "\"" + (value == null ? "" : value.replace("\\", "\\\\").replace("\"", "\\\"")) + "\"";
    }
}
