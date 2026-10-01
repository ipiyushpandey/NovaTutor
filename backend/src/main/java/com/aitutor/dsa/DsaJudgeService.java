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

    public record RunResult(String status,   // PASSED | FAILED | COMPILE_ERROR | RUNTIME_ERROR | SANDBOX_NOT_ENABLED | RUNNER_BUSY | RUNNER_UNAVAILABLE | UNSUPPORTED_LANGUAGE
                            String message,
                            List<TestResult> tests,
                            int passedCount,
                            int totalCount,
                            boolean accepted) {}

    public RunResult run(User user, DsaProblem problem, RunRequest request, boolean recordProgress) {
        DsaLang lang = DsaLang.parse(request.language());
        if (!lang.supports(problem.sig())) {
            return new RunResult("UNSUPPORTED_LANGUAGE",
                    lang.label() + " is not available for this problem shape. Try Java, Python, C++, JavaScript or Go.",
                    List.of(), 0, 0, false);
        }

        List<String[]> tests = collectTests(problem);
        if (tests.isEmpty()) {
            return new RunResult("NO_TESTS", "This problem has no tests yet.", List.of(), 0, 0, false);
        }

        String program = lang.harness(problem.sig(), request.code() == null ? "" : request.code());
        StringBuilder stdin = new StringBuilder();
        for (String[] t : tests) stdin.append(t[0]).append('\n');

        Map<String, Object> out = sandbox.execute(langLabel(lang), program, stdin.toString());
        String status = String.valueOf(out.get("status"));
        String stdout = String.valueOf(out.getOrDefault("stdout", ""));

        if (!Boolean.TRUE.equals(out.get("enabled"))) {
            String msg = String.valueOf(out.getOrDefault("message", "Code execution is not available."));
            return new RunResult(String.valueOf(out.getOrDefault("status", "SANDBOX_NOT_ENABLED")), msg, List.of(), 0, 0, false);
        }
        if ("RUNNER_BUSY".equals(status)) {
            return new RunResult("RUNNER_BUSY", "The judge is busy — please retry in a moment.", List.of(), 0, 0, false);
        }
        if ("RUNNER_UNAVAILABLE".equals(status)) {
            return new RunResult("RUNNER_UNAVAILABLE",
                    String.valueOf(out.getOrDefault("stderr", "Docker sandbox is unavailable.")), List.of(), 0, 0, false);
        }
        if ("TIMEOUT".equals(status)) {
            return new RunResult("TIMEOUT", "Your solution exceeded the judge time limit.", List.of(), 0, 0, false);
        }

        // One output line per test, in order. Missing lines mean the program
        // crashed or produced a compile error before finishing.
        List<String> lines = outputLines(stdout);
        int exitCode = out.get("exitCode") instanceof Integer i ? i : 0;
        String stderr = String.valueOf(out.getOrDefault("stderr", ""));

        List<TestResult> results = new ArrayList<>();
        int passed = 0;
        for (int i = 0; i < tests.size(); i++) {
            String[] t = tests.get(i);
            boolean sample = i < problem.samples().size();
            String expected;
            try {
                expected = problem.expectedFor(t[0]);
            } catch (RuntimeException e) {
                continue; // malformed hidden spec line, skip
            }
            String actual = i < lines.size() ? lines.get(i) : "";
            if ("RUNTIME_ERROR".equals(status) && i == lines.size()) {
                // program died here: remaining tests all fail with the runtime note
                results.add(new TestResult(i, sample, pretty(problem, t), expected, "", false,
                        stderr.isBlank() ? "Runtime error" : stderr));
                continue;
            }
            boolean ok = normalize(actual).equals(normalize(expected));
            if (ok) passed++;
            results.add(new TestResult(i, sample, pretty(problem, t), expected, actual, ok,
                    ok ? null : ("ERROR".equals(actual) ? "Runtime error on this test" : null)));
        }

        // Heuristic: compile failure → gcc/javac nonzero exit and no output lines at all.
        if (lines.isEmpty() && exitCode != 0) {
            String msg = stderr == null || stderr.isBlank()
                    ? "Your code did not compile. Check the language syntax (the judge compiled it as " + lang.label() + ")."
                    : firstMeaningful(stderr);
            if (recordProgress && user != null) record(user, problem, lang, 0, tests.size(), false);
            return new RunResult("COMPILE_ERROR", msg, results, 0, tests.size(), false);
        }

        boolean accepted = passed == tests.size();
        if (recordProgress && user != null) record(user, problem, lang, passed, tests.size(), accepted);
        return new RunResult(accepted ? "PASSED" : "FAILED",
                accepted ? "All " + tests.size() + " tests passed." : passed + " of " + tests.size() + " tests passed.",
                results, passed, tests.size(), accepted);
    }

    private List<String[]> collectTests(DsaProblem p) {
        List<String[]> all = new ArrayList<>(p.samples());
        for (String[] h : p.hiddenTests(HIDDEN_TESTS_PER_RUN)) {
            try {
                p.expectedFor(h[0]);
                all.add(h);
            } catch (RuntimeException ignored) {
                // malformed hidden spec — never sent to users
            }
        }
        return all;
    }

    private static List<String> outputLines(String stdout) {
        List<String> out = new ArrayList<>();
        for (String l : stdout.split("\n", -1)) {
            String t = l.trim();
            if (!t.isEmpty()) out.add(t);
        }
        return out;
    }

    private static String normalize(String s) {
        if (s == null) return "";
        return s.trim().replaceAll("\\s+", "");
    }

    private static String pretty(DsaProblem p, String[] t) {
        try {
            return p.prettyInput(t);
        } catch (RuntimeException e) {
            return t[0];
        }
    }

    private static String firstMeaningful(String stderr) {
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
