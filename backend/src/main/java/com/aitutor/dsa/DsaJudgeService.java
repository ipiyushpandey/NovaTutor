package com.aitutor.dsa;

import com.aitutor.controller.SandboxExecutionService;
import com.aitutor.entity.User;
import com.aitutor.intelligence.LearningEventService;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Judges a user's solution for one problem.
 *
 * The generated harness reads every stdin line as one test and prints exactly
 * one output line per test, so a single sandbox execution evaluates the full
 * test suite. Output lines are compared one-by-one against the oracle.
 *
 * Verdict correctness notes (V2):
 *  - Tests are validated against the oracle BEFORE execution, so a malformed
 *    hidden spec can never shift output-line alignment and fail a correct
 *    solution.
 *  - Blank lines are preserved: an expected empty line is a real test result,
 *    not padding to be discarded.
 *  - Comparison keeps token boundaries. "1 2" never equals "12", while
 *    "[1, 2]" and "[1,2]" are both accepted because they are the same array.
 */
@Service
public class DsaJudgeService {

    /** How many hidden tests to run per submission (samples are always run). */
    private static final int HIDDEN_TESTS_PER_RUN = 8;

    private final SandboxExecutionService sandbox;
    private final DsaProblemStateRepository states;
    private final LearningEventService events;

    public DsaJudgeService(SandboxExecutionService sandbox,
                           DsaProblemStateRepository states,
                           LearningEventService events) {
        this.sandbox = sandbox;
        this.states = states;
        this.events = events;
    }

    public record RunRequest(String language, String code) {}

    public record TestResult(int index, boolean sample, String input, String expected,
                             String actual, boolean passed, String note) {}

    public record RunResult(String status,   // PASSED | FAILED | COMPILE_ERROR | RUNTIME_ERROR | TIMEOUT | SANDBOX_NOT_ENABLED | RUNNER_BUSY | RUNNER_UNAVAILABLE | UNSUPPORTED_LANGUAGE
                            String message,
                            List<TestResult> tests,
                            int passedCount,
                            int totalCount,
                            boolean accepted,
                            long durationMs,
                            long memoryKb) {

        public RunResult(String status, String message, List<TestResult> tests,
                         int passedCount, int totalCount, boolean accepted) {
            this(status, message, tests, passedCount, totalCount, accepted, 0L, 0L);
        }

        public RunResult(String status, String message, List<TestResult> tests,
                         int passedCount, int totalCount, boolean accepted, long durationMs) {
            this(status, message, tests, passedCount, totalCount, accepted, durationMs, 0L);
        }
    }

    public RunResult run(User user, DsaProblem problem, RunRequest request, boolean recordProgress) {
        DsaLang lang = DsaLang.parse(request.language());
        if (!lang.supports(problem.sig())) {
            return new RunResult("UNSUPPORTED_LANGUAGE",
                    lang.label() + " is not available for this problem shape. Try Java, Python, C++, JavaScript or Go.",
                    List.of(), 0, 0, false, 0);
        }

        // Validate every candidate test against the oracle up front. Samples and
        // hidden tests are separated and executed in DISTINCT sandbox invocations
        // so student code cannot read ahead on stdin during sample execution or
        // echo hidden test inputs via stderr/stdout (HIGH-SEC-01).
        List<String[]> sampleTests = new ArrayList<>();
        List<String> sampleExpected = new ArrayList<>();
        for (String[] sample : problem.samples()) {
            String expected = expectedFor(problem, sample[0]);
            if (expected == null) continue;
            sampleTests.add(sample);
            sampleExpected.add(expected);
        }
        List<String[]> hiddenTests = new ArrayList<>();
        List<String> hiddenExpected = new ArrayList<>();
        for (String[] hidden : problem.hiddenTests(HIDDEN_TESTS_PER_RUN)) {
            String expected = expectedFor(problem, hidden[0]);
            if (expected == null) continue;
            hiddenTests.add(hidden);
            hiddenExpected.add(expected);
        }
        int totalTests = sampleTests.size() + hiddenTests.size();
        if (totalTests == 0) {
            return new RunResult("NO_TESTS", "This problem has no runnable tests yet.", List.of(), 0, 0, false, 0);
        }

        String program = lang.harness(problem.sig(), request.code() == null ? "" : request.code());
        long totalDurationMs = 0L;
        long maxMemoryKb = 0L;

        // 1) Execute sample tests with ONLY sample inputs on stdin.
        List<String> sampleLines = List.of();
        if (!sampleTests.isEmpty()) {
            StringBuilder sampleStdin = new StringBuilder();
            for (String[] t : sampleTests) sampleStdin.append(t[0]).append('\n');

            Map<String, Object> out = sandbox.execute(langLabel(lang), program, sampleStdin.toString());
            String status = String.valueOf(out.get("status"));
            long durationMs = out.get("durationMs") instanceof Number n ? n.longValue() : 0L;
            long memoryKb = out.get("memoryKb") instanceof Number mk ? mk.longValue() : 0L;
            totalDurationMs += durationMs;
            maxMemoryKb = Math.max(maxMemoryKb, memoryKb);

            RunResult early = checkExecutionFailure(out, status, totalTests, totalDurationMs, maxMemoryKb,
                    lang, true, user, problem, recordProgress);
            if (early != null) return early;

            sampleLines = outputLines(String.valueOf(out.getOrDefault("stdout", "")));
            int exitCode = out.get("exitCode") instanceof Integer i ? i : 0;
            String stderr = String.valueOf(out.getOrDefault("stderr", ""));
            if (sampleLines.isEmpty() && exitCode != 0) {
                if (recordProgress && user != null) record(user, problem, lang, 0, totalTests, false);
                return new RunResult("RUNTIME_ERROR", firstMeaningful(stderr, lang), List.of(), 0, totalTests, false, totalDurationMs, maxMemoryKb);
            }
        }

        // 2) Execute hidden tests in a completely separate sandbox invocation with ONLY hidden inputs.
        //    Raw stderr from this execution is NEVER returned to the client.
        List<String> hiddenLines = List.of();
        if (!hiddenTests.isEmpty()) {
            StringBuilder hiddenStdin = new StringBuilder();
            for (String[] t : hiddenTests) hiddenStdin.append(t[0]).append('\n');

            Map<String, Object> hiddenOut = sandbox.execute(langLabel(lang), program, hiddenStdin.toString());
            String hiddenStatus = String.valueOf(hiddenOut.get("status"));
            long hiddenDurationMs = hiddenOut.get("durationMs") instanceof Number n ? n.longValue() : 0L;
            long hiddenMemoryKb = hiddenOut.get("memoryKb") instanceof Number mk ? mk.longValue() : 0L;
            totalDurationMs += hiddenDurationMs;
            maxMemoryKb = Math.max(maxMemoryKb, hiddenMemoryKb);

            RunResult earlyHidden = checkExecutionFailure(hiddenOut, hiddenStatus, totalTests, totalDurationMs, maxMemoryKb,
                    lang, false, user, problem, recordProgress);
            if (earlyHidden != null) return earlyHidden;

            hiddenLines = outputLines(String.valueOf(hiddenOut.getOrDefault("stdout", "")));
            int hiddenExitCode = hiddenOut.get("exitCode") instanceof Integer i ? i : 0;
            if (hiddenLines.isEmpty() && hiddenExitCode != 0) {
                if (recordProgress && user != null) record(user, problem, lang, 0, totalTests, false);
                return new RunResult("RUNTIME_ERROR", "Runtime error on hidden test suite.",
                        List.of(), 0, totalTests, false, totalDurationMs, maxMemoryKb);
            }
        }

        List<TestResult> results = new ArrayList<>();
        int passed = 0;
        for (int i = 0; i < sampleTests.size(); i++) {
            String[] t = sampleTests.get(i);
            String expected = sampleExpected.get(i);
            boolean produced = i < sampleLines.size();
            String actual = produced ? sampleLines.get(i) : "";
            boolean runtimeFailure = "ERROR".equals(actual.trim());
            boolean ok = produced && !runtimeFailure && outputsMatch(actual, expected);
            if (ok) passed++;
            String note = null;
            if (!ok) {
                if (!produced) note = "No output produced for this test (the program stopped early or crashed).";
                else if (runtimeFailure) note = "Runtime error on this test.";
            }
            results.add(new TestResult(i, true, pretty(problem, t), expected, actual, ok, note));
        }
        for (int i = 0; i < hiddenTests.size(); i++) {
            int idx = sampleTests.size() + i;
            String expected = hiddenExpected.get(i);
            boolean produced = i < hiddenLines.size();
            String actual = produced ? hiddenLines.get(i) : "";
            boolean runtimeFailure = "ERROR".equals(actual.trim());
            boolean ok = produced && !runtimeFailure && outputsMatch(actual, expected);
            if (ok) passed++;
            String note = null;
            if (!ok) {
                if (!produced) note = "No output produced for this test (the program stopped early or crashed).";
                else if (runtimeFailure) note = "Runtime error on hidden test.";
                else note = "Hidden test failed — check edge cases.";
            }
            // Never leak hidden test inputs, expected outputs, or raw outputs to the client.
            results.add(new TestResult(idx, false, "", "", "", ok, note));
        }

        boolean accepted = passed == totalTests;
        if (recordProgress && user != null) record(user, problem, lang, passed, totalTests, accepted);
        String message = accepted
                ? "All " + totalTests + " tests passed."
                : passed + " of " + totalTests + " tests passed.";
        return new RunResult(accepted ? "PASSED" : "FAILED", message, results, passed, totalTests, accepted, totalDurationMs, maxMemoryKb);
    }

    private RunResult checkExecutionFailure(Map<String, Object> out, String status, int totalTests,
                                            long durationMs, long memoryKb, DsaLang lang, boolean exposeStderr,
                                            User user, DsaProblem problem, boolean recordProgress) {
        if (!Boolean.TRUE.equals(out.get("enabled"))) {
            String msg = String.valueOf(out.getOrDefault("message", "Code execution is not available."));
            return new RunResult(String.valueOf(out.getOrDefault("status", "SANDBOX_NOT_ENABLED")), msg,
                    List.of(), 0, 0, false, durationMs);
        }
        if ("RUNNER_BUSY".equals(status)) {
            return new RunResult("RUNNER_BUSY", "The judge is busy — please retry in a moment.", List.of(), 0, 0, false, durationMs);
        }
        if ("RUNNER_UNAVAILABLE".equals(status)) {
            return new RunResult("RUNNER_UNAVAILABLE",
                    exposeStderr
                            ? String.valueOf(out.getOrDefault("stderr", "The code execution service is unavailable."))
                            : "The code execution service is unavailable.",
                    List.of(), 0, 0, false, durationMs);
        }
        if ("TIMEOUT".equals(status)) {
            if (recordProgress && user != null) record(user, problem, lang, 0, totalTests, false);
            return new RunResult("TIMEOUT", "Time limit exceeded — your program ran longer than the judge allows.", List.of(), 0, totalTests, false, durationMs);
        }
        if ("MEMORY_LIMIT".equals(status)) {
            if (recordProgress && user != null) record(user, problem, lang, 0, totalTests, false);
            long limitKb = out.get("memoryLimitKb") instanceof Number n ? n.longValue() : 0L;
            String limit = limitKb > 0 ? " the judge's " + Math.max(1, limitKb / 1024) + " MB limit" : "the judge's memory limit";
            return new RunResult("MEMORY_LIMIT",
                    "Memory limit exceeded — your program was stopped at" + limit
                            + ". Reduce large allocations and try again.",
                    List.of(), 0, totalTests, false, durationMs, memoryKb);
        }
        if ("COMPILE_ERROR".equals(status)) {
            String stderr = String.valueOf(out.getOrDefault("stderr", ""));
            if (recordProgress && user != null) record(user, problem, lang, 0, totalTests, false);
            String msg = exposeStderr ? firstMeaningful(stderr, lang) : "Compilation failed on hidden test suite.";
            return new RunResult("COMPILE_ERROR", msg, List.of(), 0, totalTests, false, durationMs);
        }
        return null;
    }

    private static String expectedFor(DsaProblem p, String rawLine) {
        try {
            return p.expectedFor(rawLine);
        } catch (RuntimeException e) {
            return null; // malformed test spec — never executed, never revealed
        }
    }

    /**
     * Splits program output into one entry per test.
     *
     * A single trailing newline is stripped (println adds one); interior blank
     * lines are kept because an empty expected answer is a legitimate result.
     */
    private static List<String> outputLines(String stdout) {
        List<String> out = new ArrayList<>();
        String s = stdout == null ? "" : stdout.replace("\r\n", "\n").replace('\r', '\n');
        if (s.endsWith("\n")) s = s.substring(0, s.length() - 1);
        if (s.isEmpty()) return out;
        for (String l : s.split("\n", -1)) out.add(l);
        return out;
    }

    /**
     * Output comparison that understands NovaTutor's canonical answer format.
     *
     * Structured answers (numbers, arrays, matrices) ignore all whitespace so
     * that "[1, 2]" and "[1,2]" match. Free-text answers only collapse repeated
     * whitespace, so "a b" never matches "ab".
     */
    static boolean outputsMatch(String actual, String expected) {
        String a = actual == null ? "" : actual.trim();
        String e = expected == null ? "" : expected.trim();
        if (a.equals(e)) return true;
        if (a.isEmpty() || e.isEmpty()) return false;
        if (isStructured(e) && isStructured(a)) return structured(a).equals(structured(e));
        return collapse(a).equals(collapse(e));
    }

    /** Numbers, arrays and matrices: digits, signs, commas, semicolons, brackets. */
    private static boolean isStructured(String s) {
        return s.matches("^[0-9eE+\\-.,;\\[\\]\\s]+$");
    }

    /**
     * Removes whitespace only where it is cosmetic — next to structural
     * punctuation. Whitespace between two values separates tokens, so it must
     * survive: "1 2" is not "12".
     */
    private static String structured(String s) {
        return s.trim().replaceAll("\\s*([\\[\\],;])\\s*", "$1");
    }

    private static String collapse(String s) {
        return s.trim().replaceAll("\\s+", " ");
    }

    private static String pretty(DsaProblem p, String[] t) {
        try {
            return p.prettyInput(t);
        } catch (RuntimeException e) {
            return t[0];
        }
    }

    private static String firstMeaningful(String stderr, DsaLang lang) {
        if (stderr == null || stderr.isBlank()) {
            return "Your code did not compile. Check the syntax for " + lang.label() + ".";
        }
        String[] parts = stderr.split("\n");
        for (String p : parts) {
            String t = p.trim();
            if (!t.isEmpty()) return t.length() > 300 ? t.substring(0, 300) + "…" : t;
        }
        return "Compilation failed.";
    }

    private String langLabel(DsaLang lang) {
        return switch (lang) {
            case JAVA -> "Java";
            case PYTHON -> "Python";
            case CPP -> "C++";
            case C -> "C";
            case JAVASCRIPT -> "JavaScript";
            case GO -> "Go";
        };
    }

    private void record(User user, DsaProblem problem, DsaLang lang, int passed, int total, boolean accepted) {
        DsaProblemState st = states.findByUserIdAndSlug(user.getId(), problem.slug())
                .orElseGet(() -> new DsaProblemState(user, problem.slug()));
        st.setAttempts(st.getAttempts() + 1);
        st.setLastLanguage(lang.label());
        if (accepted) {
            if (!DsaProblemState.SOLVED.equals(st.getStatus())) {
                st.setStatus(DsaProblemState.SOLVED);
                st.setSolvedAt(java.time.LocalDateTime.now());
            }
        } else if (!DsaProblemState.SOLVED.equals(st.getStatus())) {
            st.setStatus(DsaProblemState.ATTEMPTED);
        }
        st.setUpdatedAt(java.time.LocalDateTime.now());
        states.save(st);
        events.record(user, "DSA_ATTEMPT", "DSA Practice", problem.topic(),
                accepted ? 100 : 0, 0,
                (accepted ? "Solved" : "Attempted") + " " + problem.title() + " (" + passed + "/" + total + " tests)",
                "DSA_ATTEMPT:" + user.getId() + ":" + problem.slug() + ":" + (accepted ? "SOLVED" : "FAILED"));
    }
}
