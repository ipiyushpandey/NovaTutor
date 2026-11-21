import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import ReactDOMServer from 'react-dom/server';
import { renderMath, parseLatexToMathML } from './aiMath.js';
import { normalizeAiText, cleanMath } from './aiText.js';

test('renderMath outputs valid standard MathML markup for Big-O notation: $O(n \\log n)$', () => {
  const el = renderMath('O(n \\log n)', false, 'test-1');
  const html = ReactDOMServer.renderToStaticMarkup(el);

  assert.ok(html.startsWith('<span class="ai-md-math">'), 'Must be wrapped in inline math span');
  assert.ok(html.includes('<math xmlns="http://www.w3.org/1998/Math/MathML" display="inline">'), 'Must declare MathML namespace and inline display');
  assert.ok(html.includes('<mi>O</mi>'), 'Must render O as identifier');
  assert.ok(html.includes('<mo>(</mo>'), 'Must render ( as operator');
  assert.ok(html.includes('<mi>n</mi>'), 'Must render n as identifier');
  assert.ok(html.includes('<mi>log</mi>'), 'Must render log as identifier');
  assert.ok(html.includes('<mo>)</mo>'), 'Must render ) as operator');
});

test('renderMath outputs valid MathML for calligraphic Big-O and superscripts: \\mathcal{O}(n^2)', () => {
  const el = renderMath('\\mathcal{O}(n^2)', false, 'test-2');
  const html = ReactDOMServer.renderToStaticMarkup(el);

  assert.ok(html.includes('<mi style="font-style:italic;font-family:serif">O</mi>'), 'Must render script font for calligraphic O');
  assert.ok(html.includes('<msup><mi>n</mi><mrow><mn>2</mn></mrow></msup>'), 'Must render exponent as <msup>');
});

test('renderMath outputs block MathML container for block equations: $$...$$', () => {
  const el = renderMath('T(n) = 2T(n/2) + O(n)', true, 'test-block');
  const html = ReactDOMServer.renderToStaticMarkup(el);

  assert.ok(html.startsWith('<div class="ai-md-math-block">'), 'Must be wrapped in block math div');
  assert.ok(html.includes('display="block"'), 'Must declare display="block" on <math>');
  assert.ok(html.includes('<mi>T</mi>'), 'Must render T');
  assert.ok(html.includes('<mo>=</mo>'), 'Must render = operator');
});

test('renderMath outputs valid MathML for fractions: \\frac{a}{b} and \\frac{n(n+1)}{2}', () => {
  const el = renderMath('\\frac{a}{b}', false, 'test-frac');
  const html = ReactDOMServer.renderToStaticMarkup(el);

  assert.ok(html.includes('<mfrac><mrow><mi>a</mi></mrow><mrow><mi>b</mi></mrow></mfrac>'), 'Must render fraction structure');

  const complex = renderMath('\\frac{n(n+1)}{2}', false, 'test-frac-complex');
  const complexHtml = ReactDOMServer.renderToStaticMarkup(complex);
  assert.ok(complexHtml.includes('<mfrac>'), 'Must render fraction for n(n+1)/2');
  assert.ok(complexHtml.includes('<mn>2</mn>'), 'Must render denominator 2 as number');
});

test('renderMath outputs valid MathML for square roots: \\sqrt{x} and \\sqrt{x^2 + y^2}', () => {
  const el = renderMath('\\sqrt{x}', false, 'test-sqrt');
  const html = ReactDOMServer.renderToStaticMarkup(el);

  assert.ok(html.includes('<msqrt><mrow><mi>x</mi></mrow></msqrt>'), 'Must render square root structure');

  const complex = renderMath('\\sqrt{x^2 + y^2}', false, 'test-sqrt-complex');
  const complexHtml = ReactDOMServer.renderToStaticMarkup(complex);
  assert.ok(complexHtml.includes('<msqrt>'), 'Must render square root for x^2 + y^2');
  assert.ok(complexHtml.includes('<msup><mi>x</mi><mrow><mn>2</mn></mrow></msup>'), 'Must render x^2');
  assert.ok(complexHtml.includes('<msup><mi>y</mi><mrow><mn>2</mn></mrow></msup>'), 'Must render y^2');
});

test('renderMath outputs valid MathML for subscripts and combined sub-superscripts', () => {
  // Subscript only: x_i
  const subEl = renderMath('x_i', false, 'test-sub');
  const subHtml = ReactDOMServer.renderToStaticMarkup(subEl);
  assert.ok(subHtml.includes('<msub><mi>x</mi><mrow><mi>i</mi></mrow></msub>'), 'Must render subscript as <msub>');

  // Subscript and superscript together: x_i^2
  const subSupEl = renderMath('x_i^2', false, 'test-subsup');
  const subSupHtml = ReactDOMServer.renderToStaticMarkup(subSupEl);
  assert.ok(subSupHtml.includes('<msubsup><mi>x</mi><mrow><mi>i</mi></mrow><mrow><mn>2</mn></mrow></msubsup>'), 'Must render sub-sup as <msubsup>');
});

test('renderMath handles multiline equations and summations without corrupting semantics', () => {
  const multiline = `\\sum_{i=1}^n i = \\frac{n(n+1)}{2}`;
  const el = renderMath(multiline, true, 'test-sum');
  const html = ReactDOMServer.renderToStaticMarkup(el);

  assert.ok(html.includes('display="block"'), 'Must render as block math');
  assert.ok(html.includes('∑'), 'Must render sum symbol');
  assert.ok(html.includes('<msubsup>'), 'Must render index bounds on summation');
  assert.ok(html.includes('<mfrac>'), 'Must render right-hand fraction');
});

test('code blocks and inline code containing dollar signs and backslashes are preserved verbatim', () => {
  // Fenced code with $ and \
  const codeBlock = '```bash\necho "$HOME"\nls -la "$VAR"\n```';
  const normCode = normalizeAiText(codeBlock);
  assert.equal(normCode, codeBlock, 'Fenced code content must remain untouched');

  // Inline code with $
  const inlineCode = 'Use `$JAVA_HOME/bin` to locate Java.';
  const normInline = normalizeAiText(inlineCode);
  assert.equal(normInline, inlineCode, 'Inline code with $ must not be rewritten');
});

test('malformed Big-O cases are normalized cleanly without destroying math markup', () => {
  assert.equal(normalizeAiText('Complexity is $)(n/log n)**'), 'Complexity is O(log n)');
  assert.equal(normalizeAiText('Best: $)(1)** and Worst: $)(n)**'), 'Best: O(1) and Worst: O(n)');
});

test('unsupported LaTeX commands degrade safely to clean identifiers without crash or semantic loss', () => {
  // Unknown command \customFunc should not throw or disappear
  const el = renderMath('\\customFunc(n)', false, 'test-unsupported');
  const html = ReactDOMServer.renderToStaticMarkup(el);

  assert.ok(html.includes('<mi>customFunc</mi>'), 'Unsupported command must safely degrade to identifier');
  assert.ok(html.includes('<mi>n</mi>'), 'Arguments must remain intact');
});

test('user-provided content remains strictly text-escaped with zero HTML injection vector', () => {
  const maliciousInput = '<script>alert("xss")</script> + <img src="x" onerror="alert(1)">';
  const el = renderMath(maliciousInput, false, 'test-xss');
  const html = ReactDOMServer.renderToStaticMarkup(el);

  // Must be HTML-escaped by React, NEVER raw unescaped HTML
  assert.ok(!html.includes('<script>'), 'Must not render unescaped script tag');
  assert.ok(!html.includes('<img'), 'Must not render unescaped img tag');
  assert.ok(html.includes('&lt;script&gt;') || html.includes('&lt;'), 'Tags must be strictly XML/HTML escaped');
});
