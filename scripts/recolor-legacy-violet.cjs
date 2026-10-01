const { readFileSync, writeFileSync } = require('fs');
const p = '/Users/piyushpandey/Downloads/NovaTutor_PUBLIC_GITHUB/frontend/src/styles.css';
let css = readFileSync(p, 'utf8');
const before = css.length;

// Targeted fixes FIRST (contexts that must differ from the global maps)
const targeted = [
  // DSA numeric/pill accents in dark mode -> neutral (not AI surfaces)
  ['.dark .dsa-idx,.dark .dsa-num{color:#a990ff}', '.dark .dsa-idx,.dark .dsa-num{color:#C6CBD4}'],
  ['.dark .dsa-pill.topic,.dark .dsa-tags span,.dark .dsa-badge{color:#a990ff;background:rgba(168,139,255,.1);border-color:rgba(168,139,255,.2)}',
   '.dark .dsa-pill.topic,.dark .dsa-tags span,.dark .dsa-badge{color:#C6CBD4;background:rgba(198,203,212,.12);border-color:rgba(198,203,212,.22)}'],
];
for (const [a, b] of targeted) { if (!css.includes(a)) console.error('MISS targeted: ' + a.slice(0, 60)); css = css.split(a).join(b); }

// Global literal maps (order-independent; exact hex matches)
const map = {
  // Decorative violets (light mode) -> Editorial Ink
  '6659cf': '14161B', '6c5ce0': '14161B', '754fd0': '14161B', '7566e7': '14161B',
  '7968ee': '14161B', '725de8': '14161B', '7459e8': '14161B', 'a16fe9': '14161B',
  '7765ed': '14161B', '6b5ae0': '14161B', '7c6ee0': '14161B', '4f43ad': '14161B',
  // Violet-tinted surfaces & borders (light) -> neutral
  'f4f1ff': 'F4F4F2', 'f5f1ff': 'F4F4F2', 'f3f1ff': 'F6F7F8', 'f0eeff': 'F4F5F7',
  'f3f0ff': 'F4F4F2', 'e7e1ff': 'E3E5E9', 'e9e7f2': 'E5E7EA', 'fbfaff': 'FBFBFA',
  'faf9ff': 'FAFAF8', 'eef2ff': 'EEF0F3',
  // Violet text on dark chips -> neutral light gray
  'bdb3ff': 'C6CBD4', 'b4a9ff': 'C6CBD4', 'b9afff': 'C6CBD4', 'c9c2ff': 'C6CBD4', 'd9d3ff': 'C6CBD4',
  // Violet-navy dark chips & borders -> neutral dark
  '211e3c': '1A1D24', '211e38': '1A1D24', '211e37': '1A1D24', '25203e': '1A1D24',
  '1d2b25': '1A1D24', '1d2030': '1A1D24', '171b2a': '1A1D24',
  '3a335b': '2A2E38', '373153': '2A2E38', '292542': '2A2E38', '403a62': '2A2E38',
  '151c29': '15181D', '121522': '14171C', '111522': '14171C',
  '201d3d': '1A1D24', '19162d': '15181D', '17152a': '14171C',
  // Decorative mint -> neutral / semantic-neutral
  '9fdcc8': 'B8BEC9', '7fd4bb': '14161B', 'bfe8da': 'D8DCE2', 'd8e6df': 'D8DCE2',
  'b9e7d0': 'C2D9CC', 'f0fbf6': 'F0F6F2',
};
let count = 0;
for (const [from, to] of Object.entries(map)) {
  const re = new RegExp('#' + from + '(?![0-9a-fA-F])', 'gi');
  const n = (css.match(re) || []).length;
  if (n) { css = css.replace(re, '#' + to); count += n; }
}
// Violet-tinted rgba shadows/tints
const rgba = [
  ['rgba(32,28,72,', 'rgba(20,22,27,'],
  ['rgba(76,63,160,', 'rgba(20,22,27,'],
  ['rgba(44,37,92,', 'rgba(20,22,27,'],
  ['rgba(110,83,220,', 'rgba(20,22,27,'],
  ['rgba(139,124,245,', 'rgba(237,238,242,'],
];
for (const [a, b] of rgba) { const n = css.split(a).length - 1; if (n) { css = css.split(a).join(b); count += n; } }
// Input focus rings in chat/mentor/prompt keep the AI violet via token
const focusN = (css.match(/#8b7cf5/gi) || []).length;
css = css.replace(/#8b7cf5/gi, 'var(--live)');
count += focusN;

writeFileSync(p, css);
console.log('replaced occurrences:', count, '| bytes:', before, '->', css.length);
console.log('remaining a990ff:', (css.match(/a990ff/gi) || []).length, '(expected: 1 = --violet2 AI alias)');
console.log('remaining violet hexes:', (css.match(/#(6659cf|6c5ce0|754fd0|725de8|7459e8|a16fe9|7765ed|6b5ae0|7c6ee0|4f43ad|8b7cf5|bdb3ff|b4a9ff|b9afff|c9c2ff|d9d3ff|211e3c|211e38|211e37|25203e|1d2b25|3a335b|373153|9fdcc8|7fd4bb|f4f1ff|e7e1ff|eef2ff)/gi) || []).length);
