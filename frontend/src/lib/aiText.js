/* NovaTutor AI text normalization utility.

   Extracted verbatim from AiMarkdown.jsx (function + its doc comment) so the
   pure, view-free whitespace normalizer can be unit-tested with the built-in
   Node test runner (zero dependencies). AiMarkdown.jsx re-exports it unchanged,
   so every existing import path keeps working. */
/* Normalizes model whitespace artifacts ONCE, centrally:
   - \r\n and stray \r become \n
   - NUL/zero-width junk is dropped
   - 3+ consecutive blank lines collapse to ONE (intentional paragraph spacing
     is preserved; the "chunk … 200 blank lines … chunk" bug dies here)
   - lines that contain ONLY list-marker characters (- • * ▪ ◆) are dropped:
     models emit these as decorative separators and, rendered as pre-wrap
     whitespace, they were the second source of giant gaps
   - trailing spaces are trimmed
   Code-block content INSIDE fences is deliberately untouched; fence openers
   are tracked so normalization never rewrites code formatting. */
export function normalizeAiText(input){
  const src=String(input??'')
    .replace(/\r\n?/g,'\n')
    .replace(/[\u0000\u200B-\u200D\uFEFF]/g,'')
    // PDFBox text extraction (Knowledge Hub / notes pipeline) mangles ASCII
    // backticks into Unicode curly quotes, which destroys fenced-code and
    // inline-code markers before rendering. Reverse exactly that artifact —
    // the renderer's split regexes require real backticks to fire.
    .replace(/[\u2018\u2019]{3}/g,'```')
    .replace(/[\u2018\u2019]{2}/g,'`');
  const lines=src.split('\n');
  const out=[];
  let blankRun=0;
  let inCode=false;
  for(const raw of lines){
    if(raw.trim().startsWith('```')){inCode=!inCode;out.push(raw.trim());blankRun=0;continue}
    if(inCode){out.push(raw);continue}
    let line=raw.replace(/[ \t]+$/g,'');
    // Decorative separator lines that are only list markers (and common
    // unicode dash/bullet runs) — never meaningful content.
    if(/^[\s\-*•·▪▫◆◇—_=]{1,8}$/.test(line)){line=''}

    // Normalize malformed Big-O artifacts outside code blocks
    // Fixes broken model patterns like "$)(n/log n)**" -> "O(log n)"
    line = line.replace(/\$\)\s*\(?\s*(?:n\s*\/\s*)?log\s*n\s*\)?\s*\*+/gi, 'O(log n)');
    line = line.replace(/\$\)\s*\(?([a-zA-Z0-9_\^/\s*+.-]+)\)?\s*\*+/g, 'O($1)');

    // Strip stray unclosed trailing ** immediately following a closing parenthesis on Big-O
    const asterisks = (line.match(/\*\*/g) || []).length;
    if (asterisks % 2 !== 0 && /(?<=\))\s*\*\*$/.test(line)) {
      line = line.replace(/(?<=\))\s*\*\*$/, '');
    }

    if(line===''){
      blankRun++;
      if(blankRun<=1)out.push('');
      continue;
    }
    blankRun=0;
    out.push(line);
  }
  return out.join('\n').replace(/^\n+|\n+$/g,'');
}

/**
 * Extracts a concise summary and key topic bullet points from a lesson.
 * Deliberately excludes lengthy sections such as About, Common Mistakes,
 * Worked Examples, and Self-checks for a lightweight mobile overview.
 */
export function getCompactLessonOverview(lesson) {
  if (!lesson) return { summary: '', topics: [] };
  const topic = lesson.topic || '';
  const rawContent = String(lesson.content || '').trim();
  if (!rawContent) {
    return {
      summary: topic ? `Core concepts in ${topic}.` : 'Core concepts and lecture walkthrough.',
      topics: []
    };
  }

  const lines = rawContent.split('\n').map(l => l.trim());
  let summary = '';
  const bullets = [];
  let inSkippedSection = false;
  let inCode = false;

  const skipSectionRegex = /^#{1,4}\s*(about|mistake|common mistake|worked example|lab|practice|self-check|exercise|pitfall)/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    if (line.startsWith('```')) {
      inCode = !inCode;
      continue;
    }
    if (inCode) continue;

    if (/^#{1,4}\s+/.test(line)) {
      if (skipSectionRegex.test(line)) {
        inSkippedSection = true;
        continue;
      } else {
        inSkippedSection = false;
        if (/^#{1,4}\s*(lesson|lecture)\s+\d+/i.test(line)) continue;
      }
    }

    if (inSkippedSection) continue;

    // Bullet items
    if (/^[-*•]\s+/.test(line)) {
      if (bullets.length < 3) {
        bullets.push(line.replace(/^[-*•]\s+/, '').replace(/\*\*/g, '').slice(0, 90));
      }
      continue;
    }

    // First substantive paragraph for summary
    if (!summary && !line.startsWith('#') && line.length > 20) {
      summary = line.replace(/\*\*/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
    }

    if (summary && bullets.length >= 2) break;
  }

  if (!summary && topic) {
    summary = `Key lecture on ${topic}. Covers essential principles and concepts.`;
  } else if (!summary) {
    summary = 'Explores fundamental lecture concepts and theory.';
  }

  if (summary.length > 180) {
    summary = summary.slice(0, 177).replace(/\s+\S*$/, '') + '…';
  }

  return { summary, topics: bullets };
}

/**
 * Normalizes mathematical expressions to clean Unicode notation for text contexts
 * while strictly preserving mathematical semantics (fractions, square roots, exponents).
 */
export function cleanMath(text) {
  let s = String(text || '').trim();
  // Preserve mathematical meaning for fractions: \frac{a}{b} -> (a)/(b)
  while (/\\frac\{([^{}]+)\}\{([^{}]+)\}/.test(s)) {
    s = s.replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, '($1)/($2)');
  }
  // Preserve mathematical meaning for square roots: \sqrt{x} -> √(x)
  while (/\\sqrt\{([^{}]+)\}/.test(s)) {
    s = s.replace(/\\sqrt\{([^{}]+)\}/g, '√($1)');
  }
  return s
    .replace(/\\mathcal\{O\}|\\mathcal\{o\}/g, 'O')
    .replace(/\\Theta(?![a-zA-Z])|\\theta(?![a-zA-Z])/g, 'Θ')
    .replace(/\\Omega(?![a-zA-Z])|\\omega(?![a-zA-Z])/g, 'Ω')
    .replace(/\\log(?![a-zA-Z])/g, 'log')
    .replace(/\\ln(?![a-zA-Z])/g, 'ln')
    .replace(/\\times(?![a-zA-Z])/g, '×')
    .replace(/\\cdot(?![a-zA-Z])/g, '·')
    .replace(/\\le(?![a-zA-Z])|\\leq(?![a-zA-Z])/g, '≤')
    .replace(/\\ge(?![a-zA-Z])|\\geq(?![a-zA-Z])/g, '≥')
    .replace(/\\ne(?![a-zA-Z])|\\neq(?![a-zA-Z])/g, '≠')
    .replace(/\\approx(?![a-zA-Z])/g, '≈')
    .replace(/\\to(?![a-zA-Z])|\\rightarrow(?![a-zA-Z])/g, '→')
    .replace(/\\in(?![a-zA-Z])/g, '∈')
    .replace(/\\notin(?![a-zA-Z])/g, '∉')
    .replace(/\\infty(?![a-zA-Z])/g, '∞')
    .replace(/\\pm(?![a-zA-Z])/g, '±')
    .replace(/\\sum(?![a-zA-Z])/g, '∑')
    .replace(/\\prod(?![a-zA-Z])/g, '∏')
    .replace(/\\int(?![a-zA-Z])/g, '∫')
    .replace(/\\text\{([^}]+)\}/g, '$1')
    .replace(/\\left|\\right/g, '')
    .trim();
}
