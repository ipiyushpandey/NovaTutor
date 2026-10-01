#!/usr/bin/env python3
"""For every DsaCatalog.<factory>(...) call in the bank files, infers the oracle
lambda's true parameter kinds and return kind, computes the correct signature
name, and rewrites the call to use that factory. Emits the set of signatures
used so the enum/factories can be regenerated."""
import re, json, sys, os

BANKS = ['DsaBankArrays', 'DsaBankStrings', 'DsaBankBinary',
         'DsaBankLists', 'DsaBankTrees', 'DsaBankGraphs']
ROOT = 'backend/src/main/java/com/aitutor/dsa'

STRING_NAMES = {'s', 's3', 'word', 'wordsRaw', 'mk', 'prefix', 'query'}
OVERRIDES = {
    'kth-distinct-string': ('SI', 'S'),
    'sum-root-to-leaf-numbers': ('A', 'I'),
    'binary-tree-max-path-sum-parents': ('A', 'I'),
    'count-good-nodes-parents': ('A', 'I'),
    'validate-bst-parents': ('A', 'I'),
    'copy-list-random-pointer-count': ('A', 'I'),
    'kth-largest-sum-contiguous': ('AI', 'I'),
    'word-break-possible': ('SS', 'I'),
    'restore-ip-addresses-count': ('S', 'I'),
}

def lex_java(src):
    """Yields (kind, text) tokens: STRING, CHAR, COMMENT, WS, CODE. Kind-safe paren tracking."""
    i, n = 0, len(src)
    while i < n:
        ch = src[i]
        if ch == '"':
            j = i + 1
            while j < n:
                if src[j] == '\\': j += 2; continue
                if src[j] == '"': break
                j += 1
            yield ('STRING', src[i:j+1]); i = j + 1
        elif ch == "'":
            j = i + 1
            while j < n:
                if src[j] == '\\': j += 2; continue
                if src[j] == "'": break
                j += 1
            yield ('CHAR', src[i:j+1]); i = j + 1
        elif ch == '/' and i + 1 < n and src[i+1] == '/':
            j = src.find('\n', i)
            j = n if j < 0 else j
            yield ('COMMENT', src[i:j]); i = j
        elif ch == '/' and i + 1 < n and src[i+1] == '*':
            j = src.find('*/', i)
            j = n if j < 0 else j + 2
            yield ('COMMENT', src[i:j]); i = j
        elif ch.isspace():
            j = i
            while j < n and src[j].isspace(): j += 1
            yield ('WS', src[i:j]); i = j
        else:
            j = i
            while j < n and not src[j].isspace() and src[j] not in '"\'': j += 1
            yield ('CODE', src[i:j]); i = j

def find_arrow(oracle):
    """Index of the lambda's own '->' — the first at bracket/paren depth 0, string-aware."""
    depth = 0
    i, n = 0, len(oracle)
    while i < n - 1:
        ch = oracle[i]
        if ch == '"':
            j = i + 1
            while j < n:
                if oracle[j] == '\\': j += 2; continue
                if oracle[j] == '"': break
                j += 1
            i = j + 1; continue
        if ch == "'":
            j = i + 1
            while j < n:
                if oracle[j] == '\\': j += 2; continue
                if oracle[j] == "'": break
                j += 1
            i = j + 1; continue
        if ch in '([{': depth += 1
        elif ch in ')]}': depth -= 1
        elif ch == '-' and oracle[i+1] == '>' and depth == 0:
            return i
        i += 1
    return -1

def iter_calls(src):
    """Yields (start, end, factory, args) for DsaCatalog.<factory>(...) with lexing-aware paren matching."""
    toks = list(lex_java(src))
    # positions: reconstruct offset per token
    offs, pos = [], 0
    for k, t in toks:
        offs.append(pos); pos += len(t)
    for idx, (k, t) in enumerate(toks):
        if k != 'CODE' or 'DsaCatalog.' not in t: continue
        m = re.search(r'DsaCatalog\.(\w+)\($', t)
        if not m: continue
        # find matching close paren among following CODE tokens
        depth = 1
        end_off = None
        for j in range(idx + 1, len(toks)):
            kj, tj = toks[j]
            if kj == 'CODE':
                depth += tj.count('(') - tj.count(')')
                if depth == 0:
                    end_off = offs[j] + len(tj)
                    break
        if end_off is None: continue
        call_open = offs[idx] + t.rindex('DsaCatalog.') + len('DsaCatalog.')
        yield call_open + len(m.group(1)) - len(m.group(1)), call_open + len(m.group(1)), m.group(1), src[call_open + len(m.group(1)) + 1:end_off-1]

def split_top(args):
    toks = list(lex_java(args))
    parts, cur, depth = [], [], 0
    for k, t in toks:
        if k == 'CODE':
            for chch in t:
                if chch in '([{': depth += 1
                elif chch in ')]}': depth -= 1
                elif chch == ',' and depth == 0:
                    parts.append(''.join(cur).strip()); cur = []
                    continue
                cur.append(chch)
        else:
            cur.append(t)
    if cur: parts.append(''.join(cur).strip())
    return parts

def infer_kind(name, body):
    e = re.escape(name)
    # 1. string methods are decisive
    if re.search(r'\b' + e + r'\.(charAt|split|substring|trim|toLowerCase|toUpperCase|equals|indexOf|startsWith|endsWith|strip|compareTo|toCharArray|isEmpty|lastIndexOf|replace)\b', body):
        return 'STRING'
    # 1b. passed as an argument to a string method
    if re.search(r'\.(indexOf|lastIndexOf|equals|compareTo|startsWith|endsWith|charAt|concat|split)\s*\([^()]*\b' + e + r'\b', body):
        return 'STRING'
    # 2. array evidence
    if re.search(r'\b' + e + r'\.length\b(?!\()', body) or re.search(r'\b' + e + r'\s*\[', body) or re.search(r'\b' + e + r'\.clone\(\)', body):
        return 'ARRAY'
    # 2b. for-each over it → iterable (array in our banks)
    if re.search(r'\bfor\s*\([^:]*:\s*' + e + r'\s*\)', body):
        return 'ARRAY'
    # 3. numeric evidence (operator on either side)
    if re.search(r'[=!]=\s*' + e + r'\b', body) or re.search(r'\b' + e + r'\s*[+\-*/<>=]', body) or re.search(r'\b' + e + r'\s*%', body) or re.search(r'[+\-*/<>=]\s*' + e + r'\b', body):
        return 'SCALAR'
    # 3b. assigned to a String variable → string
    if re.search(r'String\s+\w+\s*=\s*' + e + r'\b', body):
        return 'STRING'
    # 4. known string names
    if name in STRING_NAMES: return 'STRING'
    # 5. in this codebase, a param named 'a' is always the input array
    if name == 'a': return 'ARRAY'
    return 'SCALAR'

VAR_TYPE = {'int': 'INT', 'long': 'INT', 'double': 'INT', 'String': 'STRING',
            'int[]': 'ARRAY', 'int[][]': 'MATRIX', 'boolean': 'INT', 'char': 'INT'}

def resolve_var(name, body):
    m = re.search(r'\b(int|long|double|String|int\[\]|int\[\]\[\]|boolean|char)\s+' + re.escape(name) + r'\s*=', body)
    if m: return VAR_TYPE[m.group(1)]
    return None

def ret_kind(expr, body='', kinds=None, params=None):
    e = expr.strip()
    if e in ('\"\"', "''") or re.match(r'^\"[^\"]*\"$', e): return 'STRING'
    # bare variable → resolve its declared type (params count too)
    if re.match(r'^[a-z][A-Za-z0-9]*$', e):
        t = resolve_var(e, body)
        if t: return t
        if kinds and params:
            for p, k in zip(params, kinds):
                if p == e: return 'INT' if k == 'SCALAR' else k
        return 'INT'
    # array element access → int
    if re.match(r'^[A-Za-z0-9_]+\s*(\([^)]*\))?\s*\[', e): return 'INT'
    if re.match(r'^\(int\)\s', e) or re.match(r'^\(long\)\s', e) or re.match(r'^\(int\)\s*\(', e): return 'INT'
    if re.search(r'new\s+int\s*\[[^\]]*\]\s*\[', e): return 'MATRIX'
    if re.search(r'new\s+int\s*\[', e): return 'ARRAY'
    if re.search(r'\.stream\(\)\.mapToInt|copyOf|copyOfRange|\.toArray\(\)', e): return 'ARRAY'
    if re.search(r'new\s+String|substring|toLowerCase|toUpperCase|\.trim\(\)|String\.join|\.toString\(\)', e): return 'STRING'
    if re.search(r'\.length\(\)|\.size\(\)|\.pop\(\)|\.peek\(\)|\.poll\(\)|\.get\(\)|\.values\(\)', e): return 'INT'
    if re.search(r'\[\s*\]', e): return 'ARRAY'
    return 'INT'

def infer_return(body, kinds=None, params=None):
    b = body.strip()
    if b.startswith('{'):
        rets = re.findall(r'\breturn\s+([^;]+);', b)
        if not rets: return 'INT'
        counts = {}
        for r in rets:
            k = ret_kind(r, b, kinds, params)
            counts[k] = counts.get(k, 0) + 1
        if 'MATRIX' in counts: return 'MATRIX'
        best = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0] != 'INT'))
        return best[0][0]
    return ret_kind(b, b, kinds, params)

def sig_name(kinds, ret):
    p = ''.join({'ARRAY': 'A', 'SCALAR': 'I', 'STRING': 'S', 'MATRIX': 'M'}[k] for k in kinds)
    r = {'INT': 'I', 'ARRAY': 'A', 'STRING': 'S', 'MATRIX': 'M'}[ret]
    return (p + '2' + r) if p else ('V2' + r)

def main():
    edits = []   # (bank, start, end, old, new)
    sigs = {}    # signame -> count
    for bank in BANKS:
        path = os.path.join(ROOT, bank + '.java')
        src = open(path).read()
        for s, e, factory, args in iter_calls(src):
            top = split_top(args)
            if not top: continue
            slug_m = re.match(r'"([^"]+)"', top[0])
            if not slug_m: continue
            slug = slug_m.group(1)
            oracle = top[-1]
            arrow = find_arrow(oracle)
            if arrow < 0:
                print('SKIP (no lambda):', slug, file=sys.stderr); continue
            head, body = oracle[:arrow].strip(), oracle[arrow+2:].strip()
            params = head[1:-1].strip() if head.startswith('(') else head
            plist = [p.strip() for p in params.split(',') if p.strip()]
            kinds = [infer_kind(p.split()[-1] if ' ' in p else p, body) for p in plist]
            ret = infer_return(body, kinds, plist)
            if slug in OVERRIDES:
                km = {'A':'ARRAY','S':'STRING','I':'SCALAR','M':'MATRIX'}
                rm = {'A':'ARRAY','S':'STRING','I':'INT','M':'MATRIX'}
                kinds = [km[c] for c in OVERRIDES[slug][0]]
                ret = rm[OVERRIDES[slug][1]]
            sig = sig_name(kinds, ret)
            sigs[sig] = sigs.get(sig, 0) + 1
            if factory != sig:
                edits.append((bank, s, e, factory, sig, slug))
        # apply edits right-to-left
        for b, s, e, old, new, slug in sorted([x for x in edits if x[0] == bank], key=lambda x: -x[1]):
            src = src[:s] + new + src[e:]
        open(path, 'w').write(src)
    json.dump(sigs, open('/tmp/sigs.json', 'w'), indent=1)
    print('rewrote', len(edits), 'calls')
    for sig, c in sorted(sigs.items(), key=lambda kv: -kv[1]):
        print(f'{sig}: {c}')

if __name__ == '__main__':
    main()
