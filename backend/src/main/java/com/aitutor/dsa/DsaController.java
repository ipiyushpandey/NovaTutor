package com.aitutor.dsa;

import com.aitutor.security.AuthenticatedUser;
import com.aitutor.entity.User;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * DSA practice module endpoints. Everything is authenticated (JWT), except the
 * read-only catalog which is also useful pre-login.
 */
@RestController
@RequestMapping("/api/dsa")
public class DsaController {

    private final DsaJudgeService judge;
    private final DsaProblemStateRepository states;
    private final AuthenticatedUser authenticatedUser;
    private final com.aitutor.service.AiService ai;

    public DsaController(DsaJudgeService judge,
                         DsaProblemStateRepository states,
                         AuthenticatedUser authenticatedUser,
                         com.aitutor.service.AiService ai) {
        this.judge = judge;
        this.states = states;
        this.authenticatedUser = authenticatedUser;
        this.ai = ai;
    }

    // ------------------------------------------------------------- catalog

    @GetMapping("/problems")
    public ResponseEntity<String> problems() {
        return ResponseEntity.ok()
                .header("Content-Type", "application/json")
                .body(DsaCatalog.summaryJson(DsaCatalog.summaries()));
    }

    @GetMapping("/stats")
    public ResponseEntity<String> stats() {
        return ResponseEntity.ok().header("Content-Type", "application/json").body(catalogStats());
    }

    // ------------------------------------------------------------- detail

    /** Problem detail + samples. Hidden tests never leave the server. */
    @GetMapping("/problems/{slug}")
    public ResponseEntity<String> problem(@PathVariable String slug) {
        DsaProblem p = DsaCatalog.bySlug(slug);
        if (p == null) return ResponseEntity.status(404)
                .header("Content-Type", "application/json")
                .body("{\"error\":\"Problem not found\"}");
        StringBuilder sb = new StringBuilder();
        sb.append("{\"slug\":\"").append(esc(p.slug()))
          .append("\",\"title\":\"").append(esc(p.title()))
          .append("\",\"difficulty\":\"").append(esc(p.difficultyLabel()))
          .append("\",\"topic\":\"").append(esc(p.topic()))
          .append("\",\"tags\":").append(jsonArray(p.tags()))
          .append(",\"signature\":\"").append(esc(p.displaySignature()))
          .append("\",\"statement\":\"").append(esc(p.statement()))
          .append("\",\"constraints\":\"").append(esc(p.constraints()))
          .append("\",\"samples\":[");
        List<String[]> samples = p.samples();
        for (int i = 0; i < samples.size(); i++) {
            if (i > 0) sb.append(",");
            String[] s = samples.get(i);
            sb.append("{\"input\":\"").append(esc(p.prettyInput(s)))
              .append("\",\"expected\":\"").append(esc(p.expectedFor(s[0]))).append("\"}");
        }
        sb.append("]}");
        return ResponseEntity.ok().header("Content-Type", "application/json").body(sb.toString());
    }

    /** Starter code for one language. */
    @GetMapping("/problems/{slug}/starter")
    public Map<String, Object> starter(@PathVariable String slug, @RequestParam String language) {
        DsaProblem p = DsaCatalog.bySlug(slug);
        if (p == null) return Map.of("error", "Problem not found");
        DsaLang lang = DsaLang.parse(language);
        if (!lang.supports(p.sig())) return Map.of("error", "Language not supported for this problem");
        return Map.of("language", lang.label(), "code", lang.starter(p.sig()));
    }

    // ------------------------------------------------------------- judging

    @PostMapping("/problems/{slug}/run")
    public Map<String, Object> run(@PathVariable String slug, @RequestBody DsaJudgeService.RunRequest request,
                                   Authentication authentication) {
        DsaProblem p = DsaCatalog.bySlug(slug);
        if (p == null) return Map.of("status", "FAILED", "message", "Problem not found");
        User user = safeUser(authentication);
        return runToMap(judge.run(user, p, request, user != null));
    }

    private Map<String, Object> runToMap(DsaJudgeService.RunResult r) {
        List<Map<String, Object>> tests = new ArrayList<>();
        for (DsaJudgeService.TestResult t : r.tests()) {
            boolean sample = t.sample();
            tests.add(Map.of(
                    "index", t.index(),
                    "sample", sample,
                    "input", sample && t.input() != null ? t.input() : "",
                    "expected", sample && t.expected() != null ? t.expected() : "",
                    "actual", sample && t.actual() != null ? t.actual() : "",
                    "passed", t.passed(),
                    "note", t.note() == null ? "" : t.note()));
        }
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("status", r.status());
        m.put("message", r.message());
        m.put("passed", r.passedCount());
        m.put("total", r.totalCount());
        m.put("accepted", r.accepted());
        m.put("durationMs", r.durationMs());
        m.put("memoryKb", r.memoryKb());
        m.put("tests", tests);
        return m;
    }

    // ------------------------------------------------------------- progress

    @GetMapping("/progress")
    public Map<String, Object> progress(Authentication authentication) {
        User user = authenticatedUser.require(authentication);
        Map<String, DsaProblemState> bySlug = new LinkedHashMap<>();
        for (DsaProblemState s : states.findByUserId(user.getId())) bySlug.put(s.getSlug(), s);

        List<Map<String, Object>> rows = new ArrayList<>();
        for (DsaProblem p : DsaCatalog.all()) {
            DsaProblemState s = bySlug.get(p.slug());
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("slug", p.slug());
            row.put("status", s == null ? "NEW" : s.getStatus());
            row.put("attempts", s == null ? 0 : s.getAttempts());
            row.put("bookmarked", s != null && s.isBookmarked());
            row.put("lastLanguage", s == null ? null : s.getLastLanguage());
            row.put("lastCode", s == null ? null : s.getLastCode());
            row.put("solvedAt", s == null || s.getSolvedAt() == null ? null : s.getSolvedAt().toString());
            rows.add(row);
        }
        return Map.of("problems", rows);
    }

    /** Saves the editor code for a problem (so students can resume later). */
    @PostMapping("/progress/{slug}/code")
    public Map<String, Object> saveCode(@PathVariable String slug, @RequestBody SaveCodeRequest request,
                                        Authentication authentication) {
        User user = authenticatedUser.require(authentication);
        DsaProblemState st = states.findByUserIdAndSlug(user.getId(), slug)
                .orElseGet(() -> new DsaProblemState(user, slug));
        if (request.language() != null) st.setLastLanguage(request.language());
        st.setLastCode(request.code());
        st.setUpdatedAt(java.time.LocalDateTime.now());
        if (DsaProblemState.SOLVED.equals(st.getStatus())) {
            // keep solved status; attempts untouched
        } else if (st.getAttempts() == 0) {
            st.setStatus(DsaProblemState.ATTEMPTED);
        }
        states.save(st);
        return Map.of("saved", true);
    }

    @PostMapping("/progress/{slug}/bookmark")
    public Map<String, Object> bookmark(@PathVariable String slug, @RequestBody BookmarkRequest request,
                                        Authentication authentication) {
        User user = authenticatedUser.require(authentication);
        DsaProblemState st = states.findByUserIdAndSlug(user.getId(), slug)
                .orElseGet(() -> new DsaProblemState(user, slug));
        st.setBookmarked(request.bookmarked());
        st.setUpdatedAt(java.time.LocalDateTime.now());
        states.save(st);
        return Map.of("bookmarked", st.isBookmarked());
    }

    @GetMapping("/progress/summary")
    public Map<String, Object> summary(Authentication authentication) {
        User user = authenticatedUser.require(authentication);
        long solved = states.countByUserIdAndStatus(user.getId(), DsaProblemState.SOLVED);
        long attempted = states.countByUserIdAndStatus(user.getId(), DsaProblemState.ATTEMPTED);
        long bookmarked = states.countByUserIdAndBookmarkedTrue(user.getId());
        int total = DsaCatalog.count();

        // One query for all of this user's problem states (was 328 per-slug lookups).
        Map<String, DsaProblemState> bySlug = new HashMap<>();
        for (DsaProblemState s : states.findByUserId(user.getId())) bySlug.put(s.getSlug(), s);

        Map<String, Integer> byDifficulty = new LinkedHashMap<>();
        Map<String, Integer> byTopic = new LinkedHashMap<>();
        for (DsaProblem p : DsaCatalog.all()) {
            DsaProblemState s = bySlug.get(p.slug());
            boolean isSolved = s != null && DsaProblemState.SOLVED.equals(s.getStatus());
            byDifficulty.merge(p.difficulty().name(), isSolved ? 1 : 0, Integer::sum);
            byTopic.merge(p.topic(), isSolved ? 1 : 0, Integer::sum);
        }

        Map<String, Object> m = new LinkedHashMap<>();
        m.put("total", total);
        m.put("solved", solved);
        m.put("attempted", attempted);
        m.put("bookmarked", bookmarked);
        m.put("solvedByDifficulty", byDifficulty);
        m.put("solvedByTopic", byTopic);
        return m;
    }

    // ------------------------------------------------------------- AI hint

    /** Nova AI hint: concept-level guidance without giving away the solution. */
    @PostMapping("/problems/{slug}/hint")
    public Map<String, Object> hint(@PathVariable String slug, @RequestBody HintRequest request,
                                    Authentication authentication) {
        User user = authenticatedUser.require(authentication);
        DsaProblem p = DsaCatalog.bySlug(slug);
        if (p == null) return Map.of("answer", "Problem not found.");
        String level = request.mode() == null ? "hint" : request.mode();
        String prompt = switch (level) {
            case "approach" -> "Explain a step-by-step approach (no code) for this problem. Cover the key insight, the algorithm outline, and the time/space complexity. Do not write the solution code.";
            case "review" -> "Review the student's code for this problem. Identify bugs, edge cases and complexity issues. Be specific about what to fix without rewriting the whole solution.";
            default -> "Give a single nudge in the right direction (no code, no full algorithm). One or two sentences pointing at the core idea only.";
        };
        String full = "You are Nova, a DSA mentor. " + prompt
                + "\n\nProblem: " + p.title()
                + "\nDifficulty: " + p.difficultyLabel()
                + "\nTopic: " + p.topic()
                + "\n\nStatement: " + p.statement()
                + (request.code() == null || request.code().isBlank()
                    ? ""
                    : "\n\nStudent code:\n" + request.code());
        var resp = ai.ask(new com.aitutor.ai.AiRequest(
                com.aitutor.ai.AiTask.CODE, "DSA", full, "intermediate", "English/Hinglish"));
        return Map.of("answer", resp == null || resp.answer() == null ? "AI is unavailable right now." : resp.answer());
    }

    public record SaveCodeRequest(String language, String code) {}
    public record BookmarkRequest(boolean bookmarked) {}
    public record HintRequest(String mode, String code) {}

    // ------------------------------------------------------------- helpers

    private User safeUser(Authentication authentication) {
        try {
            return authenticatedUser.require(authentication);
        } catch (Exception e) {
            return null;
        }
    }

    private String catalogStats() {
        int total = DsaCatalog.count();
        int easy = 0, medium = 0, hard = 0;
        Map<String, Integer> topics = new LinkedHashMap<>();
        for (DsaProblem p : DsaCatalog.all()) {
            switch (p.difficulty()) {
                case EASY -> easy++;
                case MEDIUM -> medium++;
                case HARD -> hard++;
            }
            topics.merge(p.topic(), 1, Integer::sum);
        }
        StringBuilder sb = new StringBuilder("{");
        sb.append("\"total\":").append(total)
          .append(",\"easy\":").append(easy)
          .append(",\"medium\":").append(medium)
          .append(",\"hard\":").append(hard)
          .append(",\"topics\":{");
        boolean first = true;
        for (var e : topics.entrySet()) {
            if (!first) sb.append(",");
            first = false;
            sb.append("\"").append(esc(e.getKey())).append("\":").append(e.getValue());
        }
        sb.append("}}");
        return sb.toString();
    }

    private String jsonArray(List<String> list) {
        StringBuilder sb = new StringBuilder("[");
        for (int i = 0; i < list.size(); i++) {
            if (i > 0) sb.append(",");
            sb.append("\"").append(esc(list.get(i))).append("\"");
        }
        return sb.append("]").toString();
    }

    private static String esc(String s) {
        if (s == null) return "";
        return s.replace("\\", "\\\\")
                .replace("\"", "\\\"")
                .replace("\n", "\\n")
                .replace("\r", "")
                .replace("\t", "\\t");
    }
}
