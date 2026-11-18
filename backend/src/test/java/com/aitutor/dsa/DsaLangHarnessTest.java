package com.aitutor.dsa;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

/** Harness/starter generation contract for all 6 languages x signature shapes. */
class DsaLangHarnessTest {

    @Test
    void javaStarterHasTypedSignature() {
        String s = DsaLang.JAVA.starter(DsaSig.A2A);
        assertTrue(s.contains("public static int[] solve(int[] nums)"), s);
        s = DsaLang.JAVA.starter(DsaSig.SI2S);
        assertTrue(s.contains("public static String solve(String s, int n)"), s);
    }

    @Test
    void pythonStarterHasParams() {
        String s = DsaLang.PYTHON.starter(DsaSig.SSS2I);
        assertTrue(s.startsWith("def solve(s, t, u):"), s);
    }

    @Test
    void cppStarterCompilesShapedSignature() {
        String s = DsaLang.CPP.starter(DsaSig.AI2I);
        assertTrue(s.contains("int solve(vector<int>& nums, int n)"), s);
    }

    @Test
    void goStarterHasTypedParams() {
        String s = DsaLang.GO.starter(DsaSig.A2I);
        assertTrue(s.contains("func solve(nums []int) int {"), s);
        s = DsaLang.GO.starter(DsaSig.SSS2I);
        assertTrue(s.contains("func solve(s string, t string, u string) int {"), s);
    }

    @Test
    void cDoesNotSupportMatrixReturn() {
        for (DsaSig sig : DsaSig.values()) {
            if (sig.ret == DsaKind.MATRIX) {
                assertFalse(DsaLang.C.supports(sig), sig.name());
            } else {
                assertTrue(DsaLang.C.supports(sig), sig.name());
            }
        }
    }

    @Test
    void javaHarnessEmbedsUserCodeAndSplitter() {
        String h = DsaLang.JAVA.harness(DsaSig.A2I, "class Solution { public static int solve(int[] nums){ return 1; } }");
        assertTrue(h.contains("class Solution"), "user code embedded");
        assertTrue(h.contains("split(\"\\\\|\", -1)"), "pipe splitter present");
        assertTrue(h.contains("public class Main"), "main class present");
    }

    @Test
    void pythonHarnessEmbedsUserCodeAndCanon() {
        String h = DsaLang.PYTHON.harness(DsaSig.S2S, "def solve(s):\n    return s[::-1]");
        assertTrue(h.contains("def solve(s):"), "user code embedded");
        assertTrue(h.contains("_canon"), "canonical printer present");
    }

    @Test
    void goHarnessContainsNoForeignSyntax() {
        // Regression: a stray Java 'default -> throw' line once shipped inside the Go template.
        String h = DsaLang.GO.harness(DsaSig.A2I, "func solve(nums []int) int { return 0 }");
        assertFalse(h.contains("default ->"), "Java switch syntax leaked into Go harness");
        assertFalse(h.contains("IllegalStateException"), "Java exception leaked into Go harness");
        assertTrue(h.contains("package main"));
    }

    @Test
    void jsHarnessContainsNoForeignSyntax() {
        String h = DsaLang.JAVASCRIPT.harness(DsaSig.A2A, "function solve(nums){ return nums; }");
        assertTrue(h.contains("function solve(nums)"), "user code embedded");
        assertFalse(h.contains("System.out"), "Java leaked into JS harness");
    }

    @Test
    void parseReturnsJavaForUnknownLanguage() {
        assertEquals(DsaLang.JAVA, DsaLang.parse("nonsense"));
        assertEquals(DsaLang.PYTHON, DsaLang.parse("python3"));
        assertEquals(DsaLang.CPP, DsaLang.parse("c++"));
    }

    @Test
    void goHarnessStripsDuplicatePackageMainFromStarterOrUserCode() {
        String starter = DsaLang.GO.starter(DsaSig.A2I);
        String h = DsaLang.GO.harness(DsaSig.A2I, starter);
        int first = h.indexOf("package main");
        int second = h.indexOf("package main", first + 1);
        assertTrue(first >= 0, "harness must declare package main once");
        assertEquals(-1, second, "Go harness must never contain duplicate package main");
    }

    @Test
    void pythonAndJsMatrixCanonicalOutputMatchesOracleFormat() {
        String py = DsaLang.PYTHON.harness(DsaSig.I2M, "def solve(n):\n    return [[1,2],[3,4]]");
        assertTrue(py.contains("\";\".join(\",\".join(str(x) for x in row) for row in v)"), py);
        assertFalse(py.contains("\"[\" + \",\".join(str(x) for x in row) + \"]\""), py);

        String js = DsaLang.JAVASCRIPT.harness(DsaSig.I2M, "function solve(n){ return [[1,2],[3,4]]; }");
        assertTrue(js.contains("v.map(r => r.join(',')).join(';')"), js);
        assertFalse(js.contains("v.map(r => '[' + r.join(',') + ']').join(';')"), js);
    }

    @Test
    void javaHoistsUserImportsAndAllHarnessesPreserveLiteralPlaceholdersInUserCode() {
        String javaCode = "import java.math.BigInteger;\nclass Solution { public static int solve(int[] a) { String s = \"%CALL%\"; return a.length; } }";
        String jh = DsaLang.JAVA.harness(DsaSig.A2I, javaCode);
        assertTrue(jh.indexOf("import java.math.BigInteger;") < jh.indexOf("public class Main"),
                "User imports must be hoisted above public class Main");
        assertTrue(jh.contains("String s = \"%CALL%\";"), "Literal %CALL% in user code must not be substituted");

        String pyh = DsaLang.PYTHON.harness(DsaSig.A2I, "def solve(a):\n    note = '%ARGS%'\n    return len(a)");
        assertTrue(pyh.contains("note = '%ARGS%'"), "Literal %ARGS% in Python user code must not be substituted");
    }

    @Test
    void goHarnessHoistsAndDeduplicatesSingleAndBlockImports() {
        String goCode = """
                package main
                import "sort"
                import str "strings"
                import (
                    "fmt"
                    "math"
                    "strings"
                )
                func solve(nums []int) int {
                    sort.Ints(nums)
                    _ = str.TrimSpace("x")
                    return int(math.Abs(float64(len(nums))))
                }
                """;
        String gh = DsaLang.GO.harness(DsaSig.A2I, goCode);
        int importBlockEnd = gh.indexOf(')', gh.indexOf("import ("));
        int userStart = gh.indexOf("// ===== student solution =====");
        assertTrue(importBlockEnd > 0 && importBlockEnd < userStart, "Top import block must appear before student solution");
        String topBlock = gh.substring(0, importBlockEnd + 1);
        String userSection = gh.substring(userStart);
        assertTrue(topBlock.contains("\"sort\""), "User single import must be hoisted");
        assertTrue(topBlock.contains("str \"strings\""), "Multi-char Go import alias must be hoisted");
        assertTrue(topBlock.contains("\"math\""), "User block import must be hoisted");
        // Deduplicated: "fmt" must appear only once in the import block
        assertEquals(topBlock.indexOf("\"fmt\""), topBlock.lastIndexOf("\"fmt\""), "Duplicate fmt import must be deduplicated");
        assertFalse(userSection.contains("import \"sort\""), "Hoisted imports must be removed from user body");
        assertFalse(userSection.contains("import str \"strings\""), "Hoisted aliased import must be removed from user body");
        assertFalse(userSection.contains("import ("), "Hoisted import blocks must be removed from user body");
    }

    @Test
    void cHarnessPreservesEmptyPipeFieldsAndBoundsMatrixRowParsing() {
        String ch = DsaLang.C.harness(DsaSig.SS2I, "void solve(const char* s, const char* t, Result* out) { out->i = 0; }");
        assertFalse(ch.contains("strtok("), "C harness must not use strtok which collapses empty pipe fields");
        assertTrue(ch.contains("strchr(cur, '|')"), "C harness must split on '|' via strchr");
        assertTrue(ch.contains("_parseArrN(p, rowEnd,"), "C matrix parser must bound each row by rowEnd");
    }

    @Test
    void javaHarnessHoistsImportsWithCommentsAndHandlesPublicFinalSolution() {
        String code = "import java.math.BigInteger; // big ints\npublic final class Solution { public static int solve(int[] a) { return a.length; } }";
        String jh = DsaLang.JAVA.harness(DsaSig.A2I, code);
        assertTrue(jh.indexOf("import java.math.BigInteger;") < jh.indexOf("public class Main"));
        assertFalse(jh.contains("public final class Solution"));
        assertTrue(jh.contains("class Solution"));
    }
}
