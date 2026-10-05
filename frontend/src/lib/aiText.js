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
