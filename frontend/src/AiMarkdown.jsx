import React,{useEffect,useRef,useState} from 'react';
import {normalizeAiText, getCompactLessonOverview} from './lib/aiText.js';

/* NovaTutor shared AI markdown renderer.
   Pure-React, zero dependencies. Every AI answer surface renders through this
   component (AI Teacher, Chat, DSA hints, Code Lab, Knowledge Hub, Interview,
   exam strategy). It renders the markdown the AI actually produces — headings,
   bold/italic, inline code, fenced code with copy, bullets, numbered lists,
   blockquotes, horizontal rules, mathematical expressions and Big-O notation —
   as clean premium typography, and normalizes pathological model whitespace
   without destroying intentional paragraph spacing or code formatting. */

export {normalizeAiText, getCompactLessonOverview};

export function cleanMath(text){
  return String(text||'')
    .replace(/\\log\b/g,'log')
    .replace(/\\times\b|\\cdot\b/g,'×')
    .replace(/\\le\b|\\leq\b/g,'≤')
    .replace(/\\ge\b|\\geq\b/g,'≥')
    .replace(/\\ne\b|\\neq\b/g,'≠')
    .replace(/\\approx\b/g,'≈')
    .replace(/\\to\b|\\rightarrow\b/g,'→')
    .replace(/\\in\b/g,'∈')
    .replace(/\\infty\b/g,'∞')
    .replace(/\\mathcal\{O\}|\\mathcal\{o\}/g,'O')
    .replace(/\\Theta\b|\\theta\b/g,'Θ')
    .replace(/\\Omega\b|\\omega\b/g,'Ω')
    .replace(/\\text\{([^}]+)\}/g,'$1')
    .replace(/\\(?:sqrt|frac)\{([^}]+)\}/g,'$1')
    .trim();
}

const mdInline=(text)=>{
  const src=String(text).replace(/^#{1,6}\s*/, '');
  // Split on ***bold-italic***, **bold**, __bold__, `code`, $math$, \(math\), *italic*, _italic_
  const parts=src.split(/(\*\*\*[^\n]+?\*\*\*|\*\*[^\n]+?\*\*|__[^_\n]+?__|`[^`\n]+`|\$(?!\s)[^$\n]+?(?<!\s)\$|\\\([^\n]+?\\\)|(?<!\*)\*[^*\n]+?\*(?!\*)|(?<!_)_[^_\n]+?_(?!_))/g);
  return parts.map((x,i)=>{
    if(!x)return null;
    if(x.startsWith('***')&&x.endsWith('***')&&x.length>6)return <strong key={i}><em>{x.slice(3,-3)}</em></strong>;
    if(x.startsWith('**')&&x.endsWith('**')&&x.length>4)return <strong key={i}>{x.slice(2,-2)}</strong>;
    if(x.startsWith('__')&&x.endsWith('__')&&x.length>4)return <strong key={i}>{x.slice(2,-2)}</strong>;
    if(x.startsWith('`')&&x.endsWith('`')&&x.length>2)return <code key={i}>{x.slice(1,-1)}</code>;
    if(x.startsWith('$')&&x.endsWith('$')&&x.length>2)return <span className="ai-md-math" key={i}>{cleanMath(x.slice(1,-1))}</span>;
    if(x.startsWith('\\(')&&x.endsWith('\\)')&&x.length>4)return <span className="ai-md-math" key={i}>{cleanMath(x.slice(2,-2))}</span>;
    if(/^\*[^*\n]+\*$/.test(x))return <em key={i}>{x.slice(1,-1)}</em>;
    if(/^_[^_\n]+_$/.test(x))return <em key={i}>{x.slice(1,-1)}</em>;
    return x;
  });
};

/* Non-React twin of mdInline for renderers that build plain strings/arrays
   (lesson TheoryContent). Preserves bold/italic/inline code and math markup. */
export function mdInlineText(text){
  const src=String(text).replace(/^#{1,6}\s*/, '');
  const parts=src.split(/(\*\*\*[^\n]+?\*\*\*|\*\*[^\n]+?\*\*|__[^_\n]+?__|`[^`\n]+`|\$(?!\s)[^$\n]+?(?<!\s)\$|\\\([^\n]+?\\\)|(?<!\*)\*[^*\n]+?\*(?!\*)|(?<!_)_[^_\n]+?_(?!_))/g);
  return parts.map((x,i)=>{
    if(!x)return null;
    if(x.startsWith('***')&&x.endsWith('***')&&x.length>6)return <strong key={i}><em>{x.slice(3,-3)}</em></strong>;
    if(x.startsWith('**')&&x.endsWith('**')&&x.length>4)return <strong key={i}>{x.slice(2,-2)}</strong>;
    if(x.startsWith('__')&&x.endsWith('__')&&x.length>4)return <strong key={i}>{x.slice(2,-2)}</strong>;
    if(x.startsWith('`')&&x.endsWith('`')&&x.length>2)return <code key={i}>{x.slice(1,-1)}</code>;
    if(x.startsWith('$')&&x.endsWith('$')&&x.length>2)return <span className="ai-md-math" key={i}>{cleanMath(x.slice(1,-1))}</span>;
    if(x.startsWith('\\(')&&x.endsWith('\\)')&&x.length>4)return <span className="ai-md-math" key={i}>{cleanMath(x.slice(2,-2))}</span>;
    if(/^\*[^*\n]+\*$/.test(x))return <em key={i}>{x.slice(1,-1)}</em>;
    if(/^_[^_\n]+_$/.test(x))return <em key={i}>{x.slice(1,-1)}</em>;
    return x;
  });
};

function CodeBlock({code}){
  const [copied,setCopied]=useState(false);
  const timerRef=useRef(null);
  useEffect(()=>()=>clearTimeout(timerRef.current),[]);
  const copy=async()=>{try{if(navigator.clipboard&&window.isSecureContext){await navigator.clipboard.writeText(code)}else{const ta=document.createElement('textarea');ta.value=code;ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.select();document.execCommand('copy');document.body.removeChild(ta)}setCopied(true);clearTimeout(timerRef.current);timerRef.current=setTimeout(()=>setCopied(false),1600)}catch{}} ;
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
  if(/^#{1,6}\s*/.test(t))return true;
  if(/^\*\*[^*]{1,80}\*\*:?$/.test(t))return true;
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
  const out=[];let buf=[];let quotes=[];
  let code=[];let inCode=false;let codeIdx=0;

  const flushQuotes=()=>{
    if(quotes.length){
      out.push(
        <blockquote className="ai-md-quote" key={'q'+out.length}>
          {quotes.map((q,qi)=><p key={qi}>{mdInline(q)}</p>)}
        </blockquote>
      );
      quotes=[];
    }
  };

  const flush=()=>{
    flushQuotes();
    if(buf.length){out.push(<p className="ai-md-p" key={'p'+out.length}>{mdInline(buf.join(' '))}</p>);buf=[]}
  };

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

    if(t.startsWith('>')){
      if(buf.length) flush();
      quotes.push(t.replace(/^>\s*/,''));
      continue;
    } else {
      flushQuotes();
    }

    // Flush accumulated paragraph lines before block-level elements; consecutive prose lines join.
    if(
      looksLikeHeading(t)||/^[-*•]\s+/.test(t)||/^\d+[.)]\s+/.test(t)||
      /^[-—=_*]{3,}$/.test(t)||(t.startsWith('$$')&&t.endsWith('$$'))||(t.startsWith('\\[')&&t.endsWith('\\]'))
    ){flush()}

    // Block math $$...$$ or \[...\]
    if((t.startsWith('$$')&&t.endsWith('$$')&&t.length>4)||(t.startsWith('\\[')&&t.endsWith('\\]')&&t.length>4)){
      const mathBody=t.startsWith('$$')?t.slice(2,-2):t.slice(2,-2);
      out.push(<div className="ai-md-math-block" key={'mb'+out.length}>{cleanMath(mathBody)}</div>);
      continue;
    }

    let m;
    if((m=t.match(/^(#{1,6})\s*(.*)$/))){
      const level=Math.min(m[1].length,3);
      out.push(<h4 className={'ai-md-heading h'+level} key={'h'+out.length}>{mdInline(m[2]||'')}</h4>);
      continue;
    }
    if((m=t.match(/^\*\*([^*]{1,80})\*\*:?!?$/))){
      out.push(<h4 className={'ai-md-heading h2'} key={'h'+out.length}>{mdInline(m[1])}</h4>);
      continue;
    }
    if(/^[-—=_*]{3,}$/.test(t)){out.push(<hr className="ai-md-hr" key={'hr'+out.length}/>);continue}
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
  flushQuotes();
  if(inCode&&code.length)out.push(<CodeBlock key={'c-tail'} code={code.join('\n')}/>);
  // Empty/null response: render nothing — never a giant blank container.
  if(!out.length)return null;
  return <div className="ai-markdown">{out}</div>;
}
