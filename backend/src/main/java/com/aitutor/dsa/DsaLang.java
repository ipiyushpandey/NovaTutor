package com.aitutor.dsa;

import java.util.Locale;
import java.util.stream.IntStream;

/**
 * Generates a complete, compilable program per language by combining fixed
 * harness code (I/O plumbing + canonical output printing) with the student's
 * implementation of the required {@code solve} function.
 *
 * Per-language conventions taught by the starter code:
 *   Java        → class Solution { public static &lt;T&gt; solve(...) }
 *   Python      → def solve(...):
 *   C++         → free function  &lt;T&gt; solve(...)
 *   C           → void solve(typed args..., Result* out)   (fill out.i / out.arr / out.str)
 *   JavaScript  → function solve(...)
 *   Go          → func solve(...)
 *
 * C does not support MATRIX-returning problems (the UI hides C there);
 * everything else is uniform across all six languages.
 */
public enum DsaLang {
    JAVA, PYTHON, CPP, C, JAVASCRIPT, GO;

    public static DsaLang parse(String raw) {
        if (raw == null || raw.isBlank()) return JAVA;
        return switch (raw.trim().toLowerCase(Locale.ROOT)) {
            case "python", "python3", "py" -> PYTHON;
            case "c++", "cpp", "cplusplus" -> CPP;
            case "c" -> C;
            case "javascript", "js", "node", "nodejs" -> JAVASCRIPT;
            case "go", "golang" -> GO;
            default -> JAVA;
        };
    }

    public String label() {
        return switch (this) {
            case JAVA -> "Java"; case PYTHON -> "Python"; case CPP -> "C++";
            case C -> "C"; case JAVASCRIPT -> "JavaScript"; case GO -> "Go";
        };
    }

    public boolean supports(DsaSig sig) {
        return !(this == C && sig.ret == DsaKind.MATRIX);
    }

    // =====================================================================
    //  Starters (what the student sees in the editor)
    // =====================================================================

    public String starter(DsaSig sig) {
        return switch (this) {
            case JAVA -> javaStarter(sig);
            case PYTHON -> pythonStarter(sig);
            case CPP -> cppStarter(sig);
            case C -> cStarter(sig);
            case JAVASCRIPT -> jsStarter(sig);
            case GO -> goStarter(sig);
        };
    }

    /** Unique, kind-based parameter name: s/t/u for strings, n/k/m… for scalars, nums/matrix otherwise. */
    private static String paramName(DsaSig sig, int i) {
        DsaKind kind = sig.params.get(i);
        int idx = 0;
        for (int j = 0; j < i; j++) if (sig.params.get(j) == kind) idx++;
        return switch (kind) {
            case ARRAY -> idx == 0 ? "nums" : "nums" + (idx + 1);
            case MATRIX -> idx == 0 ? "matrix" : "matrix" + (idx + 1);
            case SCALAR, INT -> switch (idx) { case 0 -> "n"; case 1 -> "k"; default -> "m" + idx; };
            case STRING -> switch (idx) { case 0 -> "s"; case 1 -> "t"; case 2 -> "u"; default -> "s" + (idx + 1); };
        };
    }

    private static String pyParams(DsaSig sig) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < sig.params.size(); i++) {
            if (i > 0) sb.append(", ");
            sb.append(paramName(sig, i));
        }
        return sb.toString();
    }

    private static String javaStarter(DsaSig sig) {
        StringBuilder pb = new StringBuilder();
        for (int i = 0; i < sig.params.size(); i++) {
            if (i > 0) pb.append(", ");
            pb.append(switch (sig.params.get(i)) {
                case ARRAY -> "int[] " + paramName(sig, i);
                case MATRIX -> "int[][] " + paramName(sig, i);
                case SCALAR, INT -> "int " + paramName(sig, i);
                case STRING -> "String " + paramName(sig, i);
            });
        }
        String params = pb.toString();
        String ret = switch (sig.ret) {
            case INT -> "int"; case ARRAY -> "int[]"; case MATRIX -> "int[][]"; case STRING -> "String"; default -> "int";
        };
        return "class Solution {\n"
             + "    public static " + ret + " solve(" + params + ") {\n"
             + "        // Write your logic here\n"
             + (sig.ret == DsaKind.INT ? "        return 0;\n" : "        return null; // TODO\n")
             + "    }\n"
             + "}\n";
}

    private static String pythonStarter(DsaSig sig) {
        return "def solve(" + pyParams(sig) + "):\n"
             + "    # Write your logic here\n"
             + "    pass\n";
    }

    private static String cppStarter(DsaSig sig) {
        String ret = switch (sig.ret) {
            case INT -> "int"; case ARRAY -> "vector<int>"; case MATRIX -> "vector<vector<int>>"; case STRING -> "string"; default -> "int";
        };
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < sig.params.size(); i++) {
            if (i > 0) sb.append(", ");
            sb.append(switch (sig.params.get(i)) {
                case ARRAY -> "vector<int>& " + paramName(sig, i);
                case MATRIX -> "vector<vector<int>>& " + paramName(sig, i);
                case SCALAR, INT -> "int " + paramName(sig, i);
                case STRING -> "string " + paramName(sig, i);
            });
}
        return "#include <bits/stdc++.h>\nusing namespace std;\n\n"
             + ret + " solve(" + sb + ") {\n"
             + "    // Write your logic here\n"
             + (sig.ret == DsaKind.INT ? "    return 0;\n" : "    return {}; // TODO\n")
             + "}\n";
    }

    private static String cStarter(DsaSig sig) {
        StringBuilder args = new StringBuilder();
        int arrIdx = 0, matIdx = 0, scalIdx = 0, strIdx = 0;
        for (int i = 0; i < sig.params.size(); i++) {
            if (i > 0) args.append(", ");
            args.append(            switch (sig.params.get(i)) {
                case ARRAY -> {
                    int idx = arrIdx++;
                    String sfx = idx == 0 ? "" : String.valueOf(idx + 1);
                    yield "const int* nums" + sfx + ", int nums_len" + sfx;
                }
                case MATRIX -> "int** matrix, int* row_lens, int rows";
                case SCALAR, INT -> "int " + (scalIdx++ == 0 ? "n" : "k");
                case STRING -> {
                    int si = strIdx++;
                    yield "const char* " + (si == 0 ? "s" : si == 1 ? "t" : "u");
                }
            });
        }
        String fill = switch (sig.ret) {
            case INT -> "    out->i = 0; /* TODO: store your answer here */";
            case ARRAY -> "    /* TODO: out->arr[i] = ...; out->arr_len = ...; */";
            case STRING -> "    snprintf(out->str, sizeof(out->str), \"TODO\");";
            default -> "    /* TODO */";
        };
        return "/* The judge reads the input, calls solve() and prints the result.\n"
             + " * Fill the Result:  out->i  (int answer)\n"
             + " *                   out->arr / out->arr_len  (array answer)\n"
             + " *                   out->str  (string answer)\n"
             + " */\n"
             + "void solve(" + args + ", Result* out) {\n"
             + fill + "\n"
             + "}\n";
    }

    private static String jsStarter(DsaSig sig) {
        JsSig jsig = jsParams(sig);
        return "/**\n * " + jsig.doc + "\n * @return {" + jsig.retDoc + "}\n */\n"
             + "function solve(" + jsig.args + ") {\n"
             + "    // Write your logic here\n"
             + "    return " + (sig.ret == DsaKind.INT ? "0" : "null") + ";\n"
             + "}\n";
    }

    private record JsSig(String args, String doc, String retDoc) {}
    private static JsSig jsParams(DsaSig sig) {
        StringBuilder args = new StringBuilder(), doc = new StringBuilder();
        for (int i = 0; i < sig.params.size(); i++) {
            if (i > 0) { args.append(", "); doc.append(", "); }
            String name = paramName(sig, i);
            String type = switch (sig.params.get(i)) {
                case ARRAY -> "number[]"; case MATRIX -> "number[][]";
                case SCALAR, INT -> "number"; case STRING -> "string";
            };
            args.append(name); doc.append(type).append(" ").append(name);
        }
        String retDoc = switch (sig.ret) {
            case INT -> "number"; case ARRAY -> "number[]"; case MATRIX -> "number[][]"; case STRING -> "string"; default -> "number";
        };
        return new JsSig(args.toString(), doc.toString(), retDoc);
}

    private static String goStarter(DsaSig sig) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < sig.params.size(); i++) {
            if (i > 0) sb.append(", ");
            sb.append(switch (sig.params.get(i)) {
                case ARRAY -> paramName(sig, i) + " []int";
                case MATRIX -> paramName(sig, i) + " [][]int";
                case SCALAR, INT -> paramName(sig, i) + " int";
                case STRING -> paramName(sig, i) + " string";
            });
        }
        String ret = switch (sig.ret) {
            case INT -> "int"; case ARRAY -> "[]int"; case MATRIX -> "[][]int"; case STRING -> "string"; default -> "int";
        };
        String zero = switch (sig.ret) {
            case INT -> "0"; case STRING -> "\"\""; default -> "nil";
        };
        return "package main\n\n"
             + "func solve(" + sb + ") " + ret + " {\n"
             + "    // Write your logic here\n"
             + "    return " + zero + "\n"
             + "}\n";
    }

    // =====================================================================
    //  Harness (what actually runs in the sandbox)
    // =====================================================================

    public String harness(DsaSig sig, String userCode) {
        String code = userCode == null ? "" : userCode;
        return switch (this) {
            case JAVA -> javaHarness(sig, code);
            case PYTHON -> pythonHarness(sig, code);
            case CPP -> cppHarness(sig, code);
            case C -> cHarness(sig, code);
            case JAVASCRIPT -> jsHarness(sig, code);
            case GO -> goHarness(sig, code);
        };
    }

    // ------------------------------------------------------------------ Java
    private static String javaHarness(DsaSig sig, String userCode) {
        StringBuilder userImports = new StringBuilder();
        StringBuilder userBody = new StringBuilder();
        for (String line : userCode.split("\\R", -1)) {
            String trimmed = line.trim();
            if (trimmed.startsWith("import ") && trimmed.contains(";")) {
                userImports.append(trimmed, 0, trimmed.indexOf(';') + 1).append('\n');
            } else {
                userBody.append(line).append('\n');
            }
        }
        String user = userBody.toString().replaceFirst("\\bpublic\\s+(?:final\\s+)?class\\s+Solution\\b", "class Solution");
        String args = javaArgs(sig);
        String call = switch (sig.ret) {
            case INT, STRING -> "System.out.println(Solution.solve(" + args + "));";
            case ARRAY -> "ptArr(Solution.solve(" + args + "));";
            case MATRIX -> "ptMat(Solution.solve(" + args + "));";
            default -> "System.out.println(Solution.solve(" + args + "));";
        };
        return """
            import java.util.*;
            import java.io.*;
            %IMPORTS%
            public class Main {
                private static int[] rdArr(String s) {
                    s = s == null ? "" : s.trim();
                    if (s.isEmpty()) return new int[0];
                    String[] p = s.split(",");
                    int[] a = new int[p.length];
                    for (int i = 0; i < p.length; i++) a[i] = Integer.parseInt(p[i].trim());
                    return a;
                }
                private static int[][] rdMat(String s) {
                    s = s == null ? "" : s.trim();
                    if (s.isEmpty()) return new int[0][];
                    String[] rows = s.split(";");
                    int[][] m = new int[rows.length][];
                    for (int r = 0; r < rows.length; r++) m[r] = rdArr(rows[r]);
                    return m;
                }
                private static void ptArr(int[] a) {
                    StringBuilder sb = new StringBuilder("[");
                    for (int i = 0; i < a.length; i++) { if (i > 0) sb.append(","); sb.append(a[i]); }
                    System.out.println(sb.append("]"));
                }
                private static void ptMat(int[][] m) {
                    StringBuilder sb = new StringBuilder("[");
                    for (int r = 0; r < m.length; r++) {
                        if (r > 0) sb.append(";");
                        for (int c = 0; c < m[r].length; c++) { if (c > 0) sb.append(","); sb.append(m[r][c]); }
                    }
                    System.out.println(sb.append("]"));
                }
                public static void main(String[] args) throws IOException {
                    BufferedReader br = new BufferedReader(new InputStreamReader(System.in));
                    String line;
                    while ((line = br.readLine()) != null) {
                        line = line.trim();
                        if (line.isEmpty()) continue;
                        String[] parts = line.split("\\\\|", -1);
                        try {
                            %CALL%
                        } catch (Throwable e) {
                            System.out.println("ERROR");
                        }
                    }
                }
            }

            // ===== student solution =====
            %USER%
            """
            .replace("%CALL%", call)
            .replace("%IMPORTS%", userImports.toString())
            .replace("%USER%", user.isBlank() ? "// (empty solution)" : user);
    }

    private static String javaArgs(DsaSig sig) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < sig.params.size(); i++) {
            if (i > 0) sb.append(", ");
            sb.append(switch (sig.params.get(i)) {
                case ARRAY -> "rdArr(parts[" + i + "])";
                case MATRIX -> "rdMat(parts[" + i + "])";
                case SCALAR, INT -> "Integer.parseInt(parts[" + i + "].trim())";
                case STRING -> "parts[" + i + "]";
            });
        }
        return sb.toString();
    }

    // ---------------------------------------------------------------- Python
    private static String pythonHarness(DsaSig sig, String userCode) {
        String args = String.join(", ", IntStream.range(0, sig.params.size()).mapToObj(i -> pyArg(sig, i)).toList());
        return """
            import sys
            sys.setrecursionlimit(300000)

            def _canon(v):
                if isinstance(v, (list, tuple)):
                    if v and isinstance(v[0], (list, tuple)):
                        return "[" + ";".join(",".join(str(x) for x in row) for row in v) + "]"
                    return "[" + ",".join(str(x) for x in v) + "]"
                return str(v)

            def _rdArr(s):
                s = (s or "").strip()
                return [int(x) for x in s.split(",")] if s else []

            def _rdMat(s):
                s = (s or "").strip()
                return [_rdArr(r) for r in s.split(";")] if s else []

            %USER%

            for _line in sys.stdin:
                _line = _line.strip()
                if not _line:
                    continue
                _parts = _line.split("|")
                try:
                    print(_canon(solve(%ARGS%)))
                except Exception:
                    print("ERROR")
            """
            .replace("%ARGS%", args)
            .replace("%USER%", userCode.isBlank() ? "# (empty solution)" : userCode);
    }

    private static String pyArg(DsaSig sig, int i) {
        return switch (sig.params.get(i)) {
            case ARRAY -> "_rdArr(_parts[" + i + "])";
            case MATRIX -> "_rdMat(_parts[" + i + "])";
            case SCALAR, INT -> "int(_parts[" + i + "])";
            case STRING -> "_parts[" + i + "]";
        };
    }

    // ------------------------------------------------------------------- C++
    private static String cppHarness(DsaSig sig, String userCode) {
        // Array arguments must be bound to named lvalues: student signatures take
        // `vector<int>&`, and a temporary returned by rdArr() cannot bind to a
        // non-const reference (that used to make every C++ submission fail to
        // compile even when the solution was correct).
        StringBuilder prep = new StringBuilder();
        StringBuilder argList = new StringBuilder();
        for (int i = 0; i < sig.params.size(); i++) {
            if (i > 0) argList.append(", ");
            switch (sig.params.get(i)) {
                case ARRAY -> {
                    prep.append("auto _a").append(i).append(" = rdArr(parts[").append(i).append("]); ");
                    argList.append("_a").append(i);
                }
                case MATRIX -> {
                    prep.append("auto _m").append(i).append(" = rdMat(parts[").append(i).append("]); ");
                    argList.append("_m").append(i);
                }
                case STRING -> argList.append("parts[").append(i).append("]");
                case SCALAR, INT -> argList.append("stoi(parts[").append(i).append("])");
            }
        }
        String args = argList.toString();
        String call = switch (sig.ret) {
            case INT, STRING -> "cout << solve(" + args + ") << endl;";
            case ARRAY -> "ptArr(solve(" + args + "));";
            case MATRIX -> "ptMat(solve(" + args + "));";
            default -> "cout << solve(" + args + ") << endl;";
        };
        return """
            #include <bits/stdc++.h>
            using namespace std;

            static vector<int> rdArr(const string& s) {
                vector<int> out;
                stringstream ss(s);
                string t;
                while (getline(ss, t, ',')) {
                    if (!t.empty()) out.push_back(stoi(t));
                }
                return out;
            }
            static vector<vector<int>> rdMat(const string& s) {
                vector<vector<int>> out;
                stringstream ss(s);
                string row;
                while (getline(ss, row, ';')) out.push_back(rdArr(row));
                return out;
            }
            static void ptArr(const vector<int>& a) {
                cout << "[";
                for (size_t i = 0; i < a.size(); i++) { if (i) cout << ","; cout << a[i]; }
                cout << "]\\n";
            }
            static void ptMat(const vector<vector<int>>& m) {
                cout << "[";
                for (size_t r = 0; r < m.size(); r++) {
                    if (r) cout << ";";
                    for (size_t c = 0; c < m[r].size(); c++) { if (c) cout << ","; cout << m[r][c]; }
                }
                cout << "]\\n";
            }

            // ===== student solution =====
            %USER%

            int main() {
                ios_base::sync_with_stdio(false);
                cin.tie(NULL);
                string line;
                while (getline(cin, line)) {
                    if (!line.empty() && line.back() == '\\r') line.pop_back();
                    if (line.empty()) continue;
                    vector<string> parts;
                    string cur;
                    for (char ch : line) {
                        if (ch == '|') { parts.push_back(cur); cur.clear(); }
                        else cur += ch;
                    }
                    parts.push_back(cur);
                    try {
                        %CALL%
                    } catch (...) {
                        cout << "ERROR" << endl;
                    }
                }
                return 0;
            }
            """
            .replace("%CALL%", prep + call)
            .replace("%USER%", userCode.isBlank() ? "// (empty solution)" : userCode);
    }

    // --------------------------------------------------------------------- C
    private static String cHarness(DsaSig sig, String userCode) {
        StringBuilder helpers = new StringBuilder();
        StringBuilder decls = new StringBuilder();
        StringBuilder parse = new StringBuilder();
        StringBuilder args = new StringBuilder();

        int arrIdx = 0, matIdx = 0, scalIdx = 0, strIdx = 0;
        for (int i = 0; i < sig.params.size(); i++) {
            if (i > 0) args.append(", ");
            switch (sig.params.get(i)) {
                case ARRAY -> {
                    String b = "_b" + arrIdx;
                    helpers.append("static int ").append(b).append("[200005];\n");
                    parse.append("int _l").append(arrIdx)
                         .append(" = _parseArr(parts[").append(i).append("], ").append(b).append(", 200005);\n");
                    args.append("(const int*)").append(b).append(", _l").append(arrIdx);
                    arrIdx++;
                }
                case MATRIX -> {
                    String f = "_m" + matIdx, rp = "_rp" + matIdx, rl = "_rl" + matIdx;
                    helpers.append("static int ").append(f).append("[200005];\n");
                    helpers.append("static int* ").append(rp).append("[1005];\n");
                    helpers.append("static int ").append(rl).append("[1005];\n");
                    parse.append("int _nr").append(matIdx).append(" = _parseMat(parts[").append(i)
                         .append("], ").append(f).append(", 200005, ").append(rp).append(", ").append(rl).append(", 1005);\n");
                    args.append(rp).append(", ").append(rl).append(", _nr").append(matIdx);
                    matIdx++;
                }
                case SCALAR, INT -> {
                    args.append("atoi(parts[").append(i).append("])");
                    scalIdx++;
                }
                case STRING -> {
                    args.append("parts[").append(i).append("]");
                    strIdx++;
                }
            }
        }

        String print = switch (sig.ret) {
            case INT -> "printf(\"%lld\\n\", _out.i);";
            case STRING -> "printf(\"%s\\n\", _out.str);";
            case ARRAY -> "ptArr(_out.arr, _out.arr_len);";
            default -> "/* MATRIX ret unsupported in C */";
        };

        return """
            #include <stdio.h>
            #include <stdlib.h>
            #include <string.h>

            typedef struct {
                long long i;
                int arr[200005];
                int arr_len;
                char str[100005];
            } Result;

            static int _parseArrN(const char* s, const char* limit, int* out, int cap) {
                int n = 0;
                const char* p = s;
                while (p < limit && *p && n < cap) {
                    while (p < limit && (*p == ',' || *p == ' ')) p++;
                    if (p >= limit || !*p || *p == ';') break;
                    char* end;
                    long v = strtol(p, &end, 10);
                    if (end == p) break;
                    out[n++] = (int)v;
                    p = end;
                }
                return n;
            }
            static int _parseArr(const char* s, int* out, int cap) {
                return _parseArrN(s, s + strlen(s), out, cap);
            }
            static int _parseMat(const char* s, int* flat, int flatCap, int** rows, int* rlens, int maxRows) {
                int nrows = 0, fpos = 0;
                const char* p = s;
                while (*p && nrows < maxRows) {
                    const char* rowEnd = p;
                    while (*rowEnd && *rowEnd != ';') rowEnd++;
                    int len = _parseArrN(p, rowEnd, flat + fpos, flatCap - fpos);
                    if (len > 0) { rows[nrows] = flat + fpos; rlens[nrows] = len; nrows++; fpos += len; }
                    if (!*rowEnd) break;
                    p = rowEnd + 1;
                }
                return nrows;
            }
            static void ptArr(const int* a, int n) {
                printf("[");
                for (int i = 0; i < n; i++) { if (i) printf(","); printf("%d", a[i]); }
                printf("]\\n");
            }

            // ===== generated buffers =====
            %HELPERS%

            // ===== student solution =====
            %USER%

            static char _line[200005];

            int main(void) {
                while (fgets(_line, sizeof(_line), stdin)) {
                    size_t len = strlen(_line);
                    while (len && (_line[len-1] == '\\n' || _line[len-1] == '\\r')) _line[--len] = 0;
                    if (!len) continue;
                    char* parts[8];
                    int pc = 0;
                    char* cur = _line;
                    while (pc < 8) {
                        parts[pc++] = cur;
                        char* sep = strchr(cur, '|');
                        if (!sep) break;
                        *sep = '\\0';
                        cur = sep + 1;
                    }
                    if (pc < %NPARAMS%) continue;
                    {
            %DECLS%
            %PARSE%
                        static Result _out;
                        memset(&_out, 0, sizeof(_out));
                        solve(%ARGS%, &_out);
                        %PRINT%
                    }
                }
                return 0;
            }
            """
            .replace("%NPARAMS%", String.valueOf(sig.params.size()))
            .replace("%DECLS%", decls.toString())
            .replace("%PARSE%", parse.toString())
            .replace("%ARGS%", args.toString())
            .replace("%PRINT%", print)
            .replace("%HELPERS%", helpers.toString())
            .replace("%USER%", userCode.isBlank() ? "/* (empty solution) */" : userCode);
    }

    // ------------------------------------------------------------- JavaScript
    private static String jsHarness(DsaSig sig, String userCode) {
        String args = String.join(", ", IntStream.range(0, sig.params.size()).mapToObj(i -> jsArg(sig, i)).toList());
        String call = switch (sig.ret) {
            case INT, STRING -> "console.log(_canon(solve(" + args + ")));";
            case ARRAY, MATRIX -> "console.log(_canon(solve(" + args + ")));";
            default -> "console.log(_canon(solve(" + args + ")));";
        };
        return """
            const _canon = (v) => {
                if (Array.isArray(v)) {
                    if (v.length && Array.isArray(v[0])) {
                        return '[' + v.map(r => r.join(',')).join(';') + ']';
                    }
                    return '[' + v.join(',') + ']';
                }
                return String(v);
            };
            const _rdArr = (s) => { s = (s || '').trim(); return s ? s.split(',').map(Number) : []; };
            const _rdMat = (s) => { s = (s || '').trim(); return s ? s.split(';').map(_rdArr) : []; };

            // ===== student solution =====
            %USER%

            const _lines = require('fs').readFileSync(0, 'utf8').split('\\n');
            for (const _line of _lines) {
                const t = _line.trim();
                if (!t) continue;
                const _parts = t.split('|');
                try {
                    %CALL%
                } catch (e) {
                    console.log('ERROR');
                }
            }
            """
            .replace("%CALL%", call)
            .replace("%USER%", userCode.isBlank() ? "// (empty solution)" : userCode);
    }

    private static String jsArg(DsaSig sig, int i) {
        return switch (sig.params.get(i)) {
            case ARRAY -> "_rdArr(_parts[" + i + "])";
            case MATRIX -> "_rdMat(_parts[" + i + "])";
            case SCALAR, INT -> "parseInt(_parts[" + i + "], 10)";
            case STRING -> "_parts[" + i + "]";
        };
    }

    // -------------------------------------------------------------------- Go
    private static String goHarness(DsaSig sig, String userCode) {
        String args = String.join(", ", IntStream.range(0, sig.params.size()).mapToObj(i -> goArg(sig, i)).toList());
        String call = switch (sig.ret) {
            case INT, STRING -> "fmt.Println(solve(" + args + "))";
            case ARRAY -> "ptArr(solve(" + args + "))";
            case MATRIX -> "ptMat(solve(" + args + "))";
            default -> "fmt.Println(solve(" + args + "))";
        };
        // Strip leading `package ...` declaration from student code so the
        // harness never emits duplicate `package main` lines that fail Go compilation.
        String cleanedUser = userCode.replaceFirst("(?s)^\\s*package\\s+\\w+\\s*;?\\s*\\R*", "");
        // Hoist single-line `import "pkg"` and multi-line `import ( ... )` blocks
        // to the top import block and deduplicate against harness built-in imports.
        java.util.LinkedHashSet<String> imports = new java.util.LinkedHashSet<>(
                java.util.List.of("\"bufio\"", "\"fmt\"", "\"os\"", "\"strconv\"", "\"strings\""));
        StringBuilder userBody = new StringBuilder();
        String[] lines = cleanedUser.split("\\R", -1);
        boolean inImportBlock = false;
        for (String line : lines) {
            String trimmed = line.trim();
            if (inImportBlock) {
                if (trimmed.startsWith(")")) {
                    inImportBlock = false;
                    continue;
                }
                int commentIdx = trimmed.indexOf("//");
                String spec = (commentIdx >= 0 ? trimmed.substring(0, commentIdx) : trimmed).trim();
                if (!spec.isBlank() && spec.contains("\"")) {
                    imports.add(spec);
                }
                continue;
            }
            if (trimmed.matches("^import\\s*\\(\\s*(?://.*)?$")) {
                inImportBlock = true;
                continue;
            }
            if (trimmed.matches("^import\\s+(?:[A-Za-z0-9_.]\\s+)?\"[^\"]+\"\\s*;?\\s*(?://.*)?$")) {
                int commentIdx = trimmed.indexOf("//");
                String spec = (commentIdx >= 0 ? trimmed.substring(0, commentIdx) : trimmed)
                        .replaceFirst("^import\\s+", "").replaceAll(";\\s*$", "").trim();
                if (!spec.isBlank()) imports.add(spec);
                continue;
            }
            userBody.append(line).append('\n');
        }
        StringBuilder importLines = new StringBuilder();
        for (String imp : imports) {
            importLines.append("    ").append(imp).append('\n');
        }
        String finalUser = userBody.toString();
        return """
            package main

            import (
            %IMPORTS%)

            func rdArr(s string) []int {
                s = strings.TrimSpace(s)
                if s == "" { return []int{} }
                fs := strings.Split(s, ",")
                out := make([]int, 0, len(fs))
                for _, x := range fs {
                    v, _ := strconv.Atoi(strings.TrimSpace(x))
                    out = append(out, v)
                }
                return out
            }
            func rdMat(s string) [][]int {
                s = strings.TrimSpace(s)
                if s == "" { return [][]int{} }
                rows := strings.Split(s, ";")
                out := make([][]int, 0, len(rows))
                for _, r := range rows { out = append(out, rdArr(r)) }
                return out
            }
            func ptArr(a []int) {
                fmt.Print("[")
                for i, v := range a {
                    if i > 0 { fmt.Print(",") }
                    fmt.Print(v)
                }
                fmt.Println("]")
            }
            func ptMat(m [][]int) {
                fmt.Print("[")
                for r, row := range m {
                    if r > 0 { fmt.Print(";") }
                    for c, v := range row {
                        if c > 0 { fmt.Print(",") }
                        fmt.Print(v)
                    }
                }
                fmt.Println("]")
            }

            // ===== student solution =====
            %USER%

            func main() {
                sc := bufio.NewScanner(os.Stdin)
                sc.Buffer(make([]byte, 1024*1024), 1024*1024)
                for sc.Scan() {
                    line := strings.TrimSpace(sc.Text())
                    if line == "" { continue }
                    parts := strings.Split(line, "|")
                    func() {
                        defer func() {
                            if r := recover(); r != nil { fmt.Println("ERROR") }
                        }()
                        %CALL%
                    }()
                }
            }
            """
            .replace("%IMPORTS%", importLines.toString())
            .replace("%CALL%", call)
            .replace("%USER%", finalUser.isBlank() ? "// (empty solution)" : finalUser);
    }

    private static String goArg(DsaSig sig, int i) {
        return switch (sig.params.get(i)) {
            case ARRAY -> "rdArr(parts[" + i + "])";
            case MATRIX -> "rdMat(parts[" + i + "])";
            case SCALAR, INT -> "func() int { v, _ := strconv.Atoi(strings.TrimSpace(parts[" + i + "])); return v }()";
            case STRING -> "parts[" + i + "]";
        };
    }
}
