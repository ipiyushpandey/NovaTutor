package com.aitutor.dsa;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Registry of every DSA problem. Topic files contribute lists; this class owns
 * slug indexing plus the compact per-signature factory methods used by the
 * bank files (distinct method names per shape so oracle lambdas infer cleanly).
 */
public final class DsaCatalog {
    private DsaCatalog() {}

    private static final Map<String, DsaProblem> BY_SLUG = new LinkedHashMap<>();
    private static final List<DsaProblem> ALL = new ArrayList<>();
    private static boolean registered = false;

    public static synchronized void register(List<DsaProblem> problems) {
        for (DsaProblem p : problems) {
            if (p.slug() == null || p.slug().isBlank()) continue;
            DsaProblem prev = BY_SLUG.put(p.slug(), p);
            if (prev == null) ALL.add(p);
            else ALL.set(ALL.indexOf(prev), p);
        }
        registered = true;
    }

    public static synchronized List<DProblemSummary> summaries() {
        ensure();
        return ALL.stream().map(DsaCatalog::summary).toList();
    }

    public static synchronized DsaProblem bySlug(String slug) {
        ensure();
        return BY_SLUG.get(slug);
    }

    public static synchronized int count() {
        ensure();
        return ALL.size();
    }

    public static synchronized List<DsaProblem> all() {
        ensure();
        return List.copyOf(ALL);
    }

    public static synchronized boolean ready() {
        return registered;
    }

    private static void ensure() {
        if (!registered) DsaTopics.registerAll();
    }

    private static DProblemSummary summary(DsaProblem p) {
        List<String[]> samples = p.samples();
        String[] first = samples.isEmpty() ? new String[]{""} : samples.get(0);
        List<Object[]> pairs = new ArrayList<>();
        for (String[] s : samples) {
            try {
                pairs.add(new Object[]{ p.prettyInput(s), p.expectedFor(s[0]) });
            } catch (RuntimeException e) {
                pairs.add(new Object[]{ p.prettyInput(s), "ERROR: " + e.getClass().getSimpleName() });
            }
        }
        return new DProblemSummary(
                p.slug(), p.title(), p.difficultyLabel(), p.topic(),
                p.tags(), p.displaySignature(), p.sig(),
                p.sig().ret != DsaKind.MATRIX,
                pairs, p.constraints(), p.statement());
    }

    /** Compact public summary for the problem list. */
    public record DProblemSummary(
            String slug, String title, String difficulty, String topic,
            List<String> tags, String signature, DsaSig sig,
            boolean cSupported, List<Object[]> samples,
            String constraints, String statement) {}

    // =====================================================================
    //  Factory methods — one per signature, so lambdas type-infer exactly.
    // =====================================================================

    public static DsaProblem a2a(String slug, String title, DsaProblem.Difficulty d, String topic, String tags,
                                 String statement, String constraints, String scalarName,
                                 String samplesRaw, String hiddenRaw, DsaFns.FA2A oracle) {
        return build(slug, title, d, topic, tags, DsaSig.A2A, statement, constraints, scalarName, samplesRaw, hiddenRaw, oracle);
    }
    public static DsaProblem a2i(String slug, String title, DsaProblem.Difficulty d, String topic, String tags,
                                 String statement, String constraints, String scalarName,
                                 String samplesRaw, String hiddenRaw, DsaFns.FA2I oracle) {
        return build(slug, title, d, topic, tags, DsaSig.A2I, statement, constraints, scalarName, samplesRaw, hiddenRaw, oracle);
    }
    public static DsaProblem ai2i(String slug, String title, DsaProblem.Difficulty d, String topic, String tags,
                                 String statement, String constraints, String scalarName,
                                 String samplesRaw, String hiddenRaw, DsaFns.FAI2I oracle) {
        return build(slug, title, d, topic, tags, DsaSig.AI2I, statement, constraints, scalarName, samplesRaw, hiddenRaw, oracle);
    }
    public static DsaProblem as2i(String slug, String title, DsaProblem.Difficulty d, String topic, String tags,
                                 String statement, String constraints, String scalarName,
                                 String samplesRaw, String hiddenRaw, DsaFns.FAS2I oracle) {
        return build(slug, title, d, topic, tags, DsaSig.AS2I, statement, constraints, scalarName, samplesRaw, hiddenRaw, oracle);
    }
    public static DsaProblem i2a(String slug, String title, DsaProblem.Difficulty d, String topic, String tags,
                                 String statement, String constraints, String scalarName,
                                 String samplesRaw, String hiddenRaw, DsaFns.FI2A oracle) {
        return build(slug, title, d, topic, tags, DsaSig.I2A, statement, constraints, scalarName, samplesRaw, hiddenRaw, oracle);
    }
    public static DsaProblem i2i(String slug, String title, DsaProblem.Difficulty d, String topic, String tags,
                                 String statement, String constraints, String scalarName,
                                 String samplesRaw, String hiddenRaw, DsaFns.FI2I oracle) {
        return build(slug, title, d, topic, tags, DsaSig.I2I, statement, constraints, scalarName, samplesRaw, hiddenRaw, oracle);
    }
    public static DsaProblem i2m(String slug, String title, DsaProblem.Difficulty d, String topic, String tags,
                                 String statement, String constraints, String scalarName,
                                 String samplesRaw, String hiddenRaw, DsaFns.FI2M oracle) {
        return build(slug, title, d, topic, tags, DsaSig.I2M, statement, constraints, scalarName, samplesRaw, hiddenRaw, oracle);
    }
    public static DsaProblem ii2i(String slug, String title, DsaProblem.Difficulty d, String topic, String tags,
                                 String statement, String constraints, String scalarName,
                                 String samplesRaw, String hiddenRaw, DsaFns.FII2I oracle) {
        return build(slug, title, d, topic, tags, DsaSig.II2I, statement, constraints, scalarName, samplesRaw, hiddenRaw, oracle);
    }
    public static DsaProblem s2i(String slug, String title, DsaProblem.Difficulty d, String topic, String tags,
                                 String statement, String constraints, String scalarName,
                                 String samplesRaw, String hiddenRaw, DsaFns.FS2I oracle) {
        return build(slug, title, d, topic, tags, DsaSig.S2I, statement, constraints, scalarName, samplesRaw, hiddenRaw, oracle);
    }
    public static DsaProblem si2s(String slug, String title, DsaProblem.Difficulty d, String topic, String tags,
                                 String statement, String constraints, String scalarName,
                                 String samplesRaw, String hiddenRaw, DsaFns.FSI2S oracle) {
        return build(slug, title, d, topic, tags, DsaSig.SI2S, statement, constraints, scalarName, samplesRaw, hiddenRaw, oracle);
    }
    public static DsaProblem s2s(String slug, String title, DsaProblem.Difficulty d, String topic, String tags,
                                 String statement, String constraints, String scalarName,
                                 String samplesRaw, String hiddenRaw, DsaFns.FS2S oracle) {
        return build(slug, title, d, topic, tags, DsaSig.S2S, statement, constraints, scalarName, samplesRaw, hiddenRaw, oracle);
    }
    public static DsaProblem si2i(String slug, String title, DsaProblem.Difficulty d, String topic, String tags,
                                 String statement, String constraints, String scalarName,
                                 String samplesRaw, String hiddenRaw, DsaFns.FSI2I oracle) {
        return build(slug, title, d, topic, tags, DsaSig.SI2I, statement, constraints, scalarName, samplesRaw, hiddenRaw, oracle);
    }
    public static DsaProblem ss2i(String slug, String title, DsaProblem.Difficulty d, String topic, String tags,
                                 String statement, String constraints, String scalarName,
                                 String samplesRaw, String hiddenRaw, DsaFns.FSS2I oracle) {
        return build(slug, title, d, topic, tags, DsaSig.SS2I, statement, constraints, scalarName, samplesRaw, hiddenRaw, oracle);
    }
    public static DsaProblem ss2s(String slug, String title, DsaProblem.Difficulty d, String topic, String tags,
                                 String statement, String constraints, String scalarName,
                                 String samplesRaw, String hiddenRaw, DsaFns.FSS2S oracle) {
        return build(slug, title, d, topic, tags, DsaSig.SS2S, statement, constraints, scalarName, samplesRaw, hiddenRaw, oracle);
    }
    public static DsaProblem sss2i(String slug, String title, DsaProblem.Difficulty d, String topic, String tags,
                                 String statement, String constraints, String scalarName,
                                 String samplesRaw, String hiddenRaw, DsaFns.FSSS2I oracle) {
        return build(slug, title, d, topic, tags, DsaSig.SSS2I, statement, constraints, scalarName, samplesRaw, hiddenRaw, oracle);
    }

    @SuppressWarnings("unchecked")
    private static DsaProblem build(String slug, String title, DsaProblem.Difficulty d, String topic, String tags,
                                    DsaSig sig, String statement, String constraints, String scalarName,
                                    String samplesRaw, String hiddenRaw, Object oracle) {
        List<String[]> samples = splitTests(samplesRaw);
        List<String> hidden = splitLines(hiddenRaw);
        return new DsaProblem(slug, title, d, topic,
                Arrays.stream((tags == null ? "" : tags).split(",")).map(String::trim).filter(t -> !t.isEmpty()).toList(),
                sig, statement, constraints,
                scalarName == null || scalarName.isBlank() ? "k" : scalarName,
                samples, hidden, oracle);
    }

    private static List<String[]> splitTests(String raw) {
        List<String[]> out = new ArrayList<>();
        for (String line : splitLines(raw)) out.add(new String[]{ line });
        return out;
    }

    private static List<String> splitLines(String raw) {
        if (raw == null || raw.isBlank()) return List.of();
        return Arrays.stream(raw.split("\\n"))
                .map(String::trim)
                .filter(s -> !s.isEmpty())
                .toList();
    }

    /** JSON serializer for the summary used by the controller (kept dependency-free). */
    public static String summaryJson(List<DProblemSummary> list) {
        StringBuilder sb = new StringBuilder("[");
        for (int i = 0; i < list.size(); i++) {
            if (i > 0) sb.append(",");
            DProblemSummary s = list.get(i);
            sb.append("{\"slug\":\"").append(esc(s.slug())).append("\",")
              .append("\"title\":\"").append(esc(s.title())).append("\",")
              .append("\"difficulty\":\"").append(esc(s.difficulty())).append("\",")
              .append("\"topic\":\"").append(esc(s.topic())).append("\",")
              .append("\"tags\":[");
            for (int j = 0; j < s.tags().size(); j++) {
                if (j > 0) sb.append(",");
                sb.append("\"").append(esc(s.tags().get(j))).append("\"");
            }
            sb.append("],\"signature\":\"").append(esc(s.signature())).append("\",")
              .append("\"cSupported\":").append(s.cSupported()).append(",")
              .append("\"constraints\":\"").append(esc(s.constraints())).append("\",")
              .append("\"statement\":\"").append(esc(s.statement())).append("\",")
              .append("\"samples\":[");
            for (int j = 0; j < s.samples().size(); j++) {
                if (j > 0) sb.append(",");
                Object[] pair = s.samples().get(j);
                sb.append("{\"input\":\"").append(esc(String.valueOf(pair[0]))).append("\",")
                  .append("\"expected\":\"").append(esc(String.valueOf(pair[1]))).append("\"}");
            }
            sb.append("]}");
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
