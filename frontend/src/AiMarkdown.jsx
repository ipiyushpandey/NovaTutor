import React, { useEffect, useRef, useState } from 'react';
import { normalizeAiText, getCompactLessonOverview, cleanMath } from './lib/aiText.js';

/* NovaTutor shared AI markdown renderer.
   Pure-React, zero external dependencies. Every AI answer surface renders through this
   component (AI Teacher, Chat, DSA hints, Code Lab, Knowledge Hub, Interview,
   exam strategy). It renders the markdown the AI actually produces — headings,
   bold/italic, inline code, fenced code with copy, bullets, numbered lists,
   blockquotes, horizontal rules, mathematical expressions and Big-O notation via standard MathML —
   as clean premium typography, and normalizes pathological model whitespace
   without destroying intentional paragraph spacing or code formatting. */

export { normalizeAiText, getCompactLessonOverview, cleanMath };

const MATH_SYMBOLS = {
  theta: 'θ', Theta: 'Θ', omega: 'ω', Omega: 'Ω', pi: 'π', Pi: 'Π',
  alpha: 'α', beta: 'β', gamma: 'γ', Gamma: 'Γ', delta: 'δ', Delta: 'Δ',
  lambda: 'λ', Lambda: 'Λ', sigma: 'σ', Sigma: 'Σ', phi: 'φ', Phi: 'Φ',
  infty: '∞', le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠', neq: '≠',
  approx: '≈', times: '×', cdot: '·', to: '→', rightarrow: '→',
  in: '∈', notin: '∉', pm: '±'
};

const MATH_OPERATORS = new Set(['+', '-', '*', '=', '<', '>', '/', '!', '(', ')', '[', ']', '{', '}', ',', ':', ';']);
const MATH_FUNCTIONS = new Set(['log', 'ln', 'lg', 'exp', 'sin', 'cos', 'tan', 'min', 'max', 'lim']);

/**
 * Pure-React LaTeX to MathML AST parser. Zero external runtime dependencies.
 * Converts LaTeX constructs (Big-O, fractions, square roots, subscripts, superscripts,
 * Greek letters and relations) to valid, accessible MathML React elements.
 */
function parseLatexToMathML(str) {
  let pos = 0;
  const len = str.length;

  function skipWs() {
    while (pos < len && /\s/.test(str[pos])) pos++;
  }

  function readGroup() {
    if (str[pos] !== '{') return null;
    pos++;
    let depth = 1;
    const start = pos;
    while (pos < len && depth > 0) {
      if (str[pos] === '{') depth++;
      else if (str[pos] === '}') depth--;
      pos++;
    }
    return str.slice(start, pos - 1);
  }

  function parseExpression(untilChar) {
    const nodes = [];
    while (pos < len) {
      skipWs();
      if (pos >= len) break;
      if (untilChar && str[pos] === untilChar) break;

      const node = parseAtom();
      if (!node) {
        pos++;
        continue;
      }

      let base = node;
      skipWs();
      let sub = null;
      let sup = null;

      while (pos < len && (str[pos] === '_' || str[pos] === '^')) {
        const op = str[pos++];
        skipWs();
        let arg = null;
        if (str[pos] === '{') {
          arg = parseLatexToMathML(readGroup());
        } else if (pos < len) {
          const char = str[pos++];
          arg = [React.createElement(/\d/.test(char) ? 'mn' : (MATH_OPERATORS.has(char) ? 'mo' : 'mi'), { key: 'subsup' }, char)];
        }
        if (op === '_') sub = arg;
        else sup = arg;
        skipWs();
      }

      if (sub && sup) {
        nodes.push(React.createElement('msubsup', { key: 'node-' + nodes.length }, base, React.createElement('mrow', null, sub), React.createElement('mrow', null, sup)));
      } else if (sub) {
        nodes.push(React.createElement('msub', { key: 'node-' + nodes.length }, base, React.createElement('mrow', null, sub)));
      } else if (sup) {
        nodes.push(React.createElement('msup', { key: 'node-' + nodes.length }, base, React.createElement('mrow', null, sup)));
      } else {
        nodes.push(base);
      }
    }
    return nodes;
  }

  function parseAtom() {
    skipWs();
    if (pos >= len) return null;
    const c = str[pos];

    if (c === '{') {
      const inner = readGroup();
      return React.createElement('mrow', { key: 'grp-' + pos }, parseLatexToMathML(inner));
    }

    if (c === '\\') {
      pos++;
      let cmdStart = pos;
      if (pos < len && !/[a-zA-Z]/.test(str[pos])) {
        const sym = str[pos++];
        if (sym === ',' || sym === ';') return React.createElement('mspace', { key: 'sp-' + pos, width: '0.2em' });
        return React.createElement('mo', { key: 'mo-' + pos }, sym);
      }
      while (pos < len && /[a-zA-Z]/.test(str[pos])) pos++;
      const cmd = str.slice(cmdStart, pos);

      if (cmd === 'left' || cmd === 'right') {
        skipWs();
        return parseAtom();
      }
      if (cmd === 'frac') {
        skipWs();
        const num = readGroup();
        skipWs();
        const den = readGroup();
        return React.createElement('mfrac', { key: 'frac-' + pos },
          React.createElement('mrow', null, parseLatexToMathML(num || '')),
          React.createElement('mrow', null, parseLatexToMathML(den || ''))
        );
      }
      if (cmd === 'sqrt') {
        skipWs();
        const rad = readGroup();
        return React.createElement('msqrt', { key: 'sqrt-' + pos },
          React.createElement('mrow', null, parseLatexToMathML(rad || ''))
        );
      }
      if (cmd === 'text') {
        skipWs();
        const txt = readGroup();
        return React.createElement('mtext', { key: 'txt-' + pos }, txt || '');
      }
      if (cmd === 'mathcal') {
        skipWs();
        const cal = readGroup();
        return React.createElement('mi', { key: 'cal-' + pos, style: { fontStyle: 'italic', fontFamily: 'serif' } }, cal || '');
      }
      if (cmd === 'sum') return React.createElement('mo', { key: 'sum-' + pos, style: { fontSize: '1.2em' } }, '∑');
      if (cmd === 'prod') return React.createElement('mo', { key: 'prod-' + pos, style: { fontSize: '1.2em' } }, '∏');
      if (cmd === 'int') return React.createElement('mo', { key: 'int-' + pos }, '∫');
      if (cmd === 'quad') return React.createElement('mspace', { key: 'qd-' + pos, width: '1em' });
      if (cmd === 'qquad') return React.createElement('mspace', { key: 'qqd-' + pos, width: '2em' });
      if (MATH_FUNCTIONS.has(cmd)) return React.createElement('mi', { key: 'fn-' + pos }, cmd);
      if (MATH_SYMBOLS[cmd]) return React.createElement(MATH_OPERATORS.has(MATH_SYMBOLS[cmd]) ? 'mo' : 'mi', { key: 'sym-' + pos }, MATH_SYMBOLS[cmd]);

      return React.createElement('mi', { key: 'cmd-' + pos }, cmd);
    }

    if (/\d/.test(c)) {
      let start = pos;
      while (pos < len && /[\d.]/.test(str[pos])) pos++;
      return React.createElement('mn', { key: 'mn-' + pos }, str.slice(start, pos));
    }

    if (MATH_OPERATORS.has(c)) {
      pos++;
      return React.createElement('mo', { key: 'op-' + pos }, c);
    }

    if (/[a-zA-Z]/.test(c)) {
      pos++;
      return React.createElement('mi', { key: 'id-' + pos }, c);
    }

    pos++;
    return React.createElement('mo', { key: 'other-' + pos }, c);
  }

  return parseExpression();
}

/**
 * Renders LaTeX math into native MathML with zero external dependencies.
 * Falls back gracefully to Unicode cleanMath text if parsing fails.
 */
export function renderMath(latex, isBlock, key) {
  try {
    const raw = String(latex || '').trim();
    const nodes = parseLatexToMathML(raw);
    const mathEl = React.createElement('math', {
      xmlns: 'http://www.w3.org/1998/Math/MathML',
      display: isBlock ? 'block' : 'inline'
    }, React.createElement('mrow', null, nodes));

    return React.createElement(isBlock ? 'div' : 'span', {
      className: isBlock ? 'ai-md-math-block' : 'ai-md-math',
      key: key
    }, mathEl);
  } catch {
    return React.createElement(isBlock ? 'div' : 'span', {
      className: isBlock ? 'ai-md-math-block' : 'ai-md-math',
      key: key
    }, cleanMath(latex));
  }
}

const mdInline = (text) => {
  const src = String(text).replace(/^#{1,6}\s*/, '');
  // Split on ***bold-italic***, **bold**, __bold__, `code`, $math$, \(math\), *italic*, _italic_
  const parts = src.split(/(\*\*\*[^\n]+?\*\*\*|\*\*[^\n]+?\*\*|__[^_\n]+?__|`[^`\n]+`|\$(?!\s)[^$\n]+?(?<!\s)\$|\\\([^\n]+?\\\)|(?<!\*)\*[^*\n]+?\*(?!\*)|(?<!_)_[^_\n]+?_(?!_))/g);
  return parts.map((x, i) => {
    if (!x) return null;
    if (x.startsWith('***') && x.endsWith('***') && x.length > 6) return <strong key={i}><em>{x.slice(3, -3)}</em></strong>;
    if (x.startsWith('**') && x.endsWith('**') && x.length > 4) return <strong key={i}>{x.slice(2, -2)}</strong>;
    if (x.startsWith('__') && x.endsWith('__') && x.length > 4) return <strong key={i}>{x.slice(2, -2)}</strong>;
    if (x.startsWith('`') && x.endsWith('`') && x.length > 2) return <code key={i}>{x.slice(1, -1)}</code>;
    if (x.startsWith('$') && x.endsWith('$') && x.length > 2) return renderMath(x.slice(1, -1), false, i);
    if (x.startsWith('\\(') && x.endsWith('\\)') && x.length > 4) return renderMath(x.slice(2, -2), false, i);
    if (/^\*[^*\n]+\*$/.test(x)) return <em key={i}>{x.slice(1, -1)}</em>;
    if (/^_[^_\n]+_$/.test(x)) return <em key={i}>{x.slice(1, -1)}</em>;
    return x;
  });
};

/* Non-React twin of mdInline for renderers that build plain strings/arrays
   (lesson TheoryContent). Preserves bold/italic/inline code and math markup. */
export function mdInlineText(text) {
  const src = String(text).replace(/^#{1,6}\s*/, '');
  const parts = src.split(/(\*\*\*[^\n]+?\*\*\*|\*\*[^\n]+?\*\*|__[^_\n]+?__|`[^`\n]+`|\$(?!\s)[^$\n]+?(?<!\s)\$|\\\([^\n]+?\\\)|(?<!\*)\*[^*\n]+?\*(?!\*)|(?<!_)_[^_\n]+?_(?!_))/g);
  return parts.map((x, i) => {
    if (!x) return null;
    if (x.startsWith('***') && x.endsWith('***') && x.length > 6) return <strong key={i}><em>{x.slice(3, -3)}</em></strong>;
    if (x.startsWith('**') && x.endsWith('**') && x.length > 4) return <strong key={i}>{x.slice(2, -2)}</strong>;
    if (x.startsWith('__') && x.endsWith('__') && x.length > 4) return <strong key={i}>{x.slice(2, -2)}</strong>;
    if (x.startsWith('`') && x.endsWith('`') && x.length > 2) return <code key={i}>{x.slice(1, -1)}</code>;
    if (x.startsWith('$') && x.endsWith('$') && x.length > 2) return renderMath(x.slice(1, -1), false, i);
    if (x.startsWith('\\(') && x.endsWith('\\)') && x.length > 4) return renderMath(x.slice(2, -2), false, i);
    if (/^\*[^*\n]+\*$/.test(x)) return <em key={i}>{x.slice(1, -1)}</em>;
    if (/^_[^_\n]+_$/.test(x)) return <em key={i}>{x.slice(1, -1)}</em>;
    return x;
  });
}

function CodeBlock({ code }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef(null);
  useEffect(() => () => clearTimeout(timerRef.current), []);
  const copy = async () => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(code);
      } else {
        const ta = document.createElement('textarea');
        ta.value = code;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopied(true);
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 1600);
    } catch {}
  };
  return (
    <div className="ai-md-code">
      <div className="ai-md-code-bar">
        <span>CODE</span>
        <button type="button" onClick={copy} className={copied ? 'ok' : ''}>{copied ? '✓ Copied' : 'Copy'}</button>
      </div>
      <pre className="ai-code-block"><code>{code}</code></pre>
    </div>
  );
}

const looksLikeHeading = (t) => {
  if (/^#{1,6}\s*/.test(t)) return true;
  if (/^\*\*[^*]{1,80}\*\*:?$/.test(t)) return true;
  return false;
};

const tableLines = (lines, start) => {
  const rowOf = (t) => {
    if (!/^\|.*\|$/.test(t)) return null;
    return t.slice(1, -1).split('|').map(c => c.trim());
  };
  const rows = [];
  let i = start;
  while (i < lines.length) {
    const cells = rowOf(lines[i].trim());
    if (!cells) break;
    rows.push(cells);
    i++;
  }
  if (rows.length < 2) return null;
  const isSep = rows[1].every(c => /^:?-{3,}:?$/.test(c));
  if (!isSep) return null;
  const cols = Math.max(...rows.map(r => r.length));
  if (cols < 2 || cols > 8) return null;
  const body = rows.filter((_, idx) => idx !== 1).map(r => {
    const c = r.slice();
    while (c.length < cols) c.push('');
    return c;
  });
  return { cols, body, next: i };
};

export default function AiMarkdown({ content }) {
  const src = normalizeAiText(content);
  const lines = src.split('\n');
  const out = [];
  let buf = [];
  let quotes = [];
  let code = [];
  let inCode = false;
  let codeIdx = 0;

  const flushQuotes = () => {
    if (quotes.length) {
      out.push(
        <blockquote className="ai-md-quote" key={'q' + out.length}>
          {quotes.map((q, qi) => <p key={qi}>{mdInline(q)}</p>)}
        </blockquote>
      );
      quotes = [];
    }
  };

  const flush = () => {
    flushQuotes();
    if (buf.length) {
      out.push(<p className="ai-md-p" key={'p' + out.length}>{mdInline(buf.join(' '))}</p>);
      buf = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = line.trim().startsWith('```');
    if (fence) {
      flush();
      if (inCode) {
        out.push(<CodeBlock key={'c' + (codeIdx++)} code={code.join('\n')} />);
        code = [];
        inCode = false;
      } else {
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      code.push(line);
      continue;
    }

    const t = line.trim();
    if (!t) {
      flush();
      continue;
    }

    // Pipe tables
    const tbl = tableLines(lines, i);
    if (tbl) {
      flush();
      out.push(
        <div className="ai-md-table-wrap" key={'t' + out.length}>
          <table className="ai-md-table">
            <thead><tr>{tbl.body[0].map((c, ci) => <th key={ci}>{mdInline(c)}</th>)}</tr></thead>
            <tbody>{tbl.body.slice(1).map((r, ri) => <tr key={ri}>{r.map((c, ci) => <td key={ci}>{mdInline(c)}</td>)}</tr>)}</tbody>
          </table>
        </div>
      );
      i = tbl.next - 1;
      continue;
    }

    if (t.startsWith('>')) {
      if (buf.length) flush();
      quotes.push(t.replace(/^>\s*/, ''));
      continue;
    } else {
      flushQuotes();
    }

    // Block math $$...$$ or \[...\] (single-line or multiline)
    if (t.startsWith('$$') || t.startsWith('\\[')) {
      flush();
      const isBrack = t.startsWith('\\[');
      const closer = isBrack ? '\\]' : '$$';
      // Single-line block math
      if (t.length > 2 && t.endsWith(closer) && (isBrack ? t.length > 3 : t.length > 4)) {
        const mathBody = isBrack ? t.slice(2, -2) : t.slice(2, -2);
        out.push(renderMath(mathBody, true, 'mb' + out.length));
        continue;
      }
      // Multiline block math
      const mathLines = [];
      const first = t.slice(2).trim();
      if (first) mathLines.push(first);
      let closed = false;
      let j = i + 1;
      while (j < lines.length) {
        const nextLine = lines[j].trim();
        if (nextLine.endsWith(closer)) {
          const last = nextLine.slice(0, -closer.length).trim();
          if (last) mathLines.push(last);
          closed = true;
          i = j;
          break;
        }
        mathLines.push(lines[j]);
        j++;
      }
      if (closed) {
        out.push(renderMath(mathLines.join('\n'), true, 'mb' + out.length));
        continue;
      }
    }

    // Flush accumulated paragraph lines before block-level elements
    if (
      looksLikeHeading(t) || /^[-*•]\s+/.test(t) || /^\d+[.)]\s+/.test(t) ||
      /^[-—=_*]{3,}$/.test(t)
    ) {
      flush();
    }

    let m;
    if ((m = t.match(/^(#{1,6})\s*(.*)$/))) {
      const level = Math.min(m[1].length, 3);
      out.push(<h4 className={'ai-md-heading h' + level} key={'h' + out.length}>{mdInline(m[2] || '')}</h4>);
      continue;
    }
    if ((m = t.match(/^\*\*([^*]{1,80})\*\*:?!?$/))) {
      out.push(<h4 className={'ai-md-heading h2'} key={'h' + out.length}>{mdInline(m[1])}</h4>);
      continue;
    }
    if (/^[-—=_*]{3,}$/.test(t)) {
      out.push(<hr className="ai-md-hr" key={'hr' + out.length} />);
      continue;
    }
    if ((m = t.match(/^[-*•]\s+(.*)$/))) {
      out.push(<div className="ai-md-bullet" key={'b' + out.length}><span className="ai-md-bullet-dot" aria-hidden="true" /><div>{mdInline(m[1])}</div></div>);
      continue;
    }
    if ((m = t.match(/^(\d+)[.)]\s+(.*)$/))) {
      out.push(<div className="ai-md-bullet" key={'n' + out.length}><span className="ai-md-num">{m[1]}.</span><div>{mdInline(m[2])}</div></div>);
      continue;
    }
    buf.push(t);
  }
  flush();
  flushQuotes();
  if (inCode && code.length) out.push(<CodeBlock key={'c-tail'} code={code.join('\n')} />);
  if (!out.length) return null;
  return <div className="ai-markdown">{out}</div>;
}
