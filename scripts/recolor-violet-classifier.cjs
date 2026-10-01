const { readFileSync, writeFileSync } = require('fs');
const p = '/Users/piyushpandey/Downloads/NovaTutor_PUBLIC_GITHUB/frontend/src/styles.css';
let css = readFileSync(p, 'utf8');
const before = css.length;

const KEEP = new Set(['a990ff']); // --violet2 AI alias token only

function hsl(hex) {
  const r = parseInt(hex.slice(0, 2), 16) / 255,
        g = parseInt(hex.slice(2, 4), 16) / 255,
        b = parseInt(hex.slice(4, 6), 16) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (mx + mn) / 2;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0));
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return { h, s: s * 100, l: l * 100 };
}

// Neutral targets (Editorial Ink scale)
const N = {
  inkDark: '#14161B',  // deep accent text
  chipDark: '#262A33', // dark violet chip bg
  borderDark: '#2A2E38',
  surfaceDark: '#1A1D24',
  deepDark: '#15181D',
  light: '#EDEEF2',    // light violet text on dark
  silver: '#C6CBD4',   // mid-light violet text on dark
  paper: '#ECEDEF',    // light violet chip bg
  border: '#D8DCE2',   // light violet border
  inkSoft: '#F4F4F2',
};

const found = {};
const re = /#([0-9a-fA-F]{6})\b/g;
const matches = [...css.matchAll(re)].map(m => m[1].toLowerCase());
for (const h of matches) {
  if (KEEP.has(h)) continue;
  const { h: H, s, l } = hsl(h);
  if (!(H >= 235 && H <= 300 && s >= 15)) continue;
  found[h] = (found[h] || 0) + 1;
  let to;
  if (l < 14) to = N.deepDark;          // near-black violet-navy surfaces
  else if (l < 22) to = N.surfaceDark;  // dark violet surfaces
  else if (l < 32) to = N.chipDark;     // dark violet chips
  else if (l < 42) to = N.borderDark;   // dark violet borders
  else if (l < 55) to = N.inkDark;      // mid/deep violet accent text
  else if (l < 68) to = N.silver;       // light-mid violet text
  else if (l < 80) to = N.light;        // light violet text
  else if (l < 91) to = N.border;       // pale violet borders
  else to = N.paper;                    // palest violet chip bg
  css = css.replace(new RegExp('#' + h + '(?![0-9a-fA-F])', 'gi'), to);
}

writeFileSync(p, css);
console.log('unique violet hexes mapped:', Object.keys(found).length);
console.log('total occurrences:', Object.values(found).reduce((a, b) => a + b, 0));
console.log('bytes:', before, '->', css.length);
