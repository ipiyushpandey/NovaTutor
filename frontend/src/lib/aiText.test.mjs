/*
 * Unit tests for the pure AI-text normalizer, run with Node's built-in test
 * runner (zero dependencies):  `npm test`  or  `node --test src/lib/`
 *
 * normalizeAiText() is the single most bug-prone pure function in the UI — it
 * exists specifically to kill runaway-whitespace / mangled-backtick artifacts
 * coming out of the model and the PDF extraction pipeline. These cases lock in
 * that behavior so a future edit cannot silently regress it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAiText, cleanMath } from './aiText.js';

test('is a function', () => {
  assert.equal(typeof normalizeAiText, 'function');
});

test('normalizes CRLF and bare CR to LF', () => {
  assert.equal(normalizeAiText('a\r\nb\rc'), 'a\nb\nc');
});

test('strips NUL and zero-width characters', () => {
  assert.equal(normalizeAiText('a\u0000b\u200Bc\u200Dd\uFEFFe'), 'abcde');
});

test('collapses 3+ consecutive blank lines to a single blank line', () => {
  assert.equal(normalizeAiText('a\n\n\n\n\nb'), 'a\n\nb');
});

test('preserves a single intentional blank line between paragraphs', () => {
  assert.equal(normalizeAiText('a\n\nb'), 'a\n\nb');
});

test('drops decorative list-marker-only lines', () => {
  assert.equal(normalizeAiText('a\n-\n*\n•\nb'), 'a\n\nb');
});

test('keeps real bullet list items (marker + text)', () => {
  assert.equal(normalizeAiText('- first\n- second'), '- first\n- second');
});

test('never rewrites code inside fenced blocks', () => {
  const src = '```\ncode\n\n\nmore\n```';
  assert.equal(normalizeAiText(src), src);
});

test('repairs PDF-mangled triple/double curly quotes into backticks', () => {
  assert.equal(normalizeAiText('x\u2018\u2018\u2018y'), 'x```y');
  assert.equal(normalizeAiText('x\u2018\u2018y'), 'x`y');
});

test('trims trailing spaces on content lines', () => {
  assert.equal(normalizeAiText('a   \nb\t'), 'a\nb');
});

test('trims leading and trailing blank lines', () => {
  assert.equal(normalizeAiText('\n\na\n\n'), 'a');
});

test('returns empty string for null / undefined (no NaN or "undefined" leaks)', () => {
  assert.equal(normalizeAiText(null), '');
  assert.equal(normalizeAiText(undefined), '');
});

test('is idempotent on already-normalized text', () => {
  const once = normalizeAiText('a\n\n\nb');
  assert.equal(normalizeAiText(once), once);
});

test('normalizes malformed Big-O and mathematical artifacts like $)(n/log n)**', () => {
  assert.equal(normalizeAiText('Time complexity: $)(n/log n)**'), 'Time complexity: O(log n)');
  assert.equal(normalizeAiText('Best case is $)(1)** and worst case is $)(n)**'), 'Best case is O(1) and worst case is O(n)');
});

test('preserves valid math delimiters and cleans mathematical expressions', () => {
  // normalizeAiText preserves math intact so downstream MathML rendering can process it
  assert.equal(normalizeAiText('Runs in $\\mathcal{O}(n \\log n)$ time'), 'Runs in $\\mathcal{O}(n \\log n)$ time');
  assert.equal(normalizeAiText('Takes $O(\\log n)$ operations'), 'Takes $O(\\log n)$ operations');
  assert.equal(normalizeAiText('Bound is $n \\le 10^5$ and $a \\times b$'), 'Bound is $n \\le 10^5$ and $a \\times b$');
  assert.equal(normalizeAiText('$$T(n) = 2T(n/2) + O(n)$$'), '$$T(n) = 2T(n/2) + O(n)$$');

  // cleanMath produces clean Unicode representation preserving mathematical semantics
  assert.equal(cleanMath('\\mathcal{O}(n \\log n)'), 'O(n log n)');
  assert.equal(cleanMath('n \\le 10^5'), 'n ≤ 10^5');
  assert.equal(cleanMath('a \\times b'), 'a × b');
  assert.equal(cleanMath('\\frac{a}{b}'), '(a)/(b)');
  assert.equal(cleanMath('\\sqrt{x}'), '√(x)');
  assert.equal(cleanMath('\\frac{n(n+1)}{2}'), '(n(n+1))/(2)');
  assert.equal(cleanMath('\\sum_{i=1}^n i = \\frac{n(n+1)}{2}'), '∑_{i=1}^n i = (n(n+1))/(2)');
});

test('getCompactLessonOverview extracts concise topics without lengthy sections', async () => {
  const { getCompactLessonOverview } = await import('./aiText.js');
  const sampleLesson = {
    title: 'Lesson 1 — Introduction to Binary Trees',
    topic: 'Binary Trees',
    content: `# Lesson 1 — Introduction to Binary Trees
A binary tree is a hierarchical data structure where each node has at most two children. In this lecture, we explore binary tree properties and traversals.

## Core concepts
- Tree nodes, root, and leaf properties
- In-order, pre-order, and post-order traversal
- Height and depth relationships

## Common mistakes
Students frequently confuse height with depth or forget edge cases.

## About the Author
Written by the curriculum team.`
  };

  const overview = getCompactLessonOverview(sampleLesson);
  assert.ok(overview.summary.includes('hierarchical data structure'));
  assert.ok(!overview.summary.toLowerCase().includes('mistakes'));
  assert.ok(!overview.summary.toLowerCase().includes('about the author'));
  assert.equal(overview.topics.length, 3);
  assert.ok(overview.topics[0].includes('Tree nodes'));
});
