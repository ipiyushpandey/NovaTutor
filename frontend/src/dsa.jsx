import React,{useEffect,useMemo,useState,useCallback,useRef} from 'react';
import {Code2,Target,CheckCircle2,ChevronLeft,BookOpen,Lightbulb,Brain,PlayCircle,Clock3,RotateCcw} from './icons.jsx';
import AiMarkdown from './AiMarkdown.jsx';

const LANGS=[['java','Java'],['python','Python'],['c++','C++'],['c','C'],['javascript','JavaScript'],['go','Go']];
const DIFF_COLOR={EASY:'var(--success)',MEDIUM:'var(--warning)',HARD:'var(--danger)'};

function DiffPill({d}){
  const c=DIFF_COLOR[d]||'var(--text-2)';
  return <span className="dsa-pill" style={{color:c}}>{d}</span>;
}
function StatusMark({st}){
  if(st==='SOLVED') return <span className="dsa-status" style={{color:'var(--success)'}}><CheckCircle2 size={14}/>Solved</span>;
  if(st==='ATTEMPTED') return <span className="dsa-status" style={{color:'var(--warning)'}}><RotateCcw size={13}/>Attempted</span>;
  return <span className="dsa-status" style={{color:'var(--muted)'}}><Target size={13}/>New</span>;
}

export default function DsaPractice({user,api}){
  const [problems,setProblems]=useState(null);
  const [stats,setStats]=useState(null);
  const [progress,setProgress]=useState({});
  const [summary,setSummary]=useState(null);
  const [slug,setSlug]=useState(null);
  const [q,setQ]=useState('');
  const [diff,setDiff]=useState('ALL');
  const [topic,setTopic]=useState('ALL');
  const [status,setStatus]=useState('ALL');
  const [err,setErr]=useState('');

  const refreshProgress=useCallback(async()=>{
    try{
      const [pr,su]=await Promise.all([api('/dsa/progress'),api('/dsa/progress/summary')]);
      const map={}; (pr.problems||[]).forEach(r=>{map[r.slug]=r});
      setProgress(map); setSummary(su);
    }catch(e){/* silent: progress is non-critical */}
  },[api]);

  useEffect(()=>{
    let dead=false;
    (async()=>{
      try{
        const [p,s]=await Promise.all([api('/dsa/problems'),api('/dsa/stats')]);
        if(!dead){setProblems(p||[]);setStats(s);}
      }catch(e){if(!dead)setErr(String(e.message||e));}
    })();
    refreshProgress();
    return()=>{dead=true};
  },[api,refreshProgress]);

  const topics=useMemo(()=>{
    const t=new Set();
    (problems||[]).forEach(p=>t.add(p.topic));
    return ['ALL',...Array.from(t).sort()];
  },[problems]);

  const filtered=useMemo(()=>{
    const needle=q.trim().toLowerCase();
    return (problems||[]).filter(p=>{
      if(diff!=='ALL'&&p.difficulty!==diff)return false;
      if(topic!=='ALL'&&p.topic!==topic)return false;
      if(needle&&!(p.title.toLowerCase().includes(needle)||p.slug.includes(needle)||(p.tags||[]).join(',').includes(needle)))return false;
      if(status!=='ALL'){
        const st=(progress[p.slug]||{}).status||'NEW';
        if(status==='BOOKMARKED'&&!(progress[p.slug]||{}).bookmarked)return false;
        if(status!=='BOOKMARKED'&&st!==status)return false;
      }
      return true;
    });
  },[problems,q,diff,topic,status,progress]);

  if(slug) return <DsaProblemView key={slug} api={api} slug={slug}
      saved={progress[slug]} onBack={()=>setSlug(null)} onProgress={refreshProgress}/>;

  return (
    <div className="dsa-page">
      <section className="dsa-hero">
        <div className="dsa-hero-copy">
          <span className="eyebrow">NOVA DSA ARENA</span>
          <h1>Master DSA, <span>one submission</span> at a time.</h1>
          <p>A real judge experience: write code in Java, Python, C++, C, JavaScript or Go, run against visible samples, then submit to hidden tests. Every problem is verified by a reference oracle — from warm-ups to hard interview ladders.</p>
          <div className="dsa-hero-actions">
            <button className="primary" onClick={()=>document.getElementById('dsa-browser')?.scrollIntoView({behavior:'smooth'})}>
              <Code2 size={15}/>Browse problems
            </button>
            {summary&&(
              <span className="dsa-hero-progress">
                {summary.solved}/{summary.total} solved
                <span className="dsa-progress-track"><span className="dsa-progress-fill" style={{width:`${summary.total?Math.round(100*summary.solved/summary.total):0}%`}}/></span>
              </span>
            )}
          </div>
        </div>
        <div className="dsa-hero-stat">
          <b>{stats?stats.total:'…'}</b>
          <small>{stats?`${stats.easy} easy · ${stats.medium} medium · ${stats.hard} hard`:'PROBLEMS · EASY → HARD'}</small>
        </div>
      </section>

      <section className="dsa-stat-grid">
        <div><b>{summary?summary.total:'—'}</b><span>Total problems</span></div>
        <div><b style={{color:'var(--success)'}}>{summary?summary.solved:'—'}</b><span>Solved</span></div>
        <div><b style={{color:'var(--energy)'}}>{summary?summary.attempted:'—'}</b><span>Attempted</span></div>
        <div><b style={{color:'var(--energy)'}}>{summary?summary.bookmarked:'—'}</b><span>Bookmarked</span></div>
      </section>

      <section id="dsa-browser">
        <div className="dsa-section-head">
          <h3>Problem set</h3>
          <p>Filter by difficulty, topic or your own progress. Hidden tests never leave the server — pass every one to turn a problem green.</p>
        </div>
        <div className="dsa-toolbar">
          <input type="text" placeholder="Search title, slug or tag…" value={q} onChange={e=>setQ(e.target.value)}/>
          <select aria-label="Difficulty" value={diff} onChange={e=>setDiff(e.target.value)}>
            <option value="ALL">All difficulty</option><option value="EASY">Easy</option><option value="MEDIUM">Medium</option><option value="HARD">Hard</option>
          </select>
          <select aria-label="Topic" value={topic} onChange={e=>setTopic(e.target.value)}>
            {topics.map(t=><option key={t} value={t}>{t==='ALL'?'All topics':t}</option>)}
          </select>
          <select aria-label="Status" value={status} onChange={e=>setStatus(e.target.value)}>
            <option value="ALL">Any status</option><option value="NEW">New</option><option value="ATTEMPTED">Attempted</option><option value="SOLVED">Solved</option><option value="BOOKMARKED">Bookmarked</option>
          </select>
          <span className="dsa-count">{filtered.length} problem{filtered.length===1?'':'s'}</span>
        </div>

        {err&&<div className="dsa-banner warn">{err}</div>}
        {!problems&&!err&&<div className="dsa-loading">Loading problem set…</div>}
        {problems&&filtered.length===0&&!err&&<div className="dsa-loading">No problems match these filters.</div>}

        <div className="dsa-list">
          {filtered.map((p,i)=>{
            const st=progress[p.slug]||{};
            return (
              /* role=button div: the row contains a nested bookmark button, which
                 is invalid inside a real <button>. Keyboard + a11y preserved. */
              <div className="dsa-row" role="button" tabIndex={0} key={p.slug}
                onClick={()=>setSlug(p.slug)}
                onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();setSlug(p.slug)}}}>
                <span className="dsa-idx">{String(i+1).padStart(2,'0')}</span>
                <span className="dsa-row-main">
                  <b>{p.title}</b>
                  <small>{p.topic} · {(p.tags||[]).slice(0,3).join(' · ')}</small>
                </span>
                <span className="dsa-row-side">
                  <StatusMark st={st.status||'NEW'}/>
                  <small className="dsa-sig">{p.signature}</small>
                </span>
                <span className="dsa-row-actions" onClick={e=>e.stopPropagation()}>
                  <button className={'dsa-star'+(st.bookmarked?' on':'')} title={st.bookmarked?'Remove bookmark':'Bookmark'}
                    aria-label={st.bookmarked?'Remove bookmark':'Bookmark problem'} aria-pressed={st.bookmarked}
                    onClick={async()=>{
                      const nb=!st.bookmarked;
                      setProgress(prev=>({...prev,[p.slug]:{...st,bookmarked:nb}}));
                      try{await api(`/dsa/progress/${p.slug}/bookmark`,{method:'POST',body:JSON.stringify({bookmarked:nb})});refreshProgress();}catch(e){refreshProgress();}
                    }}>★</button>
                  <DiffPill d={p.difficulty}/>
                </span>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function DsaProblemView({api,slug,saved,onBack,onProgress}){
  const [problem,setProblem]=useState(null);
  const [lang,setLang]=useState(saved?.lastLanguage&&LANGS.some(l=>l[0]===saved.lastLanguage)?saved.lastLanguage:'java');
  const [codeByLang,setCodeByLang]=useState({});
  const [code,setCode]=useState('');
  const [result,setResult]=useState(null);
  const [running,setRunning]=useState(false);
  const [hint,setHint]=useState(null);
  const [hintBusy,setHintBusy]=useState(false);
  const [loadErr,setLoadErr]=useState('');
  const [bookmarked,setBookmarked]=useState(Boolean(saved?.bookmarked));
  const lastSavedRef=useRef('');

  // Load problem detail + restore/fetch code for the initial language.
  useEffect(()=>{
    let dead=false;
    (async()=>{
      try{
        const p=await api(`/dsa/problems/${slug}`);
        if(dead)return;
        setProblem(p);
        const draft=localStorage.getItem(`dsa_code_${slug}_${lang}`);
        if(draft!==null){setCode(draft);}
        else if(saved?.lastLanguage===lang&&saved?.lastCode){setCode(saved.lastCode);}
        else{
          const s=await api(`/dsa/problems/${slug}/starter?language=${encodeURIComponent(lang)}`);
          if(!dead&&s&&s.code)setCode(s.code);
        }
      }catch(e){if(!dead)setLoadErr(String(e.message||e));}
    })();
    return()=>{dead=true};
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[slug]);

  const draftKey=useMemo(()=>`dsa_code_${slug}_${lang}`,[slug,lang]);

  const switchLang=useCallback(async(next)=>{
    setLang(next);
    setResult(null);
    const draft=localStorage.getItem(`dsa_code_${slug}_${next}`);
    if(draft!==null){setCode(draft);return;}
    if(codeByLang[next]){setCode(codeByLang[next]);return;}
    try{
      const s=await api(`/dsa/problems/${slug}/starter?language=${encodeURIComponent(next)}`);
      if(s&&s.code){setCode(s.code);setCodeByLang(m=>({...m,[next]:s.code}));}
    }catch(e){setCode('// starter unavailable: '+String(e.message||e));}
  },[api,slug,codeByLang]);

  const persistCode=useCallback(async(text,language)=>{
    try{
      await api(`/dsa/progress/${slug}/code`,{method:'POST',body:JSON.stringify({language,code:text})});
    }catch(e){/* non-fatal */}
  },[api,slug]);

  const onEdit=useCallback(text=>{
    setCode(text);
    setCodeByLang(m=>({...m,[lang]:text}));
    try{localStorage.setItem(draftKey,text);}catch(e){}
  },[lang,draftKey]);

  const run=useCallback(async()=>{
    setRunning(true);setResult(null);
    try{
      const r=await api(`/dsa/problems/${slug}/run`,{method:'POST',body:JSON.stringify({language:lang,code})},{timeoutMs:180000});
      setResult(r);
      lastSavedRef.current=code;
      persistCode(code,lang);
      onProgress();
    }catch(e){
      setResult({status:'RUNTIME_ERROR',message:String(e.message||e),tests:[],passed:0,total:0,accepted:false});
    }finally{setRunning(false);}
  },[api,slug,lang,code,persistCode,onProgress]);

  const askHint=useCallback(async(mode)=>{
    setHintBusy(true);setHint(null);
    try{
      const r=await api(`/dsa/problems/${slug}/hint`,{method:'POST',body:JSON.stringify({mode,code:mode==='review'?code:undefined})},{timeoutMs:120000});
      setHint(r?.answer||'AI is unavailable right now.');
    }catch(e){setHint(String(e.message||e));}
    finally{setHintBusy(false);}
  },[api,slug,code]);

  const toggleBookmark=useCallback(async()=>{
    const nb=!bookmarked;
    setBookmarked(nb);
    try{await api(`/dsa/progress/${slug}/bookmark`,{method:'POST',body:JSON.stringify({bookmarked:nb})});onProgress();}catch(e){setBookmarked(!nb);}
  },[api,slug,bookmarked,onProgress]);

  if(loadErr) return (
    <div className="dsa-page">
      <button className="dsa-back" onClick={onBack}><ChevronLeft size={15}/>Back to problems</button>
      <div className="dsa-banner warn">{loadErr}</div>
    </div>
  );
  if(!problem) return <div className="dsa-page"><div className="dsa-loading">Loading problem…</div></div>;

  const st=(result&&result.status)||'';
  const bannerClass=st==='PASSED'?'pass':(st==='FAILED'||st==='RUNTIME_ERROR')?'fail':(st==='COMPILE_ERROR'||st==='UNSUPPORTED_LANGUAGE')?'warn':'info';

  return (
    <div className="dsa-page">
      <button className="dsa-back" onClick={onBack}><ChevronLeft size={15}/>Back to problems</button>

      <div className="dsa-detail-head">
        <div className="dsa-detail-title">
          <h2>{problem.title}</h2>
          <div className="dsa-detail-pills">
            <DiffPill d={problem.difficulty}/>
            <span className="dsa-pill topic">{problem.topic}</span>
            <span className="dsa-pill sig">{problem.signature}</span>
          </div>
        </div>
        <div className="dsa-detail-actions">
          <button className={'dsa-star'+(bookmarked?' on':'')} onClick={toggleBookmark} title={bookmarked?'Remove bookmark':'Bookmark'} aria-label={bookmarked?'Remove bookmark':'Bookmark problem'} aria-pressed={bookmarked}>★</button>
          <span className="dsa-status"><Clock3 size={13}/>{saved?.attempts||0} attempt{(saved?.attempts||0)===1?'':'s'}</span>
        </div>
      </div>

      {/* Desktop: problem info left, editor right. Mobile: stacks naturally. */}
      <div className="dsa-work">
      <div className="dsa-grid2">
        <div className="dsa-card">
          <h4>Statement</h4>
          <p className="dsa-statement">{problem.statement}</p>
          {problem.constraints&&<p className="dsa-constraints"><b>Constraints.</b> {problem.constraints}</p>}
          {(problem.tags||[]).length>0&&<div className="dsa-tags">{problem.tags.map(t=><span key={t}>#{t}</span>)}</div>}
        </div>
        <div className="dsa-card dsa-samples">
          <h4>Samples</h4>
          {(problem.samples||[]).map((s,i)=>(
            <div className="dsa-sample" key={i}>
              <div className="dsa-sample-row"><small>Input</small><pre>{s.input}</pre></div>
              <div className="dsa-sample-row"><small>Expected</small><pre>{s.expected}</pre></div>
            </div>
          ))}
          <small className="dsa-hidden-note">Hidden tests are executed server-side and never revealed.</small>
        </div>
      </div>

      <div className="dsa-card dsa-editor">
        <div className="dsa-editor-head">
          <h4><Code2 size={15}/>Solution</h4>
          <div className="dsa-editor-tools">
            <select aria-label="Language" value={lang} onChange={e=>switchLang(e.target.value)}>
              {LANGS.map(l=><option key={l[0]} value={l[0]} disabled={l[0]==='c'&&!problem.cSupported}>{l[1]}{l[0]==='c'&&!problem.cSupported?' (n/a)':''}</option>)}
            </select>
            <button className="text-btn" onClick={async()=>{const s=await api(`/dsa/problems/${slug}/starter?language=${encodeURIComponent(lang)}`);if(s&&s.code)onEdit(s.code);}}>Reset starter</button>
          </div>
        </div>
        <textarea spellCheck={false} value={code} onChange={e=>onEdit(e.target.value)}
          onKeyDown={e=>{if(e.key==='Tab'){e.preventDefault();const el=e.target,s=el.selectionStart,en=el.selectionEnd;const v=el.value.slice(0,s)+'  '+el.value.slice(en);onEdit(v);requestAnimationFrame(()=>{el.selectionStart=el.selectionEnd=s+2;});}}}/>
        <div className="dsa-runbar">
          <button className="primary" onClick={run} disabled={running||!code.trim()}>
            <PlayCircle size={16}/>{running?'Judging…':'Run & submit'}
          </button>
          <span className="dsa-note">Runs your code against visible samples, then hidden tests. Your code is saved automatically on submit.</span>
        </div>
      </div>
      </div>

      {result&&(
        <div className="dsa-card dsa-res">
          <div className={`dsa-banner ${bannerClass}`}>
            <b>{result.status==='PASSED'?'Accepted':result.status==='FAILED'?'Wrong answer':result.status.replace(/_/g,' ')}</b>
            <span>{result.passed}/{result.total} tests passed{result.message?` — ${result.message}`:''}</span>
          </div>
          {/* Sandbox failure paths must never dead-end: give the student the
              exact recovery step (mirrors the Code Lab banner hints). */}
          {result.status==='SANDBOX_NOT_ENABLED'&&<div className="dsa-banner info"><span>Code execution runs in a Docker sandbox. Start Docker Desktop and keep CODE_RUNNER_ENABLED=true, then restart Spring Boot — AI hints and static analysis still work without it.</span></div>}
          {result.status==='RUNNER_UNAVAILABLE'&&<div className="dsa-banner info"><span>The sandbox runner could not be reached. Make sure Docker Desktop is running and the configured runner images can be pulled, then try again.</span></div>}
          <div className="dsa-tests">
            {(result.tests||[]).map(t=>(
              <div className={'dsa-test'+(t.passed?'':' bad')} key={t.index}>
                <div className="dsa-test-head">
                  <span className="dsa-badge">{t.sample?'SAMPLE':'HIDDEN'}</span>
                  <b>{t.passed?'✓ passed':'✗ failed'}</b>
                </div>
                {!t.passed&&t.sample&&(
                  <div className="dsa-test-grid">
                    <div><small>Input</small><pre>{t.input}</pre></div>
                    <div><small>Expected</small><pre>{t.expected}</pre></div>
                    <div><small>Actual</small><pre>{t.actual}</pre></div>
                  </div>
                )}
                {!t.passed&&!t.sample&&<small className="dsa-hidden-note">{t.note||'Hidden test failed — check edge cases.'}</small>}
                {t.passed&&t.note&&<small className="dsa-hidden-note">{t.note}</small>}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="dsa-card dsa-hint">
        <h4><Lightbulb size={15}/>Nova AI mentor</h4>
        <div className="dsa-hint-actions">
          <button className="secondary" onClick={()=>askHint('hint')} disabled={hintBusy}><Lightbulb size={14}/>Nudge</button>
          <button className="secondary" onClick={()=>askHint('approach')} disabled={hintBusy}><Brain size={14}/>Approach</button>
          <button className="secondary" onClick={()=>askHint('review')} disabled={hintBusy}><BookOpen size={14}/>Review my code</button>
        </div>
        {hintBusy&&<div className="dsa-loading dsa-thinking"><span className="nova-thinking-dots" aria-hidden="true"><i/><i/><i/></span>Nova is thinking…</div>}
        {hint&&<div className="dsa-hint-box"><AiMarkdown content={hint}/></div>}
      </div>
    </div>
  );
}
