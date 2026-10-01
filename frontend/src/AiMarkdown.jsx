import React,{useState} from 'react';

/* NovaTutor shared AI markdown renderer.
   Pure-React, zero dependencies. Every AI answer surface renders through this
   component (AI Teacher, Chat, DSA hints, Code Lab, Knowledge Hub, Interview,
   exam strategy). It renders the markdown the AI actually produces — headings,
   bold/italic, inline code, fenced code with copy, bullets, numbered lists,
   blockquotes, horizontal rules — as clean premium typography, and normalizes
   pathological model whitespace (runaway blank lines) without destroying
   intentional paragraph spacing or code formatting. */

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

const mdInline=(text)=>{
  const src=String(text);
  // Split on **bold**, `code`, and *italic* (only when flanked by boundaries,
  // so "5*3" or "a * b" never triggers italics).
  const parts=src.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*\n]+\*)/g);
  return parts.map((x,i)=>{
    if(x.startsWith('**')&&x.endsWith('**')&&x.length>4)return <strong key={i}>{x.slice(2,-2)}</strong>;
    if(x.startsWith('`')&&x.endsWith('`')&&x.length>2)return <code key={i}>{x.slice(1,-1)}</code>;
    if(/^\*[^*\n]+\*$/.test(x))return <em key={i}>{x.slice(1,-1)}</em>;
    return x;
  });
};

/* Non-React twin of mdInline for renderers that build plain strings/arrays
   (lesson TheoryContent). Preserves bold/italic/inline code as inline markup. */
export function mdInlineText(text){
  const parts=String(text).split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*\n]+\*)/g);
  return parts.map((x,i)=>{
    if(x.startsWith('**')&&x.endsWith('**')&&x.length>4)return <strong key={i}>{x.slice(2,-2)}</strong>;
    if(x.startsWith('`')&&x.endsWith('`')&&x.length>2)return <code key={i}>{x.slice(1,-1)}</code>;
    if(/^\*[^*\n]+\*$/.test(x))return <em key={i}>{x.slice(1,-1)}</em>;
    return x;
  });
};

function CodeBlock({code}){
  const [copied,setCopied]=useState(false);
  const copy=async()=>{try{if(navigator.clipboard&&window.isSecureContext){await navigator.clipboard.writeText(code)}else{const ta=document.createElement('textarea');ta.value=code;ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.select();document.execCommand('copy');document.body.removeChild(ta)}setCopied(true);setTimeout(()=>setCopied(false),1600)}catch{}} ;
  return (
    <div className="ai-md-code">
      <div className="ai-md-code-bar"><span>CODE</span><button type="button" onClick={copy} className={copied?'ok':''}>{copied?'✓ Copied':'Copy'}</button></div>
      <pre className="ai-code-block"><code>{code}</code></pre>
    </div>
  );
}

/* Model headings are frequently bold-only ("**Key Insight**") or setext-style
   ("Title\n===="). Detect the safe cases so structure is not lost. A bold-only
   line becomes a heading ONLY when it is short and stands alone — never inside
   flowing prose. */
const looksLikeHeading=(t)=>{
  if(/^#{1,6}\s+/.test(t))return true;
  if(/^\*\*[^*]{1,80}\*:?\*\*:?$/.test(t))return true;
  return false;
};

/* Pipe tables. Models emit markdown tables frequently (DSA complexity,
   comparisons); AiMarkdown previously ignored them, rendering run-on text.
   A run qualifies only when lines start AND end with a pipe and there is a
   body row plus a separator row. 2-8 columns; ragged rows are padded. */
const tableLines=(lines,start)=>{
  const rowOf=(t)=>{
    if(!/^\|.*\|$/.test(t))return null;
    return t.slice(1,-1).split('|').map(c=>c.trim());
  };
  const rows=[];let i=start;
  while(i<lines.length){
    const cells=rowOf(lines[i].trim());
    if(!cells)break;
    rows.push(cells);i++;
  }
  if(rows.length<2)return null;
  const isSep=rows[1].every(c=>/^:?-{3,}:?$/.test(c));
  if(!isSep)return null;
  const cols=Math.max(...rows.map(r=>r.length));
  if(cols<2||cols>8)return null;
  const body=rows.filter((_,idx)=>idx!==1).map(r=>{const c=r.slice();while(c.length<cols)c.push('');return c});
  return {cols,body,next:i};
};

export default function AiMarkdown({content}){
  const src=normalizeAiText(content);
  const lines=src.split('\n');
  const out=[];let buf=[];
  let code=[];let inCode=false;let codeIdx=0;

  const flush=()=>{if(buf.length){out.push(<p className="ai-md-p" key={'p'+out.length}>{mdInline(buf.join(' '))}</p>);buf=[]}};

  for(let i=0;i<lines.length;i++){
    const line=lines[i];
    const fence=line.trim().startsWith('```');
    if(fence){
      flush();
      if(inCode){out.push(<CodeBlock key={'c'+(codeIdx++)} code={code.join('\n')}/>);code=[];inCode=false}
      else inCode=true;
      continue;
    }
    if(inCode){code.push(line);continue}

    const t=line.trim();
    if(!t){flush();continue}
    // Pipe tables are matched first — their leading pipe must not be mistaken
    // for list markers or prose, and the whole run is consumed at once.
    const tbl=tableLines(lines,i);
    if(tbl){
      flush();
      out.push(
        <div className="ai-md-table-wrap" key={'t'+out.length}>
          <table className="ai-md-table">
            <thead><tr>{tbl.body[0].map((c,ci)=><th key={ci}>{mdInline(c)}</th>)}</tr></thead>
            <tbody>{tbl.body.slice(1).map((r,ri)=><tr key={ri}>{r.map((c,ci)=><td key={ci}>{mdInline(c)}</td>)}</tr>)}</tbody>
          </table>
        </div>
      );
      i=tbl.next-1;continue;
    }
    // Multi-line paragraphs (soft-wrapped model output) are joined.
    if(
      looksLikeHeading(t)||/^[-*•]\s+/.test(t)||/^\d+[.)]\s+/.test(t)||
      /^[-—=_*]{3,}$/.test(t)||/^>/.test(t)||
      (buf.length&&!/^(?:[-*•]\s+|\d+[.)]\s+)/.test(t))
    ){flush()}

    let m;
    if((m=t.match(/^(#{1,6})\s+(.*)$/))){
      const level=Math.min(m[1].length,3);
      out.push(<h4 className={'ai-md-heading h'+level} key={'h'+out.length}>{mdInline(m[2]||'')}</h4>);
      continue;
    }
    if((m=t.match(/^\*\*([^*]{1,80})\*:?\*\*:?!?$/))){
      out.push(<h4 className={'ai-md-heading h2'} key={'h'+out.length}>{mdInline(m[1])}</h4>);
      continue;
    }
    if(/^[-—=_*]{3,}$/.test(t)){out.push(<hr className="ai-md-hr" key={'hr'+out.length}/>);continue}
    if(/^>/.test(t)){out.push(<blockquote className="ai-md-quote" key={'q'+out.length}>{mdInline(t.replace(/^>\s?/,''))}</blockquote>);continue}
    if((m=t.match(/^[-*•]\s+(.*)$/))){
      out.push(<div className="ai-md-bullet" key={'b'+out.length}><span className="ai-md-bullet-dot" aria-hidden="true"/><div>{mdInline(m[1])}</div></div>);
      continue;
    }
    if((m=t.match(/^(\d+)[.)]\s+(.*)$/))){
      out.push(<div className="ai-md-bullet" key={'n'+out.length}><span className="ai-md-num">{m[1]}.</span><div>{mdInline(m[2])}</div></div>);
      continue;
    }
    buf.push(t);
  }
  flush();
  if(inCode&&code.length)out.push(<CodeBlock key={'c-tail'} code={code.join('\n')}/>);
  // Empty/null response: render nothing — never a giant blank container.
  if(!out.length)return null;
  return <div className="ai-markdown">{out}</div>;
}
