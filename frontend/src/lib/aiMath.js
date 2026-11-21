import React from 'react';
import { cleanMath } from './aiText.js';

/* NovaTutor pure-React MathML AST parser & renderer.
   Zero external dependencies. Converts LaTeX mathematical expressions
   into accessible, standards-compliant MathML React element trees. */

export const MATH_SYMBOLS = {
  theta: 'θ', Theta: 'Θ', omega: 'ω', Omega: 'Ω', pi: 'π', Pi: 'Π',
  alpha: 'α', beta: 'β', gamma: 'γ', Gamma: 'Γ', delta: 'δ', Delta: 'Δ',
  lambda: 'λ', Lambda: 'Λ', sigma: 'σ', Sigma: 'Σ', phi: 'φ', Phi: 'Φ',
  infty: '∞', le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠', neq: '≠',
  approx: '≈', times: '×', cdot: '·', to: '→', rightarrow: '→',
  in: '∈', notin: '∉', pm: '±'
};

export const MATH_OPERATORS = new Set(['+', '-', '*', '=', '<', '>', '/', '!', '(', ')', '[', ']', '{', '}', ',', ':', ';']);
export const MATH_FUNCTIONS = new Set(['log', 'ln', 'lg', 'exp', 'sin', 'cos', 'tan', 'min', 'max', 'lim']);

/**
 * Pure-React LaTeX to MathML AST parser. Zero external runtime dependencies.
 * Converts LaTeX constructs (Big-O, fractions, square roots, subscripts, superscripts,
 * Greek letters and relations) to valid, accessible MathML React elements.
 */
export function parseLatexToMathML(str) {
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

      // Graceful degradation for unsupported commands: render identifier without altering semantics
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
