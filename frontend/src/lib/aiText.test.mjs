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
import { normalizeAiText } from './aiText.js';

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
