#!/usr/bin/env python3
"""Analyzes DSA bank files: for each DsaCatalog.<factory>(...) call, infers the
oracle lambda's true parameter types and return type from the body, then emits
a JSON report used to regenerate catalogs/factories correctly."""
import re, json, sys, os

BANKS = ['DsaBankArrays', 'DsaBankStrings', 'DsaBankBinary',
         'DsaBankLists', 'DsaBankTrees', 'DsaBankGraphs']
ROOT = 'backend/src/main/java/com/aitutor/dsa'

def iter_calls(src):
    """Yield (factory, args_string) for every DsaCatalog.<factory>(...) with balanced parens."""
    for m in re.finditer(r'DsaCatalog\.(\w+)\(', src):
        start = m.end()
        depth = 1
        i = start
        in_str = False
        while i < len(src) and depth > 0:
            ch = src[i]
            if in_str:
                if ch == '\\': i += 1
                elif ch == '"': in_str = False
            elif ch == '"': in_str = True
            elif ch == '(': depth += 1
            elif ch == ')': depth -= 1
            i += 1
        yield m.group(1), src[start:i-1]

def split_top_args(args):
    """Split an argument list on top-level commas (strings and parens respected)."""
    parts, depth, cur, in_str, i = [], 0, [], False, 0
    while i < len(args):
        ch = args[i]
        if in_str:
            cur.append(ch)
            if ch == '\\': cur.append(args[i+1]); i += 1
            elif ch == '"': in_str = False
        elif ch == '"':
            in_str = True; cur.append(ch)
        elif ch in '([{': depth += 1; cur.append(ch)
        elif ch in ')]}': depth -= 1; cur.append(ch)
        elif ch == ',' and depth == 0:
            parts.append(''.join(cur).strip()); cur = []
        else: cur.append(ch)
        i += 1
    if cur: parts.append(''.join(cur).strip())
    return parts

def main():
    out = {}
    for bank in BANKS:
        src = open(os.path.join(ROOT, bank + '.java')).read()
        for factory, args in iter_calls(src):
            top = split_top_args(args)
            if not top: continue
            slug_m = re.match(r'"([^"]+)"', top[0])
            if not slug_m: continue
            slug = slug_m.group(1)
            oracle = top[-1]  # last argument is the oracle lambda
            if '->' not in oracle:
                out[slug] = {'bank': bank, 'called': factory, 'params': [],
                             'param_kinds': [], 'ret': 'METHOD_REF', 'body_head': oracle[:80]}
                continue
            arrow = oracle.index('->')
            head, body = oracle[:arrow].strip(), oracle[arrow+2:].strip()
            params = head.strip()[1:-1].strip() if head.startswith('(') else head.strip()
            plist = [p.strip() for p in params.split(',') if p.strip()]
            ret = infer_return(body)
            out[slug] = {
                'bank': bank, 'called': factory, 'params': plist,
                'param_kinds': [infer_kind(p, body) for p in plist],
                'ret': ret, 'body_head': body[:80]
            }
    json.dump(out, sys.stdout, indent=1)

def infer_kind(p, body):
    name = p.split()[-1] if ' ' in p else p
    e = re.escape(name)
    # string evidence first (methods unique to strings)
    if re.search(r'\b' + e + r'\.(charAt|split|substring|trim|toLowerCase|toUpperCase|equals|indexOf|startsWith|endsWith|strip)\b', body):
        return 'STRING'
    # array evidence: .length without parens, indexing, clone
    if re.search(r'\b' + e + r'\.length\b(?!\()', body) or re.search(r'\b' + e + r'\s*\[', body) or re.search(r'\b' + e + r'\.clone\(\)', body):
        return 'ARRAY'
    if name in ('s', 't', 's3', 'word', 'wordsRaw', 'mk', 'prefix', 'query'): return 'STRING'
    return 'SCALAR'

def infer_return(body):
    b = body.strip()
    if b.startswith('{'):  # block lambda: look at return statements
        rets = re.findall(r'return\s+([^;]+);', b)
        kinds = set()
        for r in rets:
            kinds.add(ret_kind(r))
        if kinds == {'INT'}: return 'INT'
        if 'MATRIX' in kinds: return 'MATRIX'
        if 'ARRAY' in kinds: return 'ARRAY'
        if 'STRING' in kinds: return 'STRING'
        if kinds: return kinds.pop()
        return 'VOID'
    return ret_kind(b)

def ret_kind(expr):
    e = expr.strip()
    if re.search(r'new\s+int\s*\[[^\]]*\]\s*\[', e): return 'MATRIX'
    if re.search(r'new\s+int\s*\[', e): return 'ARRAY'
    if re.search(r'\.stream\(\)\.mapToInt|copyOf|copyOfRange|\.toArray\(\)', e): return 'ARRAY'
    if re.search(r'new\s+String|substring|toLowerCase|toUpperCase|\.trim\(\)|String\.join|toString\(\)|reverse\(\)\.toString', e): return 'STRING'
    if re.search(r'\[\]', e): return 'ARRAY'
    return 'INT'

if __name__ == '__main__':
    main()
