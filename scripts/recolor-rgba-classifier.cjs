const { readFileSync, writeFileSync } = require('fs');
const p = '/Users/piyushpandey/Downloads/NovaTutor_PUBLIC_GITHUB/frontend/src/styles.css';
let css = readFileSync(p, 'utf8');

function rgbHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  let h = 0; const l = (mx + mn) / 2;
  let s = 0;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    if (mx === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return { h, s: s * 100 };
}
const isViolet = (r, g, b) => { const { h, s } = rgbHsl(r, g, b); return h >= 235 && h <= 300 && s >= 20; };

const LIVE = '107,92,231';   // --live #6B5CE7
const INK = '20,22,27';      // --ink #14161B

// Process rule-by-rule (split on top of '}' — nested none in this sheet's rgba scope)
const blocks = css.split('}');
let liveN = 0, inkN = 0;
const out = blocks.map(block => {
  const liveFamily = /--live|--violet|#6B5CE7|#7C5CF6|#7c5cf6/i.test(block);
  const inkFamily = /#14161B|var\(--accent\b|var\(--ink\b|#14161b/.test(block);
  return block.replace(/rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)/g, (m0, r, g, b, a) => {
    if (!isViolet(+r, +g, +b)) return m0;
    // live-family blocks keep a violet tone normalized to --live rgb
    if (liveFamily) { liveN++; return `rgba(${LIVE},${a})`; }
    // ink-family blocks get neutral ink shadows/tints
    if (inkFamily) { inkN++; return `rgba(${INK},${a})`; }
    // default: near-neutral shadows (alpha <= .2) -> ink; anything else -> ink too
    inkN++; return `rgba(${INK},${a})`;
  });
});
css = out.join('}');
writeFileSync(p, css);
console.log('live-family rgba normalized:', liveN);
console.log('ink/neutral rgba normalized:', inkN);
