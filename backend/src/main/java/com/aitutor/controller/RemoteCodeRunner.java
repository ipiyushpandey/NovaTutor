package com.aitutor.controller;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Semaphore;
import java.util.concurrent.atomic.LongAdder;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Remote execution provider for deployments where Docker-in-Docker is not
 * available (free PaaS web services cannot run privileged containers).
 *
 * The judge protocol is unchanged: the full generated program is submitted with
 * every test line as stdin and prints one output line per test. Only the
 * execution substrate moves off the application host, so untrusted code never
 * runs inside the Spring Boot process.
 *
 * The provider is a Judge0-compatible API: it compiles and runs the program in
 * its own disposable sandbox, and reports the real verdict, wall time, memory
 * usage and compiler diagnostics. A provider that ignored stdin would make
 * every solution fail, so the contract is verified by
 * backend/scripts/judge-live-check.py before each release.
 */
@Component
public class RemoteCodeRunner {

    /** Judge0 language ids (see /languages on the provider). */
    private static final Map<String, Integer> LANGUAGE_IDS = Map.of(
            "java", 62,
            "python3", 71,
            "cpp", 54,
            "c", 50,
            "javascript", 63,
            "go", 60);

    /** Judge0 verdicts. */
    private static final int ACCEPTED = 3;
    private static final int WRONG_ANSWER = 4;
    private static final int TIME_LIMIT = 5;
    private static final int COMPILATION_ERROR = 6;
    private static final int INTERNAL_ERROR = 13;
    private static final int EXEC_FORMAT_ERROR = 14;

    private static final Pattern STATUS_ID = Pattern.compile("\"status\"\\s*:\\s*\\{[^}]*\"id\"\\s*:\\s*(\\d+)");

    private final HttpClient http = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            .build();
    private final String baseUrl;
    private final String apiKey;
    private final int timeoutSeconds;
    private final int maxCodeChars;
    private final int memoryLimitKb;
    private final Semaphore concurrency = new Semaphore(4);
    private final LongAdder submissions = new LongAdder();
    private final Map<String, LongAdder> verdicts = new ConcurrentHashMap<>();
    private volatile long lastLatencyMs = 0;
    private volatile java.time.Instant lastExecutionAt = null;

    public RemoteCodeRunner(
            @Value("${app.code-runner.remote.url:https://ce.judge0.com}") String baseUrl,
            @Value("${app.code-runner.remote.api-key:}") String apiKey,
            @Value("${app.code-runner.timeout-seconds:5}") int timeoutSeconds,
            @Value("${app.code-runner.remote.max-code-chars:100000}") int maxCodeChars,
            @Value("${app.code-runner.remote.memory-limit-kb:262144}") int memoryLimitKb) {
        String url = baseUrl == null || baseUrl.isBlank() ? "https://ce.judge0.com" : baseUrl.trim();
        this.baseUrl = url.replaceAll("/+$", "");
        this.apiKey = apiKey == null ? "" : apiKey.trim();
        this.timeoutSeconds = Math.max(1, Math.min(15, timeoutSeconds));
        this.maxCodeChars = Math.max(1000, maxCodeChars);
        this.memoryLimitKb = Math.max(32768, Math.min(512000, memoryLimitKb));
    }

    /** Maps a NovaTutor language label to the provider's language id. */
    static Integer languageId(String language) {
        String l = language == null ? "java" : language.trim().toLowerCase(Locale.ROOT);
        return switch (l) {
            case "python", "python3", "py" -> LANGUAGE_IDS.get("python3");
            case "c++", "cpp", "cplusplus" -> LANGUAGE_IDS.get("cpp");
            case "c" -> LANGUAGE_IDS.get("c");
            case "javascript", "js", "node", "nodejs" -> LANGUAGE_IDS.get("javascript");
            case "go", "golang" -> LANGUAGE_IDS.get("go");
            default -> LANGUAGE_IDS.get("java");
        };
    }

    public Map<String, Object> execute(String language, String code, String stdin) {
        long startedAt = System.nanoTime();
        Map<String, Object> result = run(language, code, stdin);
        lastLatencyMs = (System.nanoTime() - startedAt) / 1_000_000;
        lastExecutionAt = java.time.Instant.now();
        submissions.increment();
        String status = String.valueOf(result.getOrDefault("status", "UNKNOWN"));
        verdicts.computeIfAbsent(status, k -> new LongAdder()).increment();
        return result;
    }

    /** Operator-facing health view of the judge provider. No user data. */
    public Map<String, Object> stats() {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("provider", "judge0-compatible");
        out.put("baseUrl", baseUrl);
        out.put("enabled", true);
        out.put("concurrency", 4);
        out.put("activePermitsFree", concurrency.availablePermits());
        out.put("submissions", submissions.sum());
        out.put("lastLatencyMs", lastLatencyMs);
        out.put("lastExecutionAt", lastExecutionAt == null ? null : lastExecutionAt.toString());
        Map<String, Long> byStatus = new LinkedHashMap<>();
        verdicts.forEach((k, v) -> byStatus.put(k, v.sum()));
        out.put("verdicts", byStatus);
        return out;
    }

    private Map<String, Object> run(String language, String code, String stdin) {
        if (code == null || code.isBlank()) throw new IllegalArgumentException("Code is empty");
        if (code.length() > maxCodeChars) throw new IllegalArgumentException("Code is too large for the sandbox");
        Integer languageId = languageId(language);
        if (languageId == null) {
            return Map.of("enabled", true, "status", "UNSUPPORTED_LANGUAGE", "exitCode", -1, "stdout", "",
                    "stderr", "This language is not available in the judge.", "durationMs", 0L, "memoryKb", 0L);
        }
        if (!concurrency.tryAcquire()) {
            return Map.of("enabled", true, "status", "RUNNER_BUSY", "exitCode", -1, "stdout", "",
                    "stderr", "The judge is busy with other submissions. Please retry in a moment.",
                    "durationMs", 0L, "memoryKb", 0L);
        }
        long started = System.nanoTime();
        try {
            Response response = postJson("/submissions?base64_encoded=false&wait=true",
                    submissionBody(languageId, code, stdin == null ? "" : stdin));
            if (response.status == 429) {
                return Map.of("enabled", true, "status", "RUNNER_BUSY", "exitCode", -1, "stdout", "",
                        "stderr", "The judge is rate limiting requests right now. Please retry shortly.",
                        "durationMs", 0L, "memoryKb", 0L);
            }
            if (response.status >= 400) {
                return unavailable("The code execution service rejected the request (HTTP " + response.status + ").");
            }
            Map<String, Object> raw = Json.parse(response.body);
            if (statusIdOf(response.body) == null) return unavailable("The code execution service returned an unexpected response.");
            return toResult(raw, response.body, started);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return Map.of("enabled", true, "status", "INTERRUPTED", "exitCode", -1, "stdout", "",
                    "stderr", "Execution was interrupted.", "durationMs", 0L, "memoryKb", 0L);
        } catch (RuntimeException e) {
            return unavailable("The code execution service is temporarily unavailable. Please retry.");
        } finally {
            concurrency.release();
        }
    }

    private Map<String, Object> unavailable(String message) {
        return Map.of("enabled", true, "status", "RUNNER_UNAVAILABLE", "exitCode", -1, "stdout", "",
                "stderr", message, "durationMs", 0L, "memoryKb", 0L);
    }

    private String submissionBody(int languageId, String code, String stdin) {
        StringBuilder sb = new StringBuilder(256 + code.length() + stdin.length());
        sb.append('{')
          .append("\"source_code\":").append(quote(code)).append(',')
          .append("\"language_id\":").append(languageId).append(',')
          .append("\"stdin\":").append(quote(stdin)).append(',')
          .append("\"cpu_time_limit\":").append(timeoutSeconds).append(',')
          .append("\"wall_time_limit\":").append(timeoutSeconds + 5).append(',')
          .append("\"memory_limit\":").append(memoryLimitKb);
        if (!apiKey.isEmpty()) sb.append(",\"api_key\":").append(quote(apiKey));
        return sb.append('}').toString();
    }

    /** Maps the provider verdict onto the contract used by the judge and the UI. */
    private Map<String, Object> toResult(Map<String, Object> raw, String body, long startedNanos) {
        long providerMs = Math.round(seconds(raw.get("time")) * 1000);
        long durationMs = providerMs > 0 ? providerMs : Math.max(0, (System.nanoTime() - startedNanos) / 1_000_000);
        long memoryKb = Math.round(number(raw.get("memory")));

        Integer id = statusIdOf(body);
        String stdout = limit(str(raw.get("stdout")));
        String stderr = limit(str(raw.get("stderr")));
        String compileOutput = limit(str(raw.get("compile_output")));
        String message = str(raw.get("message"));
        Integer exitCode = raw.get("exit_code") == null ? null : (int) Math.round(number(raw.get("exit_code")));

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("enabled", true);
        out.put("durationMs", durationMs);
        out.put("memoryKb", memoryKb);

        int verdict = id == null ? -1 : id;
        if (verdict == COMPILATION_ERROR) {
            String detail = !compileOutput.isBlank() ? compileOutput : !stderr.isBlank() ? stderr : "Compilation failed.";
            out.put("status", "COMPILE_ERROR");
            out.put("exitCode", exitCode == null ? 1 : exitCode);
            out.put("stdout", "");
            out.put("stderr", detail);
            return out;
        }
        if (verdict == TIME_LIMIT) {
            out.put("status", "TIMEOUT");
            out.put("exitCode", -1);
            out.put("stdout", stdout);
            out.put("stderr", "Execution exceeded the time limit.");
            return out;
        }
        if (verdict == INTERNAL_ERROR || verdict == EXEC_FORMAT_ERROR) {
            out.put("status", "RUNNER_UNAVAILABLE");
            out.put("exitCode", -1);
            out.put("stdout", "");
            out.put("stderr", message.isBlank() ? "The execution service could not run that submission." : message);
            return out;
        }
        if (verdict == ACCEPTED || verdict == WRONG_ANSWER) {
            // Output is compared by NovaTutor, not by the provider.
            out.put("status", "PASSED");
            out.put("exitCode", 0);
            out.put("stdout", stdout);
            out.put("stderr", stderr);
            return out;
        }
        if (verdict >= 7 && verdict <= 12) {
            out.put("status", "RUNTIME_ERROR");
            out.put("exitCode", exitCode == null ? -1 : exitCode);
            out.put("stdout", stdout);
            out.put("stderr", stderr.isBlank() ? "Your program exited with a runtime error." : stderr);
            return out;
        }
        out.put("status", "RUNTIME_ERROR");
        out.put("exitCode", exitCode == null ? -1 : exitCode);
        out.put("stdout", stdout);
        out.put("stderr", stderr.isBlank() ? "The program did not finish normally." : stderr);
        return out;
    }

    private static Integer statusIdOf(String body) {
        if (body == null) return null;
        Matcher m = STATUS_ID.matcher(body);
        return m.find() ? Integer.valueOf(m.group(1)) : null;
    }

    private static double seconds(Object time) {
        if (time == null) return 0;
        try {
            return Double.parseDouble(String.valueOf(time).trim());
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    private static double number(Object v) {
        if (v == null) return 0;
        try {
            return Double.parseDouble(String.valueOf(v).trim());
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    private static String str(Object v) {
        return v == null ? "" : String.valueOf(v);
    }

    private static String limit(String s) {
        return s.length() > 12000 ? s.substring(0, 12000) + "\n[output truncated]" : s;
    }

    private static String quote(String s) {
        StringBuilder sb = new StringBuilder(s.length() + 16).append('"');
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"' -> sb.append("\\\"");
                case '\\' -> sb.append("\\\\");
                case '\n' -> sb.append("\\n");
                case '\r' -> sb.append("\\r");
                case '\t' -> sb.append("\\t");
                case '\b' -> sb.append("\\b");
                case '\f' -> sb.append("\\f");
                default -> {
                    if (c < 0x20) sb.append(String.format("\\u%04x", (int) c));
                    else sb.append(c);
                }
            }
        }
        return sb.append('"').toString();
    }

    private record Response(int status, String body) {}

    private Response postJson(String path, String body) throws InterruptedException {
        HttpRequest.Builder b = HttpRequest.newBuilder(URI.create(baseUrl + path))
                .timeout(Duration.ofSeconds(30 + timeoutSeconds))
                .header("Content-Type", "application/json")
                .header("Accept", "application/json")
                .header("User-Agent", "NovaTutor-Judge/2.0")
                .POST(HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8));
        if (!apiKey.isEmpty()) b.header("X-Auth-Token", apiKey);
        try {
            HttpResponse<String> res = http.send(b.build(), HttpResponse.BodyHandlers.ofString());
            return new Response(res.statusCode(), res.body());
        } catch (java.io.IOException e) {
            throw new IllegalStateException("judge unreachable", e);
        }
    }

    /** Minimal JSON reader for the flat response shape the provider returns. */
    static final class Json {
        static Map<String, Object> parse(String json) {
            Map<String, Object> out = new LinkedHashMap<>();
            int i = 0, n = json.length();
            while (i < n) {
                int keyStart = json.indexOf('"', i);
                if (keyStart < 0) break;
                int keyEnd = endOfString(json, keyStart);
                if (keyEnd < 0) break;
                String key = unescape(json.substring(keyStart + 1, keyEnd));
                int colon = json.indexOf(':', keyEnd);
                if (colon < 0) break;
                int v = colon + 1;
                while (v < n && Character.isWhitespace(json.charAt(v))) v++;
                if (v >= n) break;
                Object value;
                char c = json.charAt(v);
                if (c == '"') {
                    int sEnd = endOfString(json, v);
                    if (sEnd < 0) break;
                    value = unescape(json.substring(v + 1, sEnd));
                    i = sEnd + 1;
                } else if (c == '{' || c == '[') {
                    int close = matching(json, v);
                    if (close < 0) break;
                    value = json.substring(v, close + 1);
                    i = close + 1;
                } else {
                    int end = v;
                    while (end < n && json.charAt(end) != ',' && json.charAt(end) != '}' && json.charAt(end) != '\n') end++;
                    String raw = json.substring(v, end).trim();
                    value = "null".equals(raw) ? null : raw;
                    i = end;
                }
                out.put(key, value);
            }
            return out;
        }

        private static int endOfString(String s, int quote) {
            for (int i = quote + 1; i < s.length(); i++) {
                char c = s.charAt(i);
                if (c == '\\') { i++; continue; }
                if (c == '"') return i;
            }
            return -1;
        }

        private static int matching(String s, int open) {
            char o = s.charAt(open), cl = o == '{' ? '}' : ']';
            int depth = 0;
            boolean inStr = false;
            for (int i = open; i < s.length(); i++) {
                char c = s.charAt(i);
                if (inStr) {
                    if (c == '\\') { i++; continue; }
                    if (c == '"') inStr = false;
                    continue;
                }
                if (c == '"') { inStr = true; continue; }
                if (c == o) depth++;
                else if (c == cl) { depth--; if (depth == 0) return i; }
            }
            return -1;
        }

        private static String unescape(String s) {
            if (s.indexOf('\\') < 0) return s;
            StringBuilder sb = new StringBuilder(s.length());
            for (int i = 0; i < s.length(); i++) {
                char c = s.charAt(i);
                if (c != '\\' || i + 1 >= s.length()) { sb.append(c); continue; }
                char n = s.charAt(++i);
                switch (n) {
                    case 'n' -> sb.append('\n');
                    case 't' -> sb.append('\t');
                    case 'r' -> sb.append('\r');
                    case 'b' -> sb.append('\b');
                    case 'f' -> sb.append('\f');
                    case '"' -> sb.append('"');
                    case '\\' -> sb.append('\\');
                    case '/' -> sb.append('/');
                    case 'u' -> {
                        if (i + 4 < s.length()) {
                            try {
                                sb.append((char) Integer.parseInt(s.substring(i + 1, i + 5), 16));
                                i += 4;
                            } catch (NumberFormatException e) { sb.append('u'); }
                        } else sb.append('u');
                    }
                    default -> sb.append(n);
                }
            }
            return sb.toString();
        }

        private Json() {}
    }
}
