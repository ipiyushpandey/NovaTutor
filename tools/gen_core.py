#!/usr/bin/env python3
"""Generates DsaKind, DsaSig, DsaFns and the DsaCatalog factory methods from
the signatures actually used by the six bank files (after the rewrite)."""
import re, os, json

BANKS = ['DsaBankArrays', 'DsaBankStrings', 'DsaBankBinary',
         'DsaBankLists', 'DsaBankTrees', 'DsaBankGraphs']
ROOT = 'backend/src/main/java/com/aitutor/dsa'

# ---------------- reuse analyzer from regen_banks ----------------
import importlib.util
spec = importlib.util.spec_from_file_location('rb', 'tools/regen_banks.py')
rb = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rb)

kinds_by_sig = {}
for bank in BANKS:
    src = open(os.path.join(ROOT, bank + '.java')).read()
    for s, e, f, args in rb.iter_calls(src):
        kinds_by_sig.setdefault(f.upper(), args)

# Map sig name -> kinds/ret by decoding the name (suffix tells the return kind)
def decode(sig):
    s = sig.upper()
    p, r = s.split('2', 1)
    KMAP = {'A': 'ARRAY', 'M': 'MATRIX', 'I': 'SCALAR', 'S': 'STRING'}
    RMAP = {'A': 'ARRAY', 'M': 'MATRIX', 'I': 'INT', 'S': 'STRING'}
    return [KMAP[c] for c in p], RMAP[r]

sig_lines, fn_lines, fac_lines = [], [], []
JTYPE = {'A': 'int[]', 'M': 'int[][]', 'I': 'int', 'S': 'String'}
JRET = {'INT': 'int', 'ARRAY': 'int[]', 'STRING': 'String', 'MATRIX': 'int[][]'}

for sig, sample_args in sorted(kinds_by_sig.items()):
    sig = sig.upper()
    kinds, ret = decode(sig)
    letters = [{'ARRAY': 'A', 'MATRIX': 'M', 'SCALAR': 'I', 'STRING': 'S'}[k] for k in kinds]
    kinds_code = ', '.join('DsaKind.' + k for k in kinds)
    kinds_expr = 'List.of(' + kinds_code + ')'
    sig_lines.append(f'    /** {sig} */\n    {sig}({kinds_expr}, DsaKind.{ret}),')
    # functional interface
    iface = 'F' + sig
    fparams = ', '.join(f'{JTYPE[l]} p{i}' for i, l in enumerate(letters))
    fn_lines.append(f'    public interface {iface} {{ {JRET[ret]} apply({fparams}); }}')
    # factory
    fac_params = (', '.join(['String slug', 'String title', 'DsaProblem.Difficulty d',
                             'String topic', 'String tags',
                             'String statement', 'String constraints', 'String scalarName',
                             'String samplesRaw', 'String hiddenRaw'] +
                            [f'{JTYPE[l]} q{i}' for i, l in enumerate(letters)]))
    fac_args = (', '.join(['slug', 'title', 'd', 'topic', 'tags',
                           f'DsaSig.{sig}', 'statement', 'constraints', 'scalarName',
                           'samplesRaw', 'hiddenRaw', 'oracle']))
    fac_lines.append(f'''    public static DsaProblem {sig.lower()}({fac_params}, {iface} oracle) {{
        return build(slug, title, d, topic, tags, DsaSig.{sig}, statement, constraints, scalarName, samplesRaw, hiddenRaw, oracle);
    }}''')

sig_src = f'''package com.aitutor.dsa;

import java.util.List;

/**
 * The call signature of a DSA problem's solve function. GENERATED from the
 * problem banks — every entry is actually used by at least one problem.
 * Param kinds: A=int[], M=int[][], I=int, S=String.
 * Test input line = parameters joined with '|', one test per line.
 */
public enum DsaSig {{
{chr(10).join(sig_lines)};

    public final List<DsaKind> params;
    public final DsaKind ret;

    DsaSig(List<DsaKind> params, DsaKind ret) {{
        this.params = List.copyOf(params);
        this.ret = ret;
    }}

    public String display(String scalarName) {{
        StringBuilder sb = new StringBuilder("solve(");
        for (int i = 0; i < params.size(); i++) {{
            if (i > 0) sb.append(", ");
            sb.append(switch (params.get(i)) {{
                case ARRAY -> "nums";
                case MATRIX -> "matrix";
                case SCALAR, INT -> i == 0 ? "n" : scalarName;
                case STRING -> i == 0 ? "s" : "t";
            }});
        }}
        return sb.append(")").toString();
    }}

    public String typeSummary(String scalarName) {{
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < params.size(); i++) {{
            if (i > 0) sb.append(", ");
            sb.append(switch (params.get(i)) {{
                case ARRAY -> "int[] nums";
                case MATRIX -> "int[][] matrix";
                case SCALAR, INT -> "int " + (i == 0 ? "n" : scalarName);
                case STRING -> i == 0 ? "string s" : "string t";
            }});
        }}
        return sb.append(" → ").append(switch (ret) {{
            case INT -> "int";
            case ARRAY -> "int[]";
            case MATRIX -> "int[][]";
            case STRING -> "string";
            default -> "int";
        }}).toString();
    }}
}}
'''
open(os.path.join(ROOT, 'DsaSig.java'), 'w').write(sig_src)

fn_src = f'''package com.aitutor.dsa;

/** Typed functional interfaces for reference oracles. GENERATED. */
public final class DsaFns {{
    private DsaFns() {{}}

{chr(10).join(fn_lines)}
}}
'''
open(os.path.join(ROOT, 'DsaFns.java'), 'w').write(fn_src)

print('sigs:', len(sig_lines))
for l in sig_lines:
    print('  ', l.strip().split('(')[0].strip())
