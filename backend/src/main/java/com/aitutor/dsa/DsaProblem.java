package com.aitutor.dsa;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.function.Function;

/**
 * A DSA practice problem: statement, signature, sample + hidden tests, and the
 * reference oracle used to produce expected outputs for hidden tests.
 *
 * Hidden test inputs are generated at registration time from the problem's
 * {@code hiddenInputs} spec lines, and their expected outputs are computed by
 * running the oracle — so hidden tests are always consistent with the samples.
 *
 * Spec line grammar (pipe separated, matching DsaSig serialization):
 *   "2,7,11,15|9"        → array | scalar
 *   "1,2,3;4,5,6|3"      → matrix | scalar
 *   "abcabcbb"           → string
 *   "n=1994"             → scalar  (escaped so it can't collide with a string test)
 */
public record DsaProblem(
        String slug,
        String title,
        Difficulty difficulty,
        String topic,
        List<String> tags,
        DsaSig sig,
        String statement,
        String constraints,
        String scalarName,
        List<String[]> sampleInputs,     // raw test lines "a|b|c"
        List<String> hiddenInputs,       // raw test lines "a|b|c" (may reference $n, $k, $i)
        Object oracle                    // matching DsaFns.* functional interface
) {

    public enum Difficulty { EASY, MEDIUM, HARD }

    /** Types a raw input token per the signature. Returns canonical string values. */
    public List<Object> parseInput(String rawLine) {
        String[] tok = rawLine.split("\\|", -1);
        if (tok.length < sig.params.size()) {
            // pad scalars with 0, arrays/matrices/strings with empty
            String[] padded = new String[sig.params.size()];
            for (int i = 0; i < sig.params.size(); i++) {
                padded[i] = i < tok.length ? tok[i] : (sig.params.get(i) == DsaKind.SCALAR ? "0" : "");
            }
            tok = padded;
        }
        List<Object> out = new ArrayList<>();
        for (int i = 0; i < sig.params.size(); i++) {
            out.add(parseToken(sig.params.get(i), tok[i]));
        }
        return out;
    }

    private static Object parseToken(DsaKind kind, String tok) {
        return switch (kind) {
            case ARRAY -> parseInts(tok);
            case MATRIX -> parseMatrix(tok);
            case SCALAR, INT -> Integer.parseInt(tok.trim());
            case STRING -> tok;
        };
    }

    private static int[] parseInts(String s) {
        s = s == null ? "" : s.trim();
        if (s.isEmpty()) return new int[0];
        return Arrays.stream(s.split(",")).map(String::trim).mapToInt(Integer::parseInt).toArray();
    }

    private static int[][] parseMatrix(String s) {
        s = s == null ? "" : s.trim();
        if (s.isEmpty()) return new int[0][];
        String[] rows = s.split(";");
        int[][] m = new int[rows.length][];
        for (int r = 0; r < rows.length; r++) m[r] = parseInts(rows[r]);
        return m;
    }

    /**
     * Returns the raw test lines for the visible sample tests (what the UI shows
     * the student as "Sample Input"). Hidden tests stay server-side.
     */
    public List<String[]> samples() {
        return sampleInputs;
    }

    /** Hidden test inputs with simple macro substitution ($i = case index). */
    public List<String[]> hiddenTests(int count) {
        List<String[]> out = new ArrayList<>();
        List<String> lines = hiddenInputs == null ? List.of() : hiddenInputs;
        int limit = Math.min(count, lines.size());
        for (int i = 0; i < limit; i++) out.add(new String[]{ lines.get(i).replace("$i", String.valueOf(i)) });
        return out;
    }

    /** Evaluates the oracle on a raw input line and returns the canonical expected output. */
    public String expectedFor(String rawLine) {
        List<Object> in = parseInput(rawLine);
        Object out = invokeOracle(in);
        return canonicalize(out);
    }

    public Object invokeOracle(List<Object> in) {
        return switch (sig) {
            case A2A -> ((DsaFns.FA2A) oracle).apply((int[]) in.get(0));
            case A2I -> ((DsaFns.FA2I) oracle).apply((int[]) in.get(0));
            case AI2I -> ((DsaFns.FAI2I) oracle).apply((int[]) in.get(0), (int) in.get(1));
            case AS2I -> ((DsaFns.FAS2I) oracle).apply((int[]) in.get(0), (String) in.get(1));
            case I2A -> ((DsaFns.FI2A) oracle).apply((int) in.get(0));
            case I2I -> ((DsaFns.FI2I) oracle).apply((int) in.get(0));
            case I2M -> ((DsaFns.FI2M) oracle).apply((int) in.get(0));
            case II2I -> ((DsaFns.FII2I) oracle).apply((int) in.get(0), (int) in.get(1));
            case S2I -> ((DsaFns.FS2I) oracle).apply((String) in.get(0));
            case S2S -> ((DsaFns.FS2S) oracle).apply((String) in.get(0));
            case SI2I -> ((DsaFns.FSI2I) oracle).apply((String) in.get(0), (int) in.get(1));
            case SI2S -> ((DsaFns.FSI2S) oracle).apply((String) in.get(0), (int) in.get(1));
            case SS2I -> ((DsaFns.FSS2I) oracle).apply((String) in.get(0), (String) in.get(1));
            case SS2S -> ((DsaFns.FSS2S) oracle).apply((String) in.get(0), (String) in.get(1));
            case SSS2I -> ((DsaFns.FSSS2I) oracle).apply((String) in.get(0), (String) in.get(1), (String) in.get(2));
        };
    }

    /** Canonicalizes an oracle return value into the exact string the harness prints. */
    public static String canonicalize(Object v) {
        if (v instanceof Integer i) return String.valueOf(i);
        if (v instanceof Long l) return String.valueOf(l);
        if (v instanceof String s) return s;
        if (v instanceof int[] a) return joinArray(a);
        if (v instanceof int[][] m) return joinMatrix(m);
        if (v instanceof List<?> l) {
            if (l.isEmpty()) return "[]";
            if (l.get(0) instanceof List<?> || l.get(0) instanceof int[] || l.get(0) instanceof Integer[]) return joinListOfLists(l);
            StringBuilder sb = new StringBuilder("[");
            for (int i = 0; i < l.size(); i++) {
                if (i > 0) sb.append(",");
                Object e = l.get(i);
                sb.append(e instanceof Integer ? e : e);
            }
            return sb.append("]").toString();
        }
        return String.valueOf(v);
    }

    private static String joinArray(int[] a) {
        StringBuilder sb = new StringBuilder("[");
        for (int i = 0; i < a.length; i++) { if (i > 0) sb.append(","); sb.append(a[i]); }
        return sb.append("]").toString();
    }

    private static String joinMatrix(int[][] m) {
        StringBuilder sb = new StringBuilder("[");
        for (int r = 0; r < m.length; r++) {
            if (r > 0) sb.append(";");
            for (int c = 0; c < m[r].length; c++) { if (c > 0) sb.append(","); sb.append(m[r][c]); }
        }
        return sb.append("]").toString();
    }

    private static String joinListOfLists(List<?> l) {
        StringBuilder sb = new StringBuilder("[");
        for (int r = 0; r < l.size(); r++) {
            if (r > 0) sb.append(";");
            Object row = l.get(r);
            List<?> items = row instanceof List<?> rl ? rl : Arrays.asList((Object[]) row);
            for (int c = 0; c < items.size(); c++) {
                if (c > 0) sb.append(",");
                sb.append(items.get(c));
            }
        }
        return sb.append("]").toString();
    }

    /** Pretty input for the UI, e.g. "nums = [2,7,11,15], target = 9". */
    public String prettyInput(String[] rawLine) {
        String[] tok = rawLine[0].split("\\|", -1);
        StringBuilder sb = new StringBuilder();
        int si = 0, mi = 0, ki = 0, ti = 0;
        for (int i = 0; i < sig.params.size() && i < tok.length; i++) {
            if (i > 0) sb.append(", ");
            sb.append(switch (sig.params.get(i)) {
                case ARRAY -> "nums = [" + tok[i] + "]";
                case MATRIX -> "matrix = [" + tok[i].replace(";", "][") + "]";
                case SCALAR, INT -> (ki++ == 0 ? "n = " : scalarName + " = ") + tok[i];
                case STRING -> (ti++ == 0 ? "s = \"" + tok[i] + "\"" : "t = \"" + tok[i] + "\"");
            });
            si = si; mi = mi; // silence unused warnings
        }
        return sb.toString();
    }

    public String displaySignature() {
        return sig.typeSummary(scalarName == null ? "k" : scalarName);
    }

    public boolean languageSupported(String langLabel) {
        try {
            DsaLang l = DsaLang.parse(langLabel);
            return l.supports(sig);
        } catch (Exception e) {
            return false;
        }
    }

    public String difficultyLabel() {
        return difficulty.name().charAt(0) + difficulty.name().substring(1).toLowerCase(Locale.ROOT);
    }
}
