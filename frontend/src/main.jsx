import React,{useEffect,useLayoutEffect,useState,useRef,useMemo,useCallback,useSyncExternalStore} from 'react';
import {createRoot} from 'react-dom/client';
import {Icon as NovaIcon,BookOpen,BrainCircuit,Code2,FileText,LayoutDashboard,MessageCircle,Target,Sparkles,ChevronRight,Send,Menu,LogOut,Plus,Trash2,CheckCircle2,PlayCircle,BarChart3,RotateCcw,UploadCloud,FileSearch,CalendarDays,Layers3,WandSparkles,Clock3,GraduationCap,Lightbulb,Brain,RefreshCw,Mic,MicOff,Volume2,VolumeX,UserRound,Trophy,StopCircle,Bell,Sun,Moon,Users,Briefcase} from './icons.jsx';
/* Load order matters: the LEGACY stylesheet first (it still defines its own
   variables and component styles), then the redesign system so its tokens win
   the cascade for shared custom-property names (--accent, --surface, ...).
   Legacy blocks retire phase by phase; tokens stay last permanently. */
import './styles.css';
import './ui/tokens.css';
import './ui/motion.css';
import './ui/primitives.css';
const GateCse = React.lazy(() => import('./gateCse.jsx'));
const DsaPractice = React.lazy(() => import('./dsa.jsx'));
const AdminControlCenter = React.lazy(() => import('./AdminControlCenter.jsx'));
import LottiePlayer from './ui/LottiePlayer.jsx';
import lottieLogoUrl from './assets/lottie-logo.json?url';
import BooksScene from './ui/BooksScene.jsx';
import './ui/books-scene.css';
import './ui/premium.css';
import {readWorkspace,writeWorkspace,workspaceKey,subscribeWorkspace,migrateWorkspaceIfNeeded,removeWorkspace} from './persistence/workspaceStore.js';
import AiMarkdown, {normalizeAiText, mdInlineText} from './AiMarkdown.jsx';
import {registerWorkspaceFlusher,beginNavigationPersistence} from './persistence/appWorkspace.js';
import {readRuntimeState,writeRuntimeState,subscribeRuntimeState,getRuntimeModuleSnapshot,updateRuntimeState,removeRuntimeState,clearRuntimeUser} from './persistence/runtimeStore.js';
import {api,apiStream,readUser,refreshSessionToken,invalidatePendingSessionRefresh} from './lib/api.js';
import {isMeaningfulText} from './lib/validation.js';
/* V69 FOUNDATION REPAIR — production curriculum + stable learning foundation */
/* V51 VOICE SPEED + CHAT CONTROLS */
/* V34 FINAL EVENTS */
const novaProfileUpdated=()=>{try{window.dispatchEvent(new Event('nova:profile-updated'));}catch(e){}};
const novaChallengesUpdated=()=>{try{window.dispatchEvent(new Event('nova:challenges-updated'));}catch(e){}};

function useScrollReveal(containerRef, deps = []) {
 useEffect(() => {
  if (typeof window === 'undefined') return;
  const isReduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const root = containerRef?.current || document;
  const observeAll = (obs) => {
   const elements = root.querySelectorAll('.reveal:not(.in-view), .stagger-reveal:not(.in-view)');
   elements.forEach(el => {
    if (isReduced || typeof IntersectionObserver === 'undefined') {
     el.classList.add('in-view');
    } else if (obs) {
     obs.observe(el);
    }
   });
  };
  if (isReduced || typeof IntersectionObserver === 'undefined') {
   observeAll(null);
   return;
  }
  const io = new IntersectionObserver((entries, obs) => {
   entries.forEach(entry => {
    if (entry.isIntersecting) {
     entry.target.classList.add('in-view');
     obs.unobserve(entry.target);
    }
   });
  }, { threshold: 0.05, rootMargin: '0px 0px 40px 0px' });
  observeAll(io);
  const mo = new MutationObserver(() => observeAll(io));
  mo.observe(root.body || root, { childList: true, subtree: true });
  return () => { io.disconnect(); mo.disconnect(); };
 }, deps);
}

const Settings=props=><NovaIcon name="Settings" {...props}/>;

const readJSON=(key,fallback=null)=>{try{const raw=localStorage.getItem(key);return raw?JSON.parse(raw):fallback}catch{return fallback}};
const moduleStateKey=(userId,module)=>workspaceKey(userId,module);
const readModuleState=(userId,module,fallback={})=>{
 const envelope=readWorkspace(userId,module,null);
 return envelope?.state && typeof envelope.state==='object' ? envelope.state : fallback;
};
const writeModuleState=(userId,module,state)=>writeWorkspace(userId,module,state);

/*
 * V70.12 Persistent Workspace Engine adapter.
 * Restore is completed before autosave is enabled. A schema-versioned
 * workspace is used while V70.11 keys remain readable through migration.
 */
function applyModuleRestore(restore,savedState){
 if(!savedState||typeof savedState!=='object')return;
 if(typeof restore==='function'){
  try{restore(savedState)}catch{}
  return;
 }
 if(restore&&typeof restore==='object'){
  for(const [k,fn] of Object.entries(restore)){
   if(typeof fn==='function'&&Object.prototype.hasOwnProperty.call(savedState,k)){
    try{fn(savedState[k])}catch{}
   }
  }
 }
}

function useModulePersistence(userId,module,state,restore){
 const persistenceKey=moduleStateKey(userId,module);
 const [hydratedKey,setHydratedKey]=useState(null);
 const hydrationRef=useRef(null);
 const restoreRef=useRef(restore);
 const pendingRestoreRef=useRef(false);
 const stateRef=useRef(state);
 const durableTimerRef=useRef(null);
 const stateSignature=(()=>{try{return JSON.stringify(state)}catch{return ''}})();
 restoreRef.current=restore;
 stateRef.current=state;

 // Runtime memory is the canonical in-session source; localStorage is debounced
 // and flushed synchronously on navigation/pagehide/unmount to avoid 1s timer thrashing.
 useLayoutEffect(()=>{
  let alive=true;
  hydrationRef.current=null;
  pendingRestoreRef.current=true;
  setHydratedKey(null);

  const runtime=readRuntimeState(userId,module,null);
  const saved=runtime && typeof runtime==='object'
    ? {state:runtime}
    : migrateWorkspaceIfNeeded(userId,module);

  if(alive&&saved?.state&&(typeof restoreRef.current==='function'||(restoreRef.current&&typeof restoreRef.current==='object'))){
    applyModuleRestore(restoreRef.current,saved.state);
    writeRuntimeState(userId,module,saved.state);
  } else if(alive){
    writeRuntimeState(userId,module,stateRef.current);
  }

  queueMicrotask(()=>{
    if(!alive)return;
    hydrationRef.current=persistenceKey;
    pendingRestoreRef.current=false;
    setHydratedKey(persistenceKey);
  });

  const flushBeforeNavigation=()=>{
    clearTimeout(durableTimerRef.current);
    const active=readUser();
    if(!active||String(active.id)!==String(userId))return;
    if(hydrationRef.current===persistenceKey&&!pendingRestoreRef.current){
      const latest=stateRef.current;
      writeRuntimeState(userId,module,latest);
      writeModuleState(userId,module,latest);
    }
  };
  const unregisterCoordinator=registerWorkspaceFlusher(persistenceKey,flushBeforeNavigation);
  if(typeof window!=='undefined'){
    window.__novaWorkspaceFlushers=window.__novaWorkspaceFlushers||new Map();
    window.__novaWorkspaceFlushers.set(persistenceKey,flushBeforeNavigation);
  }
  window.addEventListener('nova:persist-before-navigation',flushBeforeNavigation);
  const flushOnPageExit=()=>flushBeforeNavigation();
  window.addEventListener('pagehide',flushOnPageExit);
  const onVisibility=()=>{
    if(document.visibilityState==='hidden')flushBeforeNavigation();
  };
  document.addEventListener('visibilitychange',onVisibility);

  return()=>{
    clearTimeout(durableTimerRef.current);
    window.removeEventListener('nova:persist-before-navigation',flushBeforeNavigation);
    window.removeEventListener('pagehide',flushOnPageExit);
    document.removeEventListener('visibilitychange',onVisibility);
    unregisterCoordinator();
    if(typeof window!=='undefined'&&window.__novaWorkspaceFlushers)window.__novaWorkspaceFlushers.delete(persistenceKey);
    alive=false;
    pendingRestoreRef.current=false;
    const active=readUser();
    if(!active||String(active.id)!==String(userId))return;
    const latest=stateRef.current;
    writeRuntimeState(userId,module,latest);
    if(hydrationRef.current===persistenceKey)writeModuleState(userId,module,latest);
  };
 },[persistenceKey,userId,module]);

 useLayoutEffect(()=>{
  if(hydratedKey!==persistenceKey||hydrationRef.current!==persistenceKey||pendingRestoreRef.current)return;
  const active=readUser();
  if(!active||String(active.id)!==String(userId))return;
  stateRef.current=state;
  writeRuntimeState(userId,module,state);
  clearTimeout(durableTimerRef.current);
  durableTimerRef.current=setTimeout(()=>{
    const cur=readUser();
    if(!cur||String(cur.id)!==String(userId))return;
    if(hydrationRef.current===persistenceKey&&!pendingRestoreRef.current){
      writeModuleState(userId,module,stateRef.current);
    }
  },1200);
 },[hydratedKey,persistenceKey,userId,module,stateSignature]);

 useEffect(()=>{
  if(hydratedKey!==persistenceKey)return;
  return subscribeWorkspace(userId,module,(envelope)=>{
    if(envelope?.state&&hydrationRef.current===persistenceKey&&(typeof restoreRef.current==='function'||(restoreRef.current&&typeof restoreRef.current==='object'))){
      pendingRestoreRef.current=true;
      writeRuntimeState(userId,module,envelope.state);
      applyModuleRestore(restoreRef.current,envelope.state);
      queueMicrotask(()=>{pendingRestoreRef.current=false});
    }
  });
 },[hydratedKey,persistenceKey,userId,module]);
}


// V70.43: notifications are user-clearable; learning activities remain session-based, while actual learning data
// (Knowledge Hub documents/notes, server progress, quiz history and AI Chat
// conversations) remains durable. A new app session must never reopen an
// unfinished AI Teacher/quiz/exam/editor state from the previous session.
const TRANSIENT_SESSION_MODULES=[
 'learning-studio',
 'practice.ui',
 'practice.quiz',
 'practice.codeLab',
 'practice.dppIde',
 'exam',
 'interview',
 'adaptive-coach',
 'adaptive-session',
 'nova-brain',
 'tutor-memory',
 'voice-tutor-memory'
];
const resetTransientLearningState=(userId)=>{
 if(!userId)return;
 TRANSIENT_SESSION_MODULES.forEach(module=>{
  try{removeRuntimeState(userId,module)}catch{}
  try{removeWorkspace(userId,module)}catch{}
 });
 try{
  localStorage.removeItem('nova_ai_prefill');
  localStorage.removeItem(`nova_tutor_memory_${userId}`);
  localStorage.removeItem(`nova_voice_tutor_memory_${userId}`);
 }catch{}
};
const initializeFreshAppSession=()=>{
 if(typeof window==='undefined'||!window.sessionStorage)return;
 let isNew=false;
 try{
  isNew=!window.sessionStorage.getItem('nova_app_session_marker');
  if(isNew)window.sessionStorage.setItem('nova_app_session_marker',`${Date.now()}_${Math.random().toString(36).slice(2)}`);
 }catch{return;}
 if(!isNew)return;
 const current=readUser();
 if(current?.id){
  resetTransientLearningState(current.id);
  try{localStorage.removeItem('nova_nav_stack');localStorage.setItem('nova_page','dashboard')}catch{}
 }
};
initializeFreshAppSession();
const AI_LANGUAGE_KEY='nova_ai_language';
const AI_LANGUAGES=['English/Hinglish','English','Hindi','Hinglish','Bengali','Tamil','Telugu','Marathi','Gujarati','Kannada','Malayalam','Punjabi','Urdu','Spanish','French'];
const getAiLanguage=()=>localStorage.getItem(AI_LANGUAGE_KEY)||'English';
const getSpeechLanguage=()=>({Hindi:'hi-IN',Bengali:'bn-IN',Tamil:'ta-IN',Telugu:'te-IN',Marathi:'mr-IN',Gujarati:'gu-IN',Kannada:'kn-IN',Malayalam:'ml-IN',Punjabi:'pa-IN',Urdu:'ur-IN',Spanish:'es-ES',French:'fr-FR',English:'en-IN',Hinglish:'en-IN'}[getAiLanguage()]||'en-IN');
const getVoiceTutorLanguage=()=>{
 const lang=getAiLanguage();
 if(lang==='Hindi'||lang==='Hinglish')return 'hi-IN';
 return ({Bengali:'bn-IN',Tamil:'ta-IN',Telugu:'te-IN',Marathi:'mr-IN',Gujarati:'gu-IN',Kannada:'kn-IN',Malayalam:'ml-IN',Punjabi:'pa-IN',Urdu:'ur-IN',Spanish:'es-ES',French:'fr-FR'}[lang]||'en-IN');
};
const getBestNaturalVoice=(targetLang=getVoiceTutorLanguage())=>{
 if(typeof window==='undefined'||!window.speechSynthesis)return null;
 const voices=window.speechSynthesis.getVoices()||[];
 if(!voices.length)return null;
 const prefix=String(targetLang||'en-IN').toLowerCase().slice(0,2);
 const isTarget=v=>String(v.lang||'').toLowerCase().startsWith(prefix);
 const indianRegex=/(rishi|veena|neerja|swara|kavya|heera|prabhat|madhur|google\s*(?:en-in|hi-in|hindi)|india)/i;
 const indianVoice=voices.find(v=>(isTarget(v)||/en-IN|hi-IN/i.test(v.lang))&&indianRegex.test(v.name));
 if(indianVoice)return indianVoice;
 const exact=voices.find(v=>String(v.lang||'').toLowerCase()===String(targetLang).toLowerCase());
 if(exact)return exact;
 const langMatch=voices.find(isTarget);
 if(langMatch)return langMatch;
 const premiumNames=/(natural|neural|premium|enhanced|samantha|ava|victoria|serena|jenny|google\s*(?:uk|us)\s*english)/i;
 const premiumVoice=voices.find(v=>/^en-/i.test(v.lang)&&premiumNames.test(v.name));
 if(premiumVoice)return premiumVoice;
 return voices.find(v=>/^en-/i.test(v.lang))||voices.find(v=>v.default)||voices[0]||null;
};

const tutorMemoryKey=(userId)=>`nova_tutor_memory_${userId||'guest'}`;
const tutorMemoryFallback={topic:'',message:'',answer:'',feedback:'',studentAnswer:'',answerSubmitted:false,history:[],contextKey:''};
// V70.27: tutor memory now uses the same central runtime source as the hard
// learning modules. localStorage remains a compatibility/recovery mirror.
const readTutorMemory=(userId)=>{
 try{
  const runtime=readRuntimeState(userId,'tutor-memory',null);
  if(runtime&&typeof runtime==='object')return {...tutorMemoryFallback,...runtime};
 }catch{}
 return readJSON(tutorMemoryKey(userId),tutorMemoryFallback)||tutorMemoryFallback;
};
const saveTutorMemory=(userId,next)=>{try{
 const current=readTutorMemory(userId);
 const merged={...current,...next,updatedAt:new Date().toISOString()};
 writeRuntimeState(userId,'tutor-memory',merged);
 localStorage.setItem(tutorMemoryKey(userId),JSON.stringify(merged));
 window.dispatchEvent(new CustomEvent('nova:tutor-memory-updated',{detail:merged}));
 return merged;
}catch{return null}};
const appendTutorTurn=(userId,role,content,meta={})=>{const current=readTutorMemory(userId);const history=[...(Array.isArray(current.history)?current.history:[]),{role,content,at:new Date().toISOString(),...meta}].slice(-20);return saveTutorMemory(userId,{history})};
const tutorHistoryPrompt=(userId,contextKey='')=>{const all=readTutorMemory(userId).history||[];const scoped=contextKey?all.filter(x=>x.contextKey===contextKey):all;const h=scoped.slice(-6);return h.length?`\n\nPERSISTENT TUTOR CONTEXT FOR THIS LEARNING SESSION (use only as background; answer the CURRENT student request first and never continue an old answer by accident):\n${h.map(x=>`${String(x.role||'').toUpperCase()}: ${String(x.content||'').slice(0,3000)}`).join('\n')}`:''};
const voiceTutorMemoryKey=(userId)=>`nova_voice_tutor_memory_${userId||'guest'}`;
const readVoiceTutorMemory=(userId)=>{try{const runtime=readRuntimeState(userId,'voice-tutor-memory',null);if(runtime&&typeof runtime==='object')return {...tutorMemoryFallback,...runtime};}catch{} return readJSON(voiceTutorMemoryKey(userId),tutorMemoryFallback)||tutorMemoryFallback;};
const saveVoiceTutorMemory=(userId,next)=>{try{const current=readVoiceTutorMemory(userId);const merged={...current,...next,updatedAt:new Date().toISOString()};writeRuntimeState(userId,'voice-tutor-memory',merged);localStorage.setItem(voiceTutorMemoryKey(userId),JSON.stringify(merged));window.dispatchEvent(new CustomEvent('nova:voice-tutor-memory-updated',{detail:merged}));return merged;}catch{return null}};
const appendVoiceTutorTurn=(userId,role,content,meta={})=>{const current=readVoiceTutorMemory(userId);const history=[...(Array.isArray(current.history)?current.history:[]),{role,content,at:new Date().toISOString(),...meta}].slice(-20);return saveVoiceTutorMemory(userId,{history})};

class ErrorBoundary extends React.Component{
 constructor(props){super(props);this.state={error:null,attempt:0}}
 static getDerivedStateFromError(error){return {error}}
 componentDidCatch(error,info){console.error('NovaTutor page error',error,info)}
 retry=()=>{this.setState(s=>({error:null,attempt:s.attempt+1}))}
 goHome=()=>{this.setState(s=>({error:null,attempt:s.attempt+1}));window.location.hash='/dashboard';localStorage.setItem('nova_page','dashboard')}
 render(){if(!this.state.error)return this.props.children;return <div className="page-crash" role="alert"><div className="crash-icon"><RefreshCw size={34}/></div><h2>This section hit a temporary error</h2><p>{this.state.error?.message||'Something went wrong while rendering this section.'}</p><div className="crash-actions"><button className="primary" onClick={this.retry}>Retry section</button><button className="secondary" onClick={this.goHome}>Go to Dashboard</button></div><small>Your account and learning progress are safe. No page reload is required.</small></div>}
}


function DeepLearningIntelligence({user}){
 const [data,setData]=useState(null),[loading,setLoading]=useState(true);
 useEffect(()=>{let alive=true;const load=()=>{setLoading(true);api('/intelligence/'+user.id+'/deep').then(x=>{if(alive)setData(x)}).catch(()=>{if(alive)setData(null)}).finally(()=>alive&&setLoading(false));};load();const on=()=>load();window.addEventListener('nova:learning-updated',on);return()=>{alive=false;window.removeEventListener('nova:learning-updated',on)}},[user?.id]);
 if(loading)return <section className="panel nova-deep-panel"><div className="panel-head"><div><span className="eyebrow">NOVA BRAIN 2.0</span><h3>Building your deeper learning profile…</h3></div><RefreshCw size={19}/></div></section>;
 if(!data)return <section className="panel nova-deep-panel"><div className="panel-head"><div><span className="eyebrow">NOVA BRAIN 2.0</span><h3>Deeper intelligence is warming up</h3><small>Complete a few quiz questions and Nova will build concept signals.</small></div><Brain size={19}/></div></section>;
 const dna=data.dna||{}; const concepts=Array.isArray(data.concepts)?data.concepts.slice(0,12):[]; const nodes=Array.isArray(data.graph?.nodes)?data.graph.nodes.slice(0,14):[]; const mistakes=Array.isArray(data.mistakeDna)?data.mistakeDna.slice(0,5):[];
 const score=v=>Math.max(0,Math.min(100,Number(v)||0));
 return <section className="panel nova-deep-panel"><div className="panel-head"><div><span className="eyebrow">NOVA BRAIN 2.0 • V61</span><h3>{dna.profile||'Your Learning DNA'}</h3><small>{dna.explanation||'Nova combines multiple learning signals.'}</small></div><Brain size={20}/></div>
  <div className="nova-dna-grid">{[['Overall',dna.overall],['Accuracy',dna.accuracy],['Consistency',dna.consistency],['Retention',dna.retention],['Persistence',dna.persistence]].map(([label,value])=><div className="nova-dna-card" key={label}><span>{label}</span><strong>{score(value)}%</strong><small>{label==='Overall'?'combined learner signal':label==='Accuracy'?'question correctness':label==='Consistency'?'28-day activity':label==='Retention'?'repeat-performance signal':'practice follow-through'}</small></div>)}</div>
  <div className="nova-dna-summary"><b>Learning breadth: {score(dna.breadth)}%</b><span>Nova now separates consistency, retention and persistence from raw quiz accuracy.</span></div>
  <div className="nova-deep-two"><div><div className="panel-head"><div><span className="eyebrow">CONCEPT SIGNALS</span><h3>Where your understanding is moving</h3></div><Target size={18}/></div><div className="nova-concept-grid">{concepts.length?concepts.map((c,i)=><div className="nova-concept-row" key={c.subject+c.topic+i}><div><b>{c.topic}</b><small>{c.subject} • {c.state} • {c.trend}</small></div><div className="nova-concept-track"><i style={{width:score(c.mastery)+'%'}}/></div><strong className="nova-concept-score">{score(c.mastery)}%</strong></div>):<div className="empty small"><Brain/><b>No concept-level signals yet</b><span>Complete Smart Quiz questions after V61.</span></div>}</div></div>
   <div><div className="panel-head"><div><span className="eyebrow">MISTAKE DNA</span><h3>Repeated patterns</h3></div><Target size={18}/></div><div className="nova-mistake-dna">{mistakes.length?mistakes.map((m,i)=><article key={m.subject+m.topic+i}><b>{m.topic}</b><small>{m.type} • {m.count} miss{m.count===1?'':'es'} • {m.signal}</small></article>):<div className="empty small"><CheckCircle2/><b>No repeated pattern yet</b><span>Nova will detect recurring misses automatically.</span></div>}</div></div></div>
  <div className="panel-head" style={{marginTop:16}}><div><span className="eyebrow">KNOWLEDGE GRAPH FOUNDATION</span><h3>Your concept path</h3></div><Sparkles size={18}/></div><div className="nova-graph">{nodes.length?nodes.map((n,i)=><span className="nova-graph-node" key={n+i}>{n}</span>):<span className="muted">Concept relationships will appear as more topics are practiced.</span>}</div>
 </section>
}


function NovaCoach({user,go,courses,initialTab='focus'}){
 const [tab,setTab]=useState(initialTab);
 const [data,setData]=useState(null); const [analytics,setAnalytics]=useState(null); const [progress,setProgress]=useState([]); const [loading,setLoading]=useState(true); const [command,setCommand]=useState(''); const [room,setRoom]=useState(()=>readJSON(`nova_study_room_${user?.id||'guest'}`,null)); const [timer,setTimer]=useState(1500); const [running,setRunning]=useState(false); const [confidence,setConfidence]=useState(3); const [notice,setNotice]=useState('');
 useModulePersistence(user?.id,`nova-coach-${initialTab}`,{tab,timer,running,confidence,room},{tab:x=>setTab(x||initialTab),timer:x=>setTimer(Number(x)||1500),running:x=>setRunning(Boolean(x)),confidence:x=>setConfidence(Number(x)||3),room:x=>setRoom(x||null)});
 const cacheKey=`nova_coach_cache_${user?.id||'guest'}`;
 useEffect(()=>{let alive=true; const activeId=String(user.id); setLoading(true); Promise.allSettled([api('/intelligence/'+user.id),api('/analytics/'+user.id),api('/progress/'+user.id)]).then(rs=>{if(!alive)return; const [i,a,p]=rs; const next=i.status==='fulfilled'?i.value:null; setData(next); setAnalytics(a.status==='fulfilled'?a.value:null); setProgress(p.status==='fulfilled'&&Array.isArray(p.value)?p.value:[]); if(next&&String(readUser()?.id||'')===activeId)localStorage.setItem(cacheKey,JSON.stringify({at:Date.now(),data:next,analytics:a.status==='fulfilled'?a.value:null,progress:p.status==='fulfilled'?p.value:[]})); else if(!next) {const cached=readJSON(cacheKey); if(cached){setData(cached.data);setAnalytics(cached.analytics);setProgress(Array.isArray(cached.progress)?cached.progress:[])}} }).finally(()=>alive&&setLoading(false)); return()=>{alive=false}},[user?.id]);
 useEffect(()=>{const fn=()=>{api('/intelligence/'+user.id).then(setData).catch(()=>{});api('/analytics/'+user.id).then(setAnalytics).catch(()=>{});};window.addEventListener('nova:learning-updated',fn);return()=>window.removeEventListener('nova:learning-updated',fn)},[user?.id]);
 useEffect(()=>{if(!running)return;const id=setInterval(()=>setTimer(x=>{if(x<=1){setRunning(false);api('/intelligence/'+user.id+'/events',{method:'POST',body:JSON.stringify({type:'STUDY_SPRINT_COMPLETED',subject:'Nova Focus',topic:'Focus sprint',durationSeconds:1500,details:'Completed a Nova Coach focus sprint.'})}).catch(()=>{});setNotice('Focus sprint complete. Great work — take a short break, then continue the next action.');return 1500}return x-1}),1000);return()=>clearInterval(id)},[running]);
 useEffect(()=>{const onKey=e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();document.getElementById('nova-coach-command')?.focus()} if(e.key==='Escape')setCommand('')};window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey)},[]);
 const mastery=data?.mastery||[]; const weak=data?.weakAreas||[]; const mistakes=data?.mistakePatterns||[]; const rec=data?.recommendations||[]; const events=data?.recentActivity||[];
 const topWeak=mastery.length?mastery[0]:null; const best=mastery.length?mastery[mastery.length-1]:null;
 const todayGoal=Math.max(30,Number(user?.dailyStudyMinutes||60)); const studied=Number(data?.studyMinutes||0); const todayProgress=Math.min(100,Math.round((studied%Math.max(todayGoal,1))/todayGoal*100));
 const fmt=t=>`${String(Math.floor(t/60)).padStart(2,'0')}:${String(t%60).padStart(2,'0')}`;
 const actions=[{id:'revision',label:'Active revision',desc:'Recall due concepts',icon:<RotateCcw size={17}/>,go:'revision'},{id:'teacher',label:'Ask AI Teacher',desc:'Explain your weakest topic',icon:<BrainCircuit size={17}/>,go:'tutor'},{id:'quiz',label:'Adaptive quiz',desc:'Test current mastery',icon:<Target size={17}/>,go:'quiz'},{id:'lecture',label:'Continue learning',desc:'Return to your course',icon:<BookOpen size={17}/>,go:'courses'}];
 const filtered=actions.filter(a=>`${a.label} ${a.desc}`.toLowerCase().includes(command.toLowerCase()));
 const runAction=a=>{setNotice(`${a.label} opened — Nova will carry your current learning context into the next step.`);setTimeout(()=>go(a.go),180)};
 const activityByDay=data?.activityByDay||{}; const heat=Object.keys(activityByDay).sort().slice(-28).map((date,i)=>({i,date,active:Math.min(4,Number(activityByDay[date]||0))})); const heatActive=heat.filter(x=>x.active>0).length; const heatMax=Math.max(0,...heat.map(x=>x.active));
 const masteryColor=v=>v>=80?'good':v>=60?'mid':'bad';
 const forecast=topWeak?Math.max(1,Math.round((100-Math.min(100,Number(topWeak.accuracy||0)))/Math.max(1,Number(data?.studyMinutes||30))*30)):null;
 const learningSignals=[
  {icon:<Target size={17}/>,title:'Smart next action',text:topWeak?`Practice ${topWeak.subject} for 15 min`:'Complete your first learning activity',go:topWeak?'tutor':'courses'},
  {icon:<Code2 size={17}/>,title:'Mistake DNA',text:mistakes.length?`${mistakes[0].label} is recurring`:'No recurring pattern yet',go:'tutor'},
  {icon:<RotateCcw size={17}/>,title:'Memory check',text:`${Math.max(0,weak.length)} priority reviews`,go:'revision'},
  {icon:<BarChart3 size={17}/>,title:'Weekly momentum',text:`${data?.streak||0}-day learning streak`,go:'analytics'},
  {icon:<Clock3 size={17}/>,title:'Goal forecast',text:forecast?`~${forecast} focused days to close the current gap`:'Practice a weak topic to unlock a personalised forecast',go:'notifications'},
  {icon:<Mic size={17}/>,title:'Voice coaching',text:'Talk through a difficult concept',go:'voice'}
 ];
 return <>
  <div className="page-title nova-coach-title"><span className="eyebrow">NOVA COACH • PERSONAL LEARNING SYSTEM</span><h1>Your <span>Learning Command Center.</span></h1><p>One place for focus, mastery, revision, AI teaching and the next best action.</p></div>
  <section className="nova-command panel">
   <div className="nova-command-main"><div className="nova-orb"><Sparkles size={22}/></div><div><span className="eyebrow">NEXT BEST ACTION</span><h2>{topWeak?`Fix ${topWeak.subject} before moving on.`:'Build your first learning signal.'}</h2><p>{topWeak?`${topWeak.accuracy}% recent mastery • ${topWeak.trend} trend. Nova recommends a focused 15-minute recovery session.`:'Complete a lesson or practice set and Nova will start personalizing your plan.'}</p></div></div>
   <div className="nova-command-actions"><button className="primary" onClick={()=>runAction(actions[0])}>Start now <ChevronRight size={14}/></button><button className="secondary" onClick={()=>setTab('mastery')}>Why this?</button></div>
  </section>
  {notice&&<div className="nova-notice" role="status"><CheckCircle2 size={16}/>{notice}<button onClick={()=>setNotice('')}>Dismiss</button></div>}
  <div className="nova-tabs" role="tablist">{[['focus','Focus'],['mastery','Mastery'],['revision','Revision'],['ai','AI Tutor'],['analytics','Analytics'],['community','Study Room'],['settings','Experience']].map(([id,label])=><button key={id} className={tab===id?'active':''} onClick={()=>setTab(id)}>{label}</button>)}</div>
  {loading?<section className="nova-skeleton-grid"><div className="panel skeleton-card"/><div className="panel skeleton-card"/><div className="panel skeleton-card"/></section>:<>
  {tab==='focus'&&<section className="nova-grid">
   <div className="panel nova-focus-card"><div className="panel-head"><div><span className="eyebrow">TODAY • {new Date().toLocaleDateString(undefined,{weekday:'long',month:'short',day:'numeric'})}</span><h3>Your plan adapts as you learn</h3></div><Bell size={19}/></div><div className="focus-progress"><div><b>{Math.min(studied,todayGoal)} / {todayGoal} min</b><span>study target</span></div><div className="progress-track"><span style={{width:`${todayProgress}%`}}/></div></div><div className="nova-action-list">{actions.slice(0,4).map(a=><button key={a.id} onClick={()=>runAction(a)}><span className="action-icon">{a.icon}</span><span><b>{a.label}</b><small>{a.desc}</small></span><ChevronRight size={15}/></button>)}</div></div>
   <aside className="panel nova-sprint"><span className="eyebrow">FOCUS SPRINT</span><h3>25-minute deep work</h3><div className="sprint-time">{fmt(timer)}</div><p>Use the sprint for the next recommended action. Nova won't add extra goals while the timer is running.</p><button className={running?'danger-btn':'primary'} onClick={()=>setRunning(x=>!x)}>{running?'Pause sprint':'Start sprint'}</button><div className="confidence"><span>How confident are you?</span><div>{[1,2,3,4,5].map(x=><button key={x} className={confidence===x?'selected':''} onClick={()=>setConfidence(x)} aria-label={`${x} out of 5`}>{x}</button>)}</div></div></aside>
   <div className="panel nova-path"><div className="panel-head"><div><span className="eyebrow">PERSONAL LEARNING PATH</span><h3>Learn in the right order</h3></div><GraduationCap size={19}/></div><div className="path-steps">{(mastery.length?mastery.slice(0,4):[{subject:'Your first topic',accuracy:0,state:'Start',trend:'New'}]).map((m,i)=><div key={m.subject||i} className="path-step"><span>{i+1}</span><div><b>{m.subject}</b><small>{m.state} • {m.trend} • {m.accuracy}%</small></div>{i===0?<em>NOW</em>:i===1?<em>NEXT</em>:<em>QUEUE</em>}</div>)}</div></div>
   <div className="panel nova-heat"><div className="panel-head"><div><span className="eyebrow">CONSISTENCY</span><h3>28-day learning heatmap</h3></div><BarChart3 size={19}/></div><div className="heatmap-head"><span>{heatActive} active days</span><span>{heatMax ? `Peak: ${heatMax} signals` : 'No activity recorded yet'}</span></div><div className="heatmap" aria-label="28 day learning activity">{heat.map(x=><span key={x.i} className={`heat-${x.active}`} title={`${x.date}: ${x.active ? `${x.active} learning signal${x.active===1?'':'s'}` : 'No learning activity'}`} aria-label={`${x.date}: ${x.active} learning signals`}/>)}</div><div className="heatmap-legend"><span>Less</span><i className="heat-0"/><i className="heat-1"/><i className="heat-2"/><i className="heat-3"/><i className="heat-4"/><span>More</span></div><p className="muted">Each square is one real calendar day. Activity is based on saved learning events, not fake placeholder data.</p></div>
   <div className="panel nova-wide nova-signals"><div className="panel-head"><div><span className="eyebrow">NOVA SIGNALS</span><h3>Your learning system, in one view</h3></div><Sparkles size={19}/></div><div className="signal-grid">{learningSignals.map((x,i)=><button key={x.title} className="signal-card" onClick={()=>go(x.go)}><span className="signal-icon">{x.icon}</span><span><b>{x.title}</b><small>{x.text}</small></span><ChevronRight size={14}/></button>)}</div><div className="nova-loop"><span>Learn</span><ChevronRight size={12}/><span>Practice</span><ChevronRight size={12}/><span>Detect</span><ChevronRight size={12}/><span>Explain</span><ChevronRight size={12}/><span>Revise</span><ChevronRight size={12}/><span>Master</span></div></div>
  </section>}
  {tab==='mastery'&&<><DeepLearningIntelligence user={user}/><section className="nova-grid"><div className="panel nova-wide"><div className="panel-head"><div><span className="eyebrow">TOPIC MASTERY</span><h3>What you actually know</h3></div><Brain size={19}/></div><div className="mastery-list">{(mastery.length?mastery:[{subject:'No quiz data yet',accuracy:0,state:'Start',trend:'New'}]).map(m=><article className="mastery-row" key={m.subject}><div className="mastery-name"><b>{m.subject}</b><small>{m.state} • {m.trend}</small></div><div className="mastery-bar"><span className={masteryColor(m.accuracy)} style={{width:`${m.accuracy}%`}}/></div><strong>{m.accuracy}%</strong></article>)}</div></div><aside className="panel nova-insight"><span className="eyebrow">WHY IT MOVED</span><h3>{topWeak?'Recent performance is pulling this topic down.':'Build data to unlock deeper insights.'}</h3><p>{topWeak?`${topWeak.subject} is currently your highest-priority area. Nova weighs recent attempts more heavily than old attempts.`:'Complete quizzes, lessons and practice. Nova will compare recency, difficulty and retention.'}</p><button className="secondary" onClick={()=>go('analytics')}>Open full analytics</button></aside><div className="panel nova-wide"><div className="panel-head"><div><span className="eyebrow">STRENGTHS & GAPS</span><h3>Use your time where it matters</h3></div><Target size={19}/></div><div className="split-insights"><div><b>Strongest</b><strong>{best?.subject||'—'}</strong><small>{best?`${best.accuracy}% mastery`: 'No data yet'}</small></div><div><b>Needs work</b><strong>{topWeak?.subject||'—'}</strong><small>{topWeak?`${topWeak.accuracy}% mastery`: 'No data yet'}</small></div><div><b>Learning rhythm</b><strong>{data?.streak||0} days</strong><small>current streak</small></div></div></div></section></>}
  {tab==='revision'&&<section className="nova-grid"><div className="panel nova-wide"><div className="panel-head"><div><span className="eyebrow">SPACED MEMORY</span><h3>Recall, don't reread</h3></div><RotateCcw size={19}/></div><div className="revision-smart-grid"><div><b>Today</b><strong>{Math.max(0,weak.length)}</strong><small>priority reviews</small></div><div><b>Tomorrow</b><strong>{data?.lessons?Math.max(1,Math.ceil(data.lessons/3)):0}</strong><small>memory checks</small></div><div><b>This week</b><strong>{data?.quizzes?Math.max(3,Math.min(14,data.quizzes+3)):0}</strong><small>active recall prompts</small></div></div><div className="recall-flow"><span>1. Recall</span><ChevronRight size={14}/><span>2. Mini question</span><ChevronRight size={14}/><span>3. Apply</span><ChevronRight size={14}/><span>4. Re-test</span></div><button className="primary" onClick={()=>go('revision')}>Start revision queue <ChevronRight size={14}/></button></div><aside className="panel nova-insight"><span className="eyebrow">CONFIDENCE CHECK</span><h3>{confidence>=4?'You feel confident — verify it with a question.':'Use a quick recall question before reopening notes.'}</h3><p>Your confidence rating is {confidence}/5. Nova can compare this later with actual recall accuracy.</p><button className="secondary" onClick={()=>go('flashcards')}>Open active recall</button></aside><div className="panel nova-wide"><div className="panel-head"><div><span className="eyebrow">REVISION CALENDAR</span><h3>Spaced review rhythm</h3></div><CalendarDays size={19}/></div><div className="revision-calendar">{['Today','Tomorrow','In 3 days','In 7 days','In 14 days'].map((x,i)=><div key={x} className={i===0?'due':''}><b>{x}</b><span>{i===0?weak.length:(data?.lessons?Math.max(1,Math.round(data.lessons/(i+2))):0)}</span><small>reviews</small></div>)}</div></div></section>}
  {tab==='ai'&&<section className="nova-grid"><div className="panel nova-wide"><div className="panel-head"><div><span className="eyebrow">CONTEXT-AWARE TEACHING</span><h3>Tell Nova how to teach you</h3></div><BrainCircuit size={19}/></div><div className="ai-mode-grid">{[['Level','Explain at my current mastery'],['Style','Step-by-step + practical examples'],['Method','Socratic questions before direct answers'],['Follow-up','Always finish with a mini question']].map(x=><div key={x[0]}><b>{x[0]}</b><span>{x[1]}</span></div>)}</div><p className="muted">When you open AI Teacher, Nova can use your current weak topic, recent mistakes, goal and revision state as teaching context.</p><div className="nova-quick-buttons"><button className="primary" onClick={()=>go('tutor')}>Open AI Teacher</button><button className="secondary" onClick={()=>go('voice')}>Voice Tutor</button><button className="secondary" onClick={()=>go('chat')}>AI Chat</button></div></div><aside className="panel nova-insight"><span className="eyebrow">SESSION WRAP</span><h3>Every session should end with a next step.</h3><p>Nova can turn the session into: learned → mistakes → mini question → next revision date.</p><button className="secondary" onClick={()=>go('notifications')}>Add to Today</button></aside></section>}
  {tab==='analytics'&&<section className="nova-grid"><div className="panel nova-wide"><div className="panel-head"><div><span className="eyebrow">ACTIONABLE ANALYTICS</span><h3>What changed and what to do next</h3></div><BarChart3 size={19}/></div><div className="analytics-kpis"><div><b>{analytics?.overallProgress?Math.round(analytics.overallProgress):0}%</b><span>course progress</span></div><div><b>{analytics?.xp||data?.xp||0}</b><span>learning XP</span></div><div><b>{analytics?.level||1}</b><span>learning level</span></div><div><b>{data?.studyMinutes||0}m</b><span>tracked study</span></div></div><div className="actionable-list">{rec.slice(0,4).map(r=><button key={r.title} onClick={()=>go(r.target||'dashboard')}><div><b>{r.title}</b><small>{r.description}</small></div><span>{r.action||'Open'} <ChevronRight size={13}/></span></button>)}</div><button className="secondary" onClick={()=>go('analytics')}>Open detailed analytics</button></div><aside className="panel nova-insight"><span className="eyebrow">EFFICIENCY</span><h3>{data?.quizzes?`${Math.round((data.quizzes/(Math.max(1,data.studyMinutes)))*60)} quiz attempts per study hour`:'Build enough activity to estimate efficiency.'}</h3><p>Nova compares time, practice and improvement instead of rewarding raw screen time.</p></aside></section>}
  {tab==='community'&&<section className="nova-grid"><div className="panel nova-wide"><div className="panel-head"><div><span className="eyebrow">STUDY ROOM</span><h3>Focused study session</h3></div><MessageCircle size={19}/></div>{!room?<><div className="room-explainer"><div><b>What happens when you join?</b><p>Nova creates a focused study session for you. You choose a goal, start a timer and track the tasks you finish. This version does <strong>not</strong> pretend there are live members or shared progress unless a real room service is connected.</p></div><ul><li>Choose one clear study goal.</li><li>Start a 25-minute focus timer.</li><li>Complete and check off your session tasks.</li><li>Leave the room when you are done.</li></ul></div><div className="room-join-controls"><label>SESSION GOAL<select id="study-room-goal"><option>Finish one lesson</option><option>Revise a weak topic</option><option>Solve a practice set</option><option>Prepare for an exam</option></select></label><button className="primary" onClick={()=>{const next={goal:document.getElementById('study-room-goal')?.value||'Finish one lesson',tasks:[{text:'Define the session outcome',done:false},{text:'Complete the focused study task',done:false},{text:'Do a quick recall check',done:false}]};setRoom(next);localStorage.setItem(`nova_study_room_${user?.id||'guest'}`,JSON.stringify(next));setTimer(1500);setRunning(true);setNotice('Study room started. Your 25-minute focus session is running.')}}>Join study room <Clock3 size={15}/></button></div></>:<div className="room-active"><div className="room-active-head"><div><span className="eyebrow">ACTIVE SESSION</span><h3>{room.goal}</h3><p>Personal focus room • no fake member or progress data</p></div><div className="room-session-timer">{fmt(timer)}</div></div><div className="room-task-list">{room.tasks.map((task,i)=><label key={i} className={task.done?'done':''}><input type="checkbox" checked={task.done} onChange={()=>{const tasks=room.tasks.map((x,j)=>j===i?{...x,done:!x.done}:x);const next={...room,tasks};setRoom(next);localStorage.setItem(`nova_study_room_${user?.id||'guest'}`,JSON.stringify(next));}}/><span>{task.text}</span></label>)}</div><div className="room-active-actions"><button className={running?'danger-btn':'primary'} onClick={()=>setRunning(x=>!x)}>{running?'Pause timer':'Resume timer'}</button><button className="secondary" onClick={()=>{setRunning(false);setRoom(null);localStorage.removeItem(`nova_study_room_${user?.id||'guest'}`);setTimer(1500);setNotice('Study room session ended. Your checked tasks were kept only for this session.')}}>Leave room</button></div></div>}<div className="room-tools"><button onClick={()=>go('revision')}><RotateCcw size={16}/><span>Open revision queue</span></button><button onClick={()=>go('community')}><MessageCircle size={16}/><span>Open real community</span></button><button onClick={()=>go('tutor')}><BrainCircuit size={16}/><span>Ask AI Teacher</span></button></div></div><aside className="panel nova-insight nova-wide"><span className="eyebrow">TRANSPARENT STATUS</span><h3>{room?'Your study room is active.':'No room is active.'}</h3><p>{room?'This session contains only real data created by your current session. No invented members, completion counts or fake live activity are shown.':'The current Study Room module is a personal focus-room experience. Live multi-user rooms are not claimed until a real room backend is implemented.'}</p></aside></section>}
  {tab==='settings'&&<section className="nova-grid"><div className="panel nova-wide"><div className="panel-head"><div><span className="eyebrow">EXPERIENCE</span><h3>Quick controls & shortcuts</h3></div><WandSparkles size={19}/></div><div className="experience-grid"><div><b>⌘ / Ctrl + K</b><span>Focus the Nova command search.</span></div><div><b>Esc</b><span>Close command search / temporary UI.</span></div><div><b>Dark / Light</b><span>Uses the existing app theme system.</span></div><div><b>Safe refresh</b><span>Learning updates trigger focused data refreshes.</span></div></div><label className="nova-command-label">QUICK ACTION SEARCH<input id="nova-coach-command" value={command} onChange={e=>setCommand(e.target.value)} placeholder="Try: revision, teacher…"/></label><div className="command-results">{filtered.map(a=><button key={a.id} onClick={()=>runAction(a)}>{a.icon}<span><b>{a.label}</b><small>{a.desc}</small></span><ChevronRight size={14}/></button>)}{!filtered.length&&<span className="muted">No matching action.</span>}</div></div></section>}
  </>}
 </>;
}

function CareerHub({user,go}){
 const goals=[
  {id:'backend',name:'Backend Developer',desc:'Java, Spring Boot, SQL, REST APIs and system fundamentals.',skills:['Java','Spring Boot','SQL','REST API','DSA','System Design']},
  {id:'fullstack',name:'Full Stack Developer',desc:'Build complete web applications from UI to backend.',skills:['HTML/CSS','JavaScript','React','REST API','SQL','DSA']},
  {id:'dsa',name:'DSA / Placement',desc:'Sharpen problem solving for coding rounds and placements.',skills:['Arrays','Strings','Linked Lists','Trees','Graphs','DP']},
  {id:'gate',name:'GATE CSE',desc:'Structured preparation for the GATE CSE exam.',skills:['DSA','DBMS','OS','CN','COA','TOC']}
 ];
 const [goal,setGoal]=useState(()=>localStorage.getItem('nova_career_goal')||'backend');
 const [data,setData]=useState(null); const [busy,setBusy]=useState(false); const [message,setMessage]=useState(''); const [savedAt,setSavedAt]=useState(()=>localStorage.getItem('nova_career_saved_at')||''); const [showLoop,setShowLoop]=useState(false);
 useModulePersistence(user?.id,'career',{goal,savedAt,showLoop},{goal:x=>setGoal(x||'backend'),savedAt:x=>setSavedAt(x||''),showLoop:x=>setShowLoop(Boolean(x))});
 const selected=goals.find(g=>g.id===goal)||goals[0];
 useEffect(()=>{localStorage.setItem('nova_career_goal',goal)},[goal]);
 useEffect(()=>{if(user?.id)api('/intelligence/'+user.id).then(setData).catch(()=>setData(null))},[user?.id]);
 const weak=(data?.weakAreas||[]).map(x=>String(x.subject||x.topic||'').toLowerCase());
 const profile=(user?.weaknesses||'').toLowerCase();
 const skillState=(skill,i)=>{const hit=weak.some(w=>w&&skill.toLowerCase().includes(w)||w.includes(skill.toLowerCase())); if(hit)return 'Needs work'; if(i<2)return 'Priority'; return 'Build';};
 const score=Math.max(0,Math.min(100,Math.round((data?.streak||0)*2+(data?.quizzes||0)*1.5-(data?.weakAreas?.length||0)*3)));
 const checklist=[
  ['Build 2 portfolio projects','Create projects that prove the skills you are learning.'],
  ['Practice coding regularly','Use Code Lab and the Course IDE for daily practice.'],
  ['Practice interviews','Run AI Interviewer sessions and review weak answers.'],
  ['Close your skill gaps','Follow the recommended skills below before applying.']
 ];
 function saveGoal(){setBusy(true);const now=new Date().toLocaleString();localStorage.setItem('nova_career_goal',goal);localStorage.setItem('nova_career_saved_at',now);setSavedAt(now);setMessage('Career target saved. Nova will use it in your next recommendations.');setTimeout(()=>setBusy(false),500)}
 return <>
  <div className="page-title"><span className="eyebrow">CAREER INTELLIGENCE</span><h1>Your <span>Career Hub.</span></h1><p>Turn your learning activity into a practical roadmap for internships, placements or exam goals.</p></div>
  <section className="career-hero panel">
   <div className="career-hero-copy">
    <span className="career-hero-mark" aria-hidden="true">{selected.name.slice(0,1)}</span>
    <span className="eyebrow">TARGET ROLE / EXAM</span>
    <h2>{selected.name}</h2>
    <p>{selected.desc}</p>
    <div className="career-actions"><button className="primary" onClick={()=>go(goal==='gate'?'gatecse':goal==='dsa'?'dsa':'code')}>Start skill practice <ChevronRight size={15}/></button><button className="secondary" onClick={()=>go('interview')}>Practice interview</button></div>
   </div>
   <aside className="career-hero-side">
    <div className="career-score"><div className="score-ring" style={{'--score':score}}><b>{score}</b><span>/100</span></div><small>Career readiness</small><span className="career-score-basis">Weighted from your own quiz, streak and weak-area signals.</span></div>
    <div className="career-rail">{[['quizzes','Quizzes completed'],['streak','Day streak'],['weakAreas','Focus areas']].map(([field,label])=>{const value=data?(Array.isArray(data[field])?data[field].length:(data[field]??0)):'—';return <div key={field}><b>{value}</b><span>{label}</span></div>})}</div>
   </aside>
  </section>
  <section className="career-grid">
   <div className="panel career-target"><div className="panel-head"><div><span className="eyebrow">CHOOSE YOUR PATH</span><h3>What are you preparing for?</h3></div><Trophy size={20}/></div><div className="career-goals">{goals.map(g=><button key={g.id} className={goal===g.id?'career-goal active':'career-goal'} onClick={()=>setGoal(g.id)}><b>{g.name}</b><span>{g.desc}</span></button>)}</div><button className="primary career-save" onClick={saveGoal} disabled={busy}>{busy?'Saving…':'Save career target'} <CheckCircle2 size={14}/></button>{message&&<div className="career-message">{message}</div>}{savedAt&&<div className="career-saved-data"><b>Saved career target: {selected.name}</b><span>Last updated: {savedAt}</span></div>}</div>
   <div className="panel"><div className="panel-head"><div><span className="eyebrow">SKILL GAP</span><h3>What to build next</h3></div><BarChart3 size={20}/></div><div className="career-skills">{selected.skills.map((skill,i)=><div className="career-skill" key={skill}><div><b>{skill}</b><small>{skillState(skill,i)}</small></div><span className={'skill-dot '+(skillState(skill,i)==='Needs work'?'weak':'')}></span></div>)}</div><div className="career-note"><Lightbulb size={16}/><span>{profile?`Nova is also watching the weaknesses in your profile while building this roadmap.`:'Keep completing quizzes and practice so Nova can make this skill gap more precise.'}</span></div></div>
  </section>
  <section className={'panel career-plan '+(showLoop?'is-open':'')} onClick={()=>setShowLoop(true)} role="button" tabIndex={0} onKeyDown={e=>{if(e.key==='Enter'||e.key===' ')setShowLoop(true)}}><div className="panel-head"><div><span className="eyebrow">YOUR NEXT STEPS</span><h3>Placement-ready learning loop</h3><small>Click to open your actionable placement plan</small></div><Sparkles size={20}/></div><div className="career-step-grid">{checklist.map((x,i)=><div className="career-step" key={x[0]}><div className="step-number">{i+1}</div><div><b>{x[0]}</b><p>{x[1]}</p></div></div>)}</div>{showLoop&&<div className="career-loop-actions" onClick={e=>e.stopPropagation()}><div className="career-loop-note"><b>Your next 4 actions</b><span>Follow the loop in order. Nova will keep your existing learning data and adapt recommendations as you practice.</span></div><div className="career-loop-buttons"><button className="primary" onClick={()=>go('dpp')}><Target size={14}/> Start DPP</button><button className="secondary" onClick={()=>go('code')}><Code2 size={14}/> Open Code Lab</button><button className="secondary" onClick={()=>go('interview')}><UserRound size={14}/> Practice Interview</button><button className="secondary" onClick={()=>setShowLoop(false)}>Close</button></div></div>}</section>
  <section className="career-quick"><button onClick={()=>go('dpp')}><Target/><div><b>Today's DPP</b><span>Practice your current course skills.</span></div><ChevronRight/></button><button onClick={()=>go('code')}><Code2/><div><b>Code Lab</b><span>Build and debug real coding tasks.</span></div><ChevronRight/></button><button onClick={()=>go('interview')}><UserRound/><div><b>AI Interviewer</b><span>Practice technical and HR rounds.</span></div><ChevronRight/></button></section>
 </>;
}



function RevisionCenter({user,go}){
 const [data,setData]=useState(null); const [done,setDone]=useState(()=>readJSON(`nova_revision_done_${user?.id||'guest'}`,{}));
 useModulePersistence(user?.id,'revision',{done},{done:x=>setDone(x&&typeof x==='object'?x:{})});
 useEffect(()=>{if(user?.id)api('/intelligence/'+user.id).then(setData).catch(()=>setData({}));},[user?.id]);
 const weak=(data?.weakAreas||[]).slice(0,5); const recs=(data?.recommendations||[]).slice(0,4);
 const queue=[...weak.map((w,i)=>({id:`weak-${i}`,title:w.topic||w.subject||'Core concept',meta:`${w.accuracy||0}% accuracy • focused review`,desc:w.reason||'Review this concept before your next practice session.',target:'tutor'})),...recs.map((r,i)=>({id:`rec-${i}`,title:r.title||'Recommended review',meta:r.action||'Next best action',desc:r.description||'Nova recommends a short revision session.',target:r.target||'tutor'}))].filter((x,i,a)=>a.findIndex(y=>y.id===x.id)===i).slice(0,6);
 const toggle=id=>{const n={...done,[id]:!done[id]};setDone(n);localStorage.setItem(`nova_revision_done_${user?.id||'guest'}`,JSON.stringify(n));};
 return <><div className="page-title"><span className="eyebrow">MEMORY • RETENTION</span><h1>Your <span>Revision Queue.</span></h1><p>NovaTutor turns weak areas and recent learning signals into focused review sessions.</p></div><section className="revision-hero panel"><div><span className="eyebrow">REVIEW NOW</span><h2>Don't just learn it. <span>Remember it.</span></h2><p>Start with the concepts Nova thinks need attention, then reinforce them with AI Teacher or practice.</p></div><div className="revision-ring"><b>{queue.filter(x=>!done[x.id]).length}</b><small>items due</small></div></section><section className="revision-grid"><div className="panel"><div className="panel-head"><div><span className="eyebrow">DUE TODAY</span><h3>Focused revision</h3></div><RefreshCw size={19}/></div>{!queue.length?<div className="empty"><CheckCircle2 size={38}/><b>No urgent revision yet.</b><span>Keep learning. Nova will add review items as your activity creates useful signals.</span><button className="secondary" onClick={()=>go('tutor')}>Ask AI Teacher</button></div>:<div className="revision-list">{queue.map((x,i)=><article className={'revision-item '+(done[x.id]?'done':'')} key={x.id}><button className="revision-check" onClick={()=>toggle(x.id)} aria-label="Mark revision complete">{done[x.id]?'✓':i+1}</button><div><b>{x.title}</b><small>{x.meta}</small><p>{x.desc}</p><div className="revision-actions"><button className="primary" onClick={()=>go(x.target)}>Start review <ChevronRight size={13}/></button><button className="text-btn" onClick={()=>toggle(x.id)}>{done[x.id]?'Reopen':'Mark reviewed'}</button></div></div></article>)}</div>}</div><aside className="panel revision-side"><span className="eyebrow">RETENTION LOOP</span><h3>How Nova revises with you</h3><div className="revision-loop"><div><b>01</b><span>Detect a weak or aging concept</span></div><div><b>02</b><span>Explain it again with AI Teacher</span></div><div><b>03</b><span>Practice and answer a mini question</span></div><div><b>04</b><span>Return later until the concept sticks</span></div></div></aside></section></>;
}

function Achievements({user,go}){
 const [data,setData]=useState({}); useEffect(()=>{if(user?.id)api('/intelligence/'+user.id).then(setData).catch(()=>{});},[user?.id]);
 const stats={streak:Number(data.streak||0),events:Number(data.learningEvents||0),quizzes:Number(data.quizzes||0),minutes:Number(data.studyMinutes||0)};
 const badges=[
  {id:'first',icon:'🌱',title:'First Step',desc:'Complete your first learning activity.',ok:stats.events>=1},
  {id:'streak3',icon:'🔥',title:'3-Day Momentum',desc:'Build a 3-day learning streak.',ok:stats.streak>=3},
  {id:'streak7',icon:'⚡',title:'7-Day Focus',desc:'Keep learning for 7 days.',ok:stats.streak>=7},
  {id:'quiz10',icon:'🧠',title:'Practice Mindset',desc:'Complete 10 quiz attempts.',ok:stats.quizzes>=10},
  {id:'time60',icon:'⏱️',title:'Deep Work',desc:'Reach 60 study minutes.',ok:stats.minutes>=60},
  {id:'time300',icon:'🏆',title:'Serious Learner',desc:'Reach 5 hours of study time.',ok:stats.minutes>=300}
 ];
 return <><div className="page-title"><span className="eyebrow">MILESTONES • PROGRESS</span><h1>Your <span>Achievements.</span></h1><p>Professional milestones that reflect real learning activity — not vanity points.</p></div><section className="achievement-stats"><div className="panel"><b>{stats.streak}</b><span>day streak</span></div><div className="panel"><b>{stats.events}</b><span>learning events</span></div><div className="panel"><b>{stats.quizzes}</b><span>quiz attempts</span></div><div className="panel"><b>{stats.minutes}</b><span>study minutes</span></div></section><section className="panel achievements-panel"><div className="panel-head"><div><span className="eyebrow">YOUR MILESTONES</span><h3>Progress you can feel</h3></div><Trophy size={20}/></div><div className="achievement-grid">{badges.map(b=><article className={'achievement-card '+(b.ok?'earned':'')} key={b.id}><div className="achievement-icon">{b.icon}</div><div><b>{b.title}</b><p>{b.desc}</p><small>{b.ok?'✓ Earned':'Keep learning to unlock'}</small></div></article>)}</div></section><section className="panel achievement-next"><div><span className="eyebrow">NEXT BEST ACTION</span><h3>{stats.streak<3?'Build your 3-day streak.':stats.quizzes<10?'Complete more practice quizzes.':'Keep your learning rhythm strong.'}</h3><p>Nova uses these milestones alongside your actual learning activity to keep recommendations meaningful.</p></div><button className="primary" onClick={()=>go('notifications')}>Open today's plan <ChevronRight size={14}/></button></section></>;
}

function CommunityHub({user,go}){
 const [tab,setTab]=useState('feed');
 const [completed,setCompleted]=useState(()=>readJSON(`nova_challenges_${user?.id||'guest'}`,[])); const [activeChallenge,setActiveChallenge]=useState(null); const [challengeIndex,setChallengeIndex]=useState(0); const [challengeScore,setChallengeScore]=useState(0); const [challengeAnswer,setChallengeAnswer]=useState(null);
 const [post,setPost]=useState('');
 useModulePersistence(user?.id,'community',{tab,completed,activeChallenge,challengeIndex,challengeScore,challengeAnswer,post},{tab:x=>setTab(x||'feed'),completed:x=>setCompleted(Array.isArray(x)?x:[]),activeChallenge:x=>setActiveChallenge(x||null),challengeIndex:x=>setChallengeIndex(Number(x)||0),challengeScore:x=>setChallengeScore(Number(x)||0),challengeAnswer:x=>setChallengeAnswer(x||null),post:x=>setPost(x||'')});
 const [posts,setPosts]=useState([]); const [feedLoading,setFeedLoading]=useState(true); const [notice,setNotice]=useState('');
 const [realLeaderboard,setRealLeaderboard]=useState([]); const [leaderboardLoading,setLeaderboardLoading]=useState(false);
 const challengePools={
  c1:[{q:'What is the time complexity of binary search on a sorted array?',o:['O(1)','O(log n)','O(n)','O(n log n)'],a:1},{q:'Which data structure follows LIFO?',o:['Queue','Stack','Heap','Graph'],a:1},{q:'What is the worst-case time complexity of linear search?',o:['O(log n)','O(1)','O(n)','O(n log n)'],a:2},{q:'Which traversal of a BST visits keys in sorted order?',o:['Preorder','Postorder','Inorder','Level order'],a:2},{q:'Which technique is commonly used to detect a cycle in a linked list?',o:['Binary search','Two pointers','Prefix sum','Greedy'],a:1},{q:'What is the average lookup complexity of a well-designed hash table?',o:['O(1)','O(log n)','O(n)','O(n²)'],a:0}],
  c2:[{q:'Which normal form removes partial dependency on a composite key?',o:['1NF','2NF','3NF','BCNF'],a:1},{q:'Which SQL command removes rows while keeping the table structure?',o:['DROP','TRUNCATE','DELETE','ALTER'],a:2},{q:'A primary key must be:',o:['Nullable','Unique and non-null','Only indexed','A foreign key'],a:1},{q:'Which join returns matching rows from both tables?',o:['INNER JOIN','LEFT JOIN','FULL JOIN','CROSS JOIN'],a:0},{q:'Which property means a transaction is all-or-nothing?',o:['Consistency','Isolation','Atomicity','Durability'],a:2},{q:'Which index structure is commonly used for range queries?',o:['B-tree','Stack','Queue','Bitmap only'],a:0}],
  c3:[{q:'Which keyword prevents a Java method from being overridden?',o:['static','final','private only','volatile'],a:1},{q:'Which collection does not allow duplicate elements?',o:['List','Set','Queue','ArrayList'],a:1},{q:'What does a NullPointerException commonly indicate?',o:['Invalid SQL','Dereferencing null','Syntax error','Out of memory only'],a:1},{q:'Which interface is used for natural ordering?',o:['Runnable','Comparable','Serializable','Cloneable'],a:1},{q:'Which keyword is used to inherit from a class?',o:['implements','extends','inherits','super'],a:1},{q:'Which is preferred for immutable string values in Java?',o:['String','StringBuilder only','char[] always','Object'],a:0}],
  c4:[{q:'Which clause filters rows before grouping?',o:['HAVING','WHERE','ORDER BY','GROUP BY'],a:1},{q:'Which function returns the number of rows?',o:['SUM','COUNT','AVG','TOTAL'],a:1},{q:'Which clause groups rows with the same values?',o:['GROUP BY','ORDER BY','WHERE','JOIN'],a:0},{q:'Which constraint enforces uniqueness?',o:['UNIQUE','DEFAULT','CHECK only','INDEX only'],a:0},{q:'Which command changes table structure?',o:['SELECT','ALTER','INSERT','COMMIT'],a:1},{q:'Which keyword sorts query results?',o:['SORT','ORDER BY','GROUP','RANK'],a:1}]
 };
 const challenges=[{id:'c1',title:'10-Minute DSA Sprint',meta:'6 questions • Arrays & Trees'},{id:'c2',title:'GATE Concept Rush',meta:'6 questions • DBMS'},{id:'c3',title:'Java Debug Battle',meta:'6 questions • Java'},{id:'c4',title:'SQL Speed Round',meta:'6 questions • SQL'}];
 const loadPosts=()=>{setFeedLoading(true);api('/community/posts').then(rows=>setPosts(Array.isArray(rows)?rows:[])).catch(()=>setPosts([])).finally(()=>setFeedLoading(false))};
 useEffect(()=>{loadPosts()},[]);
 useEffect(()=>{if(tab!=='leaderboard')return;let alive=true;setLeaderboardLoading(true);api('/users/leaderboard').then(rows=>{if(alive)setRealLeaderboard(Array.isArray(rows)?rows:[])}).catch(()=>{if(alive)setRealLeaderboard([])}).finally(()=>{if(alive)setLeaderboardLoading(false)});return()=>{alive=false}},[tab]);
 const startChallenge=id=>{if(completed.includes(id))return;const pool=challengePools[id]||[];const seen=readJSON(`nova_challenge_seen_${user?.id||'guest'}_${id}`,[]);let candidates=pool.map((_,i)=>i).filter(i=>!seen.includes(i));if(!candidates.length){candidates=pool.map((_,i)=>i);localStorage.setItem(`nova_challenge_seen_${user?.id||'guest'}_${id}`,JSON.stringify([]))}const first=candidates[Math.floor(Math.random()*candidates.length)];setActiveChallenge(id);setChallengeIndex(first);setChallengeScore(0);setChallengeAnswer(null)};
 const answerChallenge=option=>{if(challengeAnswer!==null||!activeChallenge)return;const q=(challengePools[activeChallenge]||[])[challengeIndex];const correct=option===q.a;setChallengeAnswer({option,correct});setChallengeScore(s=>s+(correct?1:0))};
 const nextChallengeQuestion=()=>{const pool=challengePools[activeChallenge]||[];const seen=readJSON(`nova_challenge_seen_${user?.id||'guest'}_${activeChallenge}`,[]);const updated=[...new Set([...seen,challengeIndex])];localStorage.setItem(`nova_challenge_seen_${user?.id||'guest'}_${activeChallenge}`,JSON.stringify(updated));const candidates=pool.map((_,i)=>i).filter(i=>!updated.includes(i));if(!candidates.length){const next=[...completed,activeChallenge];setCompleted(next);localStorage.setItem(`nova_challenges_${user?.id||'guest'}`,JSON.stringify(next));localStorage.setItem(`nova_challenge_seen_${user?.id||'guest'}_${activeChallenge}`,JSON.stringify([]));setNotice(`Challenge complete! Score: ${challengeScore}/${pool.length}.`);setActiveChallenge(null);setChallengeAnswer(null);setTimeout(()=>setNotice(''),2200);return}const n=candidates[Math.floor(Math.random()*candidates.length)];setChallengeIndex(n);setChallengeAnswer(null)};
 const postDiscussion=async()=>{const text=post.trim();if(!text)return;try{const item=await api('/community/posts',{method:'POST',body:JSON.stringify({text})});setPosts(prev=>[item,...prev]);setPost('');setNotice('Discussion posted for everyone.');setTimeout(()=>setNotice(''),1800)}catch(e){setNotice(e.message||'Could not post discussion.')}};
 return <div className="community-page">
  <div className="page-title"><span className="eyebrow">COMMUNITY • LEARN TOGETHER</span><h1>Your <span>Study Community.</span></h1><p>Discuss doubts, compete in challenges and learn with every student on the platform.</p></div>
  {notice&&<div className="community-toast"><CheckCircle2 size={15}/>{notice}</div>}
  <div className="community-tabs">{[['challenges','Weekly Challenges'],['leaderboard','Leaderboard'],['feed','Discussion Feed'],['room','Study Room']].map(([id,label])=><button key={id} className={tab===id?'active':''} onClick={()=>setTab(id)}>{label}</button>)}</div>
  {tab==='challenges'&&<section className="panel community-main"><div className="section-head"><div><span className="eyebrow">THIS WEEK</span><h2>Community Challenges</h2></div><span className="community-count">{completed.length}/{challenges.length} complete</span></div>{activeChallenge?<div className="challenge-runner">{(()=>{const c=challenges.find(x=>x.id===activeChallenge);const pool=challengePools[activeChallenge]||[];const q=pool[challengeIndex];return <><div className="challenge-runner-head"><div><span className="eyebrow">LIVE CHALLENGE</span><h3>{c?.title}</h3><p>Question {Math.min(pool.length,readJSON(`nova_challenge_seen_${user?.id||'guest'}_${activeChallenge}`,[]).length+1)} of {pool.length}</p></div><strong>{challengeScore} correct</strong></div><div className="challenge-question"><h3>{q.q}</h3><div className="challenge-options">{q.o.map((o,i)=><button key={i} className={challengeAnswer?(i===q.a?'correct':i===challengeAnswer.option?'wrong':'') : ''} disabled={challengeAnswer!==null} onClick={()=>answerChallenge(i)}><span>{String.fromCharCode(65+i)}</span>{o}</button>)}</div>{challengeAnswer&&<div className={'challenge-feedback '+(challengeAnswer.correct?'good':'bad')}><b>{challengeAnswer.correct?'✓ Correct':'✕ Not quite'}</b><button className="primary" onClick={nextChallengeQuestion}>Next question <ChevronRight size={14}/></button></div>}</div></>})()}</div>:<div className="challenge-list">{challenges.map(c=><article className={'challenge-card '+(completed.includes(c.id)?'completed':'')} key={c.id}><div className="challenge-main-row"><div className="challenge-icon"><Trophy size={20}/></div><div className="challenge-body"><b>{c.title}</b><p>{c.meta} • questions will appear after you start</p></div></div><div className="challenge-action-row"><strong>{(challengePools[c.id]||[]).length} questions</strong><button disabled={completed.includes(c.id)} onClick={()=>startChallenge(c.id)}>{completed.includes(c.id)?'Completed':'Start challenge'}</button></div></article>)}</div>}</section>}
  {tab==='leaderboard'&&<section className="community-grid"><div className="panel community-main"><span className="eyebrow">WEEKLY RANKING</span><h2>Learning Leaderboard</h2><p className="muted">Only genuine registered students with recorded learning activity appear here.</p>{leaderboardLoading?<div className="empty-state">Loading genuine learner scores…</div>:realLeaderboard.length===0?<div className="empty-state"><Trophy size={24}/><b>No leaderboard entries yet.</b><span>Complete learning activities to appear here.</span></div>:<div className="leaderboard">{realLeaderboard.map((r,i)=><div className={'leader-row '+(String(r.id)===String(user?.id)?'me':'')} key={r.id}><span className="rank">{i+1}</span><span className="avatar">{String(r.name||'Student').slice(0,1).toUpperCase()}</span><b>{r.name||'Student'}{String(r.id)===String(user?.id)?' • You':''}</b><strong>{Number(r.score).toLocaleString()} XP</strong></div>)}</div>}</div></section>}
  {tab==='room'&&<NovaCoach user={user} go={go} courses={[]} initialTab="community"/>} {tab==='feed'&&<section className="community-grid"><div className="panel community-main"><span className="eyebrow">STUDY DISCUSSION</span><h2>Ask the community</h2><p className="muted">Discussions are stored on the server permanently and are visible to every account.</p><div className="post-box"><textarea value={post} onChange={e=>setPost(e.target.value)} maxLength={4000} placeholder="Share a doubt, useful resource, or study tip…"/><button className="primary" onClick={postDiscussion} disabled={!post.trim()}><Send size={15}/> Post</button></div>{feedLoading?<div className="empty-state">Loading community discussions…</div>:posts.length===0?<div className="empty-state"><MessageCircle size={24}/><b>No discussions yet.</b><span>Be the first student to start the discussion.</span></div>:<div className="community-feed-list">{posts.map(item=><div className="feed-item" key={item.id}><div className="avatar">{String(item.author||'Student').slice(0,1).toUpperCase()}</div><div><b>{item.author||'Student'} • Student</b><p>{item.text}</p><span>{item.createdAt?new Date(item.createdAt).toLocaleString():'Recently'} • Community discussion</span></div></div>)}</div>}</div><aside className="panel community-side"><span className="eyebrow">COMMUNITY RULE</span><h3>Keep it learning-first.</h3><p>No spam, no answer dumping. Ask questions, explain reasoning and help others understand.</p></aside></section>}
 </div>;
}
function TodayNotifications({user,go}){
 const [analytics,setAnalytics]=useState(null),[intel,setIntel]=useState(null),[progress,setProgress]=useState([]),[announcements,setAnnouncements]=useState([]),[loading,setLoading]=useState(true),[done,setDone]=useState(()=>readJSON(`nova_today_done_${user?.id||'guest'}_${new Date().toISOString().slice(0,10)}`,{})),[clearedNotificationIds,setClearedNotificationIds]=useState(()=>readJSON(`nova_cleared_notifications_${user?.id||'guest'}`,[]));
 useModulePersistence(user?.id,'today',{done,dateKey:new Date().toISOString().slice(0,10)},{done:x=>setDone(x&&typeof x==='object'?x:{})});
 const dateKey=new Date().toISOString().slice(0,10);
 const load=()=>{
  if(!user?.id)return;
  setLoading(true);
  Promise.all([api('/analytics/'+user.id),api('/intelligence/'+user.id),api('/progress/'+user.id),api('/announcements')])
   .then(([a,i,p,n])=>{setAnalytics(a);setIntel(i);setProgress(Array.isArray(p)?p:[]);setAnnouncements(Array.isArray(n)?n:[]);})
   .catch(()=>{})
   .finally(()=>setLoading(false));
 };
 useEffect(()=>{load();const refresh=()=>load();window.addEventListener('nova:learning-updated',refresh);return()=>window.removeEventListener('nova:learning-updated',refresh)},[user?.id]);
 const firstCourse=(analytics?.courses||[]).find(c=>Number(c.percent||0)<100);
 const weak=intel?.weakAreas?.[0];
 const streak=Number(intel?.streak||analytics?.streak||0);
 const goalMinutes=Number(localStorage.getItem('daily_goal')||user?.dailyStudyMinutes||60);
 const hour=new Date().getHours();
 const dayPhase=hour<12?'Good morning':hour<17?'Good afternoon':'Good evening';
 const planComplete=goals=>goals.length>0&&goals.every(g=>done[g.id]);
 const goals=[
  firstCourse?{id:'course',icon:<BookOpen size={18}/>,title:`Continue ${firstCourse.title}`,meta:`${firstCourse.completedLessons}/${firstCourse.totalLessons} lessons complete • keep your momentum`,time:'20–30 min',action:'Continue learning',page:'courses'}:null,
  weak?{id:'weak',icon:<Target size={18}/>,title:`Strengthen ${weak.topic||weak.subject}`,meta:`Current accuracy ${Number(weak.accuracy||0)}% • Nova recommends focused practice`,time:'15–20 min',action:'Practice now',page:'code'}:{id:'practice',icon:<Target size={18}/>,title:'Complete a focused coding practice set',meta:'Build today’s problem-solving momentum with a short coding session.',time:'15–20 min',action:'Start practice',page:'code'},
  {id:'ai',icon:<BrainCircuit size={18}/>,title:'Learn with AI Teacher',meta:'Ask Nova to explain one difficult concept, then answer its mini-question.',time:'10 min',action:'Open AI Teacher',page:'tutor'},
  {id:'review',icon:<BarChart3 size={18}/>,title:'Review your learning progress',meta:'Check what you completed and choose the next best action.',time:'5 min',action:'Open analytics',page:'analytics'}
 ].filter(Boolean);
 const toggleDone=id=>{const next={...done,[id]:!done[id]};setDone(next);localStorage.setItem(`nova_today_done_${user?.id||'guest'}_${dateKey}`,JSON.stringify(next));};
 const completed=goals.filter(g=>done[g.id]).length;
 const progressPct=Math.round(completed/goals.length*100);
 const allNotifications=[];
 announcements.forEach(a=>allNotifications.push({id:`announcement-${a.id}`,icon:<Bell size={16}/>,tone:'info',title:a.title,text:a.message,announcement:true,createdAt:a.createdAt}));
 if(weak)allNotifications.push({id:'weak-note',icon:<Target size={16}/>,tone:'warn',title:`Weak area detected: ${weak.topic||weak.subject}`,text:`${weak.accuracy}% accuracy. A focused practice session is recommended today.`});
 if(firstCourse)allNotifications.push({id:'course-note',icon:<BookOpen size={16}/>,tone:'info',title:'You have unfinished learning',text:`${firstCourse.title} is ready to continue from ${firstCourse.completedLessons}/${firstCourse.totalLessons} lessons.`});
 if(streak>0)allNotifications.push({id:'streak-note',icon:<Sparkles size={16}/>,tone:'good',title:`${streak}-day learning streak`,text:'Keep the streak alive with one completed goal today.'});
 if(!allNotifications.length)allNotifications.push({id:'start-note',icon:<Sparkles size={16}/>,tone:'info',title:'Your learning day is ready',text:'Complete one small goal today and Nova will personalize the next one.'});
 const notifications=allNotifications.filter(n=>!clearedNotificationIds.includes(String(n.id)));
 const clearNotifications=()=>{const ids=allNotifications.map(n=>String(n.id));const next=[...new Set([...clearedNotificationIds,...ids])];setClearedNotificationIds(next);localStorage.setItem(`nova_cleared_notifications_${user?.id||'guest'}`,JSON.stringify(next));};
 return <>
  <div className="page-title"><span className="eyebrow">NOVA DAILY GUIDE • {new Date().toLocaleDateString(undefined,{weekday:'long',month:'short',day:'numeric'})}</span><h1>Your <span>Today.</span></h1><p>NovaTutor turns your recent learning activity into a simple plan, so you always know what to do next.</p></div>
  {loading?<section className="panel today-loading"><RefreshCw size={20}/><div><b>Building your daily plan…</b><span>Nova is reading your saved learning activity.</span></div></section>:<>
   <section className="today-hero panel"><div className="today-hero-copy"><div className="today-greeting"><span className="today-orb"><Sparkles size={19}/></span><div><span className="eyebrow">TODAY'S GOAL</span><h2>{completed===goals.length?`You completed today’s plan. 🎉`:`${dayPhase}. Make steady progress today.`}</h2></div></div><p>{completed===goals.length?'Excellent work. Come back tomorrow for a fresh plan.':`Aim for about ${goalMinutes} minutes of focused learning. Nova will keep the plan practical and connected to your weak areas.`}</p><div className="today-progress-row"><div className="today-progress"><i style={{width:progressPct+'%'}}/></div><b>{completed}/{goals.length} complete</b></div></div><div className="today-score"><span>{progressPct}%</span><small>today</small></div></section>
   <div className="today-grid"><section className="panel today-plan"><div className="panel-head"><div><span className="eyebrow">RECOMMENDED PLAN</span><h3>What to do today</h3></div><CalendarDays size={20}/></div><div className="today-goals">{goals.map((g,i)=><article className={'today-goal '+(done[g.id]?'completed':'')} key={g.id}><button className="today-check" onClick={()=>toggleDone(g.id)} aria-label={done[g.id]?'Mark goal incomplete':'Mark goal complete'}>{done[g.id]?<CheckCircle2 size={18}/>:<span>{i+1}</span>}</button><div className="today-goal-icon">{g.icon}</div><div className="today-goal-copy"><div><b>{g.title}</b><span>{g.time}</span></div><p>{g.meta}</p><button className="text-btn" onClick={()=>go(g.page)}>{g.action} <ChevronRight size={13}/></button></div></article>)}</div></section>
    <section className="panel today-notifications"><div className="panel-head"><div><span className="eyebrow">NOTIFICATIONS</span><h3>Nova noticed</h3></div><div className="today-notification-actions"><button className="icon-btn" type="button" onClick={clearNotifications} disabled={!notifications.length} title="Clear notifications" aria-label="Clear notifications"><Trash2 size={16}/></button><Bell size={20}/></div></div>{notifications.length?<div className="today-notice-list">{notifications.map(n=><div className={'today-notice '+n.tone} key={n.id}><div className="today-notice-icon">{n.icon}</div><div className="today-notice-copy"><b>{n.title}</b>{n.announcement&&n.createdAt&&<small className="today-announcement-time">{new Date(n.createdAt).toLocaleString()}</small>}<p>{n.text}</p></div></div>)}</div>:<div className="today-notifications-empty"><Bell size={18}/><b>All notifications cleared</b><span>New announcements and learning alerts will appear here when available.</span></div>}<button className="secondary full" onClick={()=>go('analytics')}>See full learning analytics <BarChart3 size={14}/></button></section></div>
  </>}
 </>;
}


function HubTabs({tabs,active,setActive}){
 return <div className={'hub-tabs'+(tabs.length===3?' courses-tabs':'')} role="tablist" aria-label="Section navigation">{tabs.map(([id,label,icon])=>{const Icon=icon;return <button key={id} role="tab" aria-selected={active===id} className={active===id?'active':''} onClick={()=>setActive(id)}>{Icon&&<Icon size={15}/>}<span>{label}</span></button>})}</div>
}
function MyLearningHub({courses,progress,refresh,user,go,openCourse}){
 const [tab,setTab]=useState('courses');
 useModulePersistence(user?.id,'my-learning',{tab},{tab:x=>setTab(x||'courses')});
 return <><HubTabs tabs={[["courses","Courses",BookOpen],["profile","Learning Profile",Brain],["milestones","Milestones",Trophy]]} active={tab} setActive={setTab}/>{tab==='courses'&&<Courses courses={courses} progress={progress} refresh={refresh} user={user} openCourse={openCourse}/>} {tab==='profile'&&<AILearningProfile user={user} courses={courses} go={go}/>} {tab==='milestones'&&<Achievements user={user} go={go}/>}</>
}
function TodayHub({user,go}){
 const [tab,setTab]=useState('today');
 useModulePersistence(user?.id,'today-hub',{tab},{tab:x=>setTab(x||'today')});
 return <><HubTabs tabs={[["today","Today's Plan",Bell],["planner","Study Planner",CalendarDays]]} active={tab} setActive={setTab}/>{tab==='today'&&<TodayNotifications user={user} go={go}/>} {tab==='planner'&&<StudyPlanner user={user}/>}</>
}
function RevisionHub({user,go}){
 const [tab,setTab]=useState('revision');
 useModulePersistence(user?.id,'revision-hub',{tab},{tab:x=>setTab(x||'revision')});
 return <><HubTabs tabs={[["revision","Revision Queue",RotateCcw],["flashcards","Flashcards",Layers3]]} active={tab} setActive={setTab}/>{tab==='revision'&&<RevisionCenter user={user} go={go}/>} {tab==='flashcards'&&<Flashcards user={user}/>}</>
}

function NovaBrain({user,go}){
 const [tab,setTab]=useState('overview'),[data,setData]=useState(null),[loading,setLoading]=useState(true),[session,setSession]=useState(false),[minutes,setMinutes]=useState(25),[seconds,setSeconds]=useState(1500);
 useModulePersistence(user?.id,'nova-brain',{tab,session,minutes,seconds},{tab:x=>setTab(x||'overview'),session:x=>setSession(Boolean(x)),minutes:x=>setMinutes(Number(x)||25),seconds:x=>setSeconds(Number(x)||1500)});
 const load=()=>{setLoading(true);api('/nova-brain/'+user.id).then(setData).catch(()=>setData(null)).finally(()=>setLoading(false))};
 useEffect(()=>{load();const f=()=>load();window.addEventListener('nova:learning-updated',f);return()=>window.removeEventListener('nova:learning-updated',f)},[user?.id]);
 useEffect(()=>{if(!session)return;const id=setInterval(()=>setSeconds(x=>{if(x<=1){setSession(false);setSeconds(minutes*60);api('/intelligence/'+user.id+'/events',{method:'POST',body:JSON.stringify({type:'STUDY_SESSION_COMPLETED',subject:'Nova Focus',topic:'Personal learning session',durationSeconds:minutes*60,details:'Completed a Nova Brain focus session.'})}).then(()=>window.dispatchEvent(new Event('nova:learning-updated'))).catch(()=>{});return minutes*60}return x-1}),1000);return()=>clearInterval(id)},[session,minutes,user?.id]);
 const fmt=n=>`${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`; const score=v=>Math.max(0,Math.min(100,Number(v)||0));
 if(loading)return <><div className="page-title"><span className="eyebrow">NOVA BRAIN • PERSONAL LEARNING SYSTEM</span><h1>Your <span>Learning Brain.</span></h1><p>Reading your real learning signals…</p></div><section className="nova-brain-page-grid"><div className="panel skeleton-card"/><div className="panel skeleton-card"/><div className="panel skeleton-card"/></section></>;
 if(!data)return <section className="panel empty"><Brain size={48}/><b>Nova Brain is warming up.</b><span>Complete a lesson or quiz and return here.</span></section>;
 const weakest=(data.mastery||[])[0],best=(data.mastery||[]).slice().sort((a,b)=>b.mastery-a.mastery)[0];
 return <><div className="page-title"><span className="eyebrow">NOVA BRAIN • PERSONAL LEARNING SYSTEM</span><h1>Your <span>Learning Brain.</span></h1><p>One place for mastery, mistakes, memory, focus and the next best action — based on your real activity.</p></div>
 <section className="nova-brain-hero panel"><div><span className="eyebrow">NEXT BEST ACTION</span><h2>{data.nextAction}</h2><p>{data.nextReason}</p><div className="nova-brain-hero-actions"><button className="primary" onClick={()=>go(data.nextTarget)}>Start now <ChevronRight size={14}/></button><button className="secondary" onClick={()=>setTab('session')}>I have {minutes} minutes <Clock3 size={14}/></button></div></div><div className="brain-score"><b>{data.overall}</b><span>/100</span><small>learning health</small></div></section>
 <div className="brain-tabs">{[['overview','Overview'],['mastery','Mastery'],['mistakes','Mistake Lab'],['session','Study Session']].map(x=><button className={tab===x[0]?'active':''} onClick={()=>setTab(x[0])} key={x[0]}>{x[1]}</button>)}</div>
 {tab==='overview'&&<section className="nova-brain-page-grid"><div className="panel"><div className="panel-head"><div><span className="eyebrow">LEARNING HEALTH</span><h3>How your learning is behaving</h3></div><Brain size={18}/></div><div className="brain-metrics">{[['Overall',data.overall],['Retention',data.retention],['Consistency',data.consistency],['Persistence',data.persistence]].map(x=><div key={x[0]}><b>{score(x[1])}%</b><span>{x[0]}</span><i><em style={{width:score(x[1])+'%'}}/></i></div>)}</div></div><div className="panel"><div className="panel-head"><div><span className="eyebrow">TODAY'S FOCUS</span><h3>Do one useful thing</h3></div><Target size={18}/></div><div className="brain-focus"><b>{weakest?weakest.subject:'Your next lesson'}</b><span>{weakest?`${weakest.mastery}% mastery • ${weakest.state}`:'Build your first learning signal.'}</span><button className="primary" onClick={()=>go(data.nextTarget)}>Start focused action <ChevronRight size={14}/></button></div></div><div className="panel brain-wide"><div className="panel-head"><div><span className="eyebrow">28-DAY REAL ACTIVITY</span><h3>No fabricated activity</h3></div><CalendarDays size={18}/></div><div className="brain-heatmap">{(data.heatmap||[]).map(d=>{const level=Math.min(4,Math.max(0,Number(d.count)||0));return <span key={d.date} className={'heat-'+level} title={`${d.date}: ${d.count} learning event${d.count===1?'':'s'}`} aria-label={`${d.date}: ${d.count} learning events`}/>})}</div><div className="heatmap-legend" aria-hidden="true"><span>Less</span><i className="heat-0"/><i className="heat-1"/><i className="heat-2"/><i className="heat-3"/><i className="heat-4"/><span>More</span></div><small className="muted">Study minutes: {data.studyMinutes} • Current streak: {data.streak} days • All cells come from saved Learning Events.</small></div><div className="panel"><div className="panel-head"><div><span className="eyebrow">STRONGEST SIGNAL</span><h3>{best?.subject||'Not enough data'}</h3></div><Trophy size={18}/></div><p>{best?`${best.mastery}% mastery • ${best.trend} trend. Keep it active with spaced recall.`:'Complete quizzes to build a mastery profile.'}</p><button className="secondary" onClick={()=>setTab('mastery')}>Open mastery map</button></div></section>}
 {tab==='mastery'&&<section className="panel"><div className="panel-head"><div><span className="eyebrow">CONCEPT MASTERY</span><h3>Strengths, gaps and dependencies</h3></div><BarChart3 size={18}/></div><div className="brain-mastery-list">{(data.mastery||[]).map(m=><div className="brain-mastery-row" key={m.subject}><div><b>{m.subject}</b><small>{m.attempts} quiz attempts • {m.trend} • {m.state}</small></div><strong>{m.mastery}%</strong><i><em style={{width:score(m.mastery)+'%'}}/></i><button className="text-btn" onClick={()=>go(m.mastery<65?'revision':'quiz')}>{m.mastery<65?'Review':'Practice'} <ChevronRight size={13}/></button></div>)}</div>{!data.mastery?.length&&<div className="empty"><Target/><b>No mastery data yet.</b><span>Complete a quiz to start building your concept profile.</span></div>}</section>}
 {tab==='mistakes'&&<section className="panel"><div className="panel-head"><div><span className="eyebrow">MISTAKE LAB</span><h3>Turn mistakes into permanent learning</h3></div><Target size={18}/></div><p className="muted">Nova remembers questions you missed so revision targets the actual problem instead of giving you random practice.</p>{data.mistakes?.length?<div className="mistake-lab-list">{data.mistakes.map(m=><article key={m.id}><div className="mistake-count">{m.repeats}×</div><div><b>{m.subject}</b><small>{m.topic}</small><p>{m.question}</p><span>{m.reason}</span></div><button className="secondary" onClick={()=>go('quiz')}>Retest <ChevronRight size={13}/></button></article>)}</div>:<div className="empty"><CheckCircle2/><b>No mistakes recorded yet.</b><span>That's a good thing. Keep practicing and Nova will remember the ones that need another look.</span></div>}</section>}
 {tab==='session'&&<section className="panel brain-session"><div><span className="eyebrow">FOCUS SESSION</span><h3>Study with the time you actually have.</h3><p>Nova records a completed focus session as real learning activity. Choose a duration, then use the next-best action above.</p><div className="session-pills">{[10,15,25,45,60].map(x=><button className={minutes===x?'active':''} key={x} onClick={()=>{setMinutes(x);if(!session)setSeconds(x*60)}}>{x} min</button>)}</div><div className="brain-timer">{fmt(seconds)}</div><div className="brain-session-actions"><button className={session?'danger-btn':'primary'} onClick={()=>{if(session)setSession(false);else{setSeconds(minutes*60);setSession(true)}}}>{session?'Pause session':'Start session'} <Clock3 size={14}/></button><button className="secondary" onClick={()=>go(data.nextTarget)}>Open next action <ChevronRight size={14}/></button></div></div><div className="session-loop"><b>Learn → Practice → Detect → Explain → Revise → Master</b><span>One focused outcome is better than six unfinished tasks.</span></div></section>}
 </>;
}

const ALLOWED_PAGES=['login','about','privacy','terms','contact','dashboard','coach','study-room','analytics','courses','course','mentor','learning-studio','tutor','code','quiz','practice','prepare','chat','knowledge','planner','flashcards','interview','voice','settings','gatecse','career','community','notifications','revision','achievements','dpp','profile','exam','nova-os','nova-brain','onboarding','admin','dsa'];

function parseAppHash(rawHash=window.location.hash){
 const clean=String(rawHash||'').replace(/^#\/?/,'').split('?')[0].replace(/\/+$/,'');
 const alias={'gate-cse':'gatecse'};
 const courseLesson=clean.match(/^course\/(\d+)\/lesson\/(\d+)$/i);
 if(courseLesson){
  const cid=Number(courseLesson[1]),lid=Number(courseLesson[2]);
  return {page:'course',courseId:cid,lessonId:lid,dsaSlug:null,gateTab:null,studioTab:null,routeKey:`course/${cid}/lesson/${lid}`};
 }
 const courseOnly=clean.match(/^course\/(\d+)$/i);
 if(courseOnly){
  const cid=Number(courseOnly[1]);
  return {page:'course',courseId:cid,lessonId:null,dsaSlug:null,gateTab:null,studioTab:null,routeKey:`course/${cid}`};
 }
 const dsaMatch=clean.match(/^dsa\/([a-z0-9-]+)$/i);
 if(dsaMatch){
  const slug=dsaMatch[1];
  return {page:'dsa',courseId:null,lessonId:null,dsaSlug:slug,gateTab:null,studioTab:null,routeKey:`dsa/${slug}`};
 }
 const gateMatch=clean.match(/^(?:gatecse|gate-cse)\/(overview|syllabus|notes|pyq)$/i);
 if(gateMatch){
  const tab=gateMatch[1].toLowerCase();
  return {page:'gatecse',courseId:null,lessonId:null,dsaSlug:null,gateTab:tab,studioTab:null,routeKey:`gatecse/${tab}`};
 }
 const studioMatch=clean.match(/^learning-studio\/(teacher|voice)$/i);
 if(studioMatch){
  const stab=studioMatch[1].toLowerCase();
  return {page:'learning-studio',courseId:null,lessonId:null,dsaSlug:null,gateTab:null,studioTab:stab,routeKey:stab==='voice'?'learning-studio/voice':'learning-studio'};
 }
 const base=alias[clean.toLowerCase()]||clean.toLowerCase();
 const legacyStudio={tutor:'teacher',notes:'teacher',voice:'voice'};
 if(legacyStudio[base]){
  const stab=legacyStudio[base];
  try{localStorage.setItem('nova_learning_studio_tab',stab)}catch{}
  return {page:'learning-studio',courseId:null,lessonId:null,dsaSlug:null,gateTab:null,studioTab:stab,routeKey:stab==='voice'?'learning-studio/voice':'learning-studio'};
 }
 return {page:base,courseId:null,lessonId:null,dsaSlug:null,gateTab:null,studioTab:null,routeKey:base||'dashboard'};
}

function App(){
 const initialParsed=useMemo(()=>parseAppHash(window.location.hash),[]);
 const initialNonAdminBlocked=useMemo(()=>{const s=readUser();return Boolean(s&&initialParsed.page==='admin'&&String(s.role||'STUDENT').toUpperCase()!=='ADMIN')},[]);
 const [adminDenied,setAdminDenied]=useState(initialNonAdminBlocked);
 const [page,setPage]=useState(()=>{
  const session=readUser();if(!session)return 'login';
  const isStudent=String(session.role||'STUDENT').toUpperCase()==='STUDENT';
  const needsProfile=isStudent&&session.profileComplete===false;
  if(needsProfile)return 'onboarding';
  const h=initialParsed.page;
  if(h==='admin'&&String(session.role||'STUDENT').toUpperCase()!=='ADMIN')return 'dashboard';
  const saved=localStorage.getItem('nova_page')||'dashboard';
  if(h==='onboarding'||h==='login')return 'dashboard';
  if(h==='course'&&!initialParsed.courseId)return 'dashboard';
  return ALLOWED_PAGES.includes(h)?h:(ALLOWED_PAGES.includes(saved)&&saved!=='login'?saved:'dashboard');
 });
 useEffect(()=>{if(initialNonAdminBlocked&&window.location.hash!=='#/dashboard'){window.location.replace('#/dashboard')}},[initialNonAdminBlocked]);
 useEffect(()=>{try{if('scrollRestoration' in window.history)window.history.scrollRestoration='manual'}catch{}},[]);
 const [courseId,setCourseId]=useState(()=>initialParsed.courseId);
 const [lessonId,setLessonId]=useState(()=>initialParsed.lessonId);
 const [dsaSlug,setDsaSlug]=useState(()=>initialParsed.dsaSlug);
 const [gateTab,setGateTab]=useState(()=>initialParsed.gateTab||'overview');
 const [studioTab,setStudioTab]=useState(()=>initialParsed.studioTab||null);
 const inAppNavCountRef=useRef(0);
 const [aiStatus,setAiStatus]=useState({configured:false,model:'—'}),[courses,setCourses]=useState([]),[progress,setProgress]=useState([]),[mobile,setMobile]=useState(false),[user,setUser]=useState(readUser);
 const [wakingServer,setWakingServer]=useState(false);
 const [vp,setVp]=useState(()=>typeof window!=='undefined'&&window.matchMedia('(max-width:960px)').matches);
 useEffect(()=>{const mq=window.matchMedia('(max-width:960px)');const on=e=>{setVp(e.matches);if(!e.matches)setMobile(false)};mq.addEventListener('change',on);return()=>mq.removeEventListener('change',on)},[]);
 const [dark,setDark]=useState(()=>localStorage.getItem('nova_theme')==='dark');
 const clearUserClientState=useCallback((exitingUser)=>{
  const exitingId=exitingUser?.id;
  const isGuest=String(exitingUser?.role||'').toUpperCase()==='GUEST';
  invalidatePendingSessionRefresh();
  bootstrappedUserRef.current=null;
  localStorage.removeItem('ai_user');
  localStorage.removeItem('nova_page');
  localStorage.removeItem('nova_nav_stack');
  ['nova_ai_language','nova_career_goal','nova_career_saved_at','daily_goal',
   'nova_teaching_mode','nova_prepare_tab','nova_learning_studio_tab',
   'nova_courses_cache','nova_ai_prefill','nova_open_course','nova_bookmarks','nova_exam_best']
   .forEach(k=>{try{localStorage.removeItem(k)}catch{}});
  try{
   Object.keys(sessionStorage).filter(k=>k.startsWith('nova_scroll_v2:')).forEach(k=>sessionStorage.removeItem(k));
  }catch{}
  if(exitingId){
   resetTransientLearningState(exitingId);
   clearRuntimeUser(exitingId);
   if(isGuest){
    try{
     const idStr=String(exitingId);
     Object.keys(localStorage).filter(k=>
      k.startsWith(`dsa_code_${idStr}_`)
      || k.startsWith(`nova_runtime_v2_${idStr}_`)
      || k.startsWith(`nova_workspace_v1_${idStr}_`)
      || k.startsWith(`nova_workspace_${idStr}_`)
      || k.startsWith(`nova_module_state_${idStr}_`)
      || k.startsWith(`nova_quiz_seen_${idStr}_`)
      || k.startsWith(`nova_today_done_${idStr}_`)
      || k.startsWith(`nova_challenge_seen_${idStr}_`)
      || k.endsWith(`_${idStr}`)
     ).forEach(k=>localStorage.removeItem(k));
    }catch{}
   }
  }
  setCourses([]);
  setProgress([]);
  setCourseId(null);
  setLessonId(null);
  setDsaSlug(null);
  setGateTab('overview');
  setStudioTab(null);
  setMobile(false);
  setUser(null);
  setPage('login');
  window.location.hash='#/login';
 },[]);
 const userRef=useRef(user);
 userRef.current=user;
 useEffect(()=>{const expire=()=>{clearUserClientState(userRef.current)};window.addEventListener('nova-session-expired',expire);return()=>window.removeEventListener('nova-session-expired',expire)},[clearUserClientState]);
 useEffect(()=>{document.documentElement.classList.toggle('dark',dark);document.documentElement.setAttribute('data-theme',dark?'dark':'light');localStorage.setItem('nova_theme',dark?'dark':'light')},[dark]);

 const routeKey=useMemo(()=>{
  if(page==='course'&&courseId)return lessonId?`course/${courseId}/lesson/${lessonId}`:`course/${courseId}`;
  if(page==='dsa'&&dsaSlug)return `dsa/${dsaSlug}`;
  if(page==='gatecse'&&gateTab&&gateTab!=='overview')return `gatecse/${gateTab}`;
  if(page==='learning-studio'&&studioTab==='voice')return 'learning-studio/voice';
  return page;
 },[page,courseId,lessonId,dsaSlug,gateTab,studioTab]);
 const routeKeyRef=useRef(routeKey);
 routeKeyRef.current=routeKey;
 const navModeRef=useRef('init');
 const restoringScrollRef=useRef(false);
 const scrollStoreKey=(key)=>`nova_scroll_v2:${key}`;
 const saveCurrentScroll=()=>{if(restoringScrollRef.current||routeKeyRef.current==='login')return;try{sessionStorage.setItem(scrollStoreKey(routeKeyRef.current),String(Math.max(0,Math.round(window.scrollY||0))))}catch{}};

 // Single authoritative session bootstrap + token-refresh listener.
 // Runs once per distinct signed-in user id so /auth/me never loops.
 const bootstrappedUserRef=useRef(null);
 useEffect(()=>{
  const sync=()=>{const fresh=readUser();if(!fresh)return;setUser(prev=>{if(!prev||String(prev.id)!==String(fresh.id))return prev;return prev.token===fresh.token&&prev.role===fresh.role&&prev.profileComplete===fresh.profileComplete&&prev.name===fresh.name?prev:fresh})};
  window.addEventListener('nova:session-refreshed',sync);
  return()=>window.removeEventListener('nova:session-refreshed',sync);
 },[]);
 useEffect(()=>{
  if(!user?.token||!user?.id)return;
  if(bootstrappedUserRef.current===user.id)return;
  const activeId=String(user.id);
  const activeToken=user.token;
  bootstrappedUserRef.current=user.id;
  let alive=true;
  const wakeTimer=setTimeout(()=>{if(alive)setWakingServer(true)},2500);
  refreshSessionToken().then(ok=>{
   if(!alive)return;
   setWakingServer(false);
   if(!ok)return;
   const fresh=readUser();
   if(!fresh||String(fresh.id)!==activeId)return;
   setUser(prev=>{if(!prev||String(prev.id)!==activeId)return prev;return prev.token===fresh.token&&prev.role===fresh.role&&prev.profileComplete===fresh.profileComplete&&prev.name===fresh.name?prev:fresh});
   const isStudent=String(fresh.role||'STUDENT').toUpperCase()==='STUDENT';
   if(isStudent&&fresh.profileComplete===false){
    setPage(p=>{if(p!=='onboarding'){localStorage.setItem('nova_page','onboarding');window.location.replace('#/onboarding');return 'onboarding'}return p});
    return;
   }
   setPage(p=>{if(p==='onboarding'||p==='login'){localStorage.setItem('nova_page','dashboard');window.location.replace('#/dashboard');return 'dashboard'}return p});
  }).catch(()=>{if(alive)setWakingServer(false)}).finally(()=>clearTimeout(wakeTimer));
  return()=>{alive=false;clearTimeout(wakeTimer)};
 },[user?.id,user?.token]);

 const load=useCallback(()=>{
  const activeId=user?.id;
  api('/courses').then(x=>{if(!readUser()||String(readUser()?.id)!==String(activeId))return;const arr=Array.isArray(x)?x:[];setCourses(arr);try{localStorage.setItem('nova_courses_cache',JSON.stringify(arr))}catch{}}).catch(e=>console.warn('courses load failed',e));
  if(activeId)api('/progress/'+activeId).then(x=>{if(!readUser()||String(readUser()?.id)!==String(activeId))return;setProgress(Array.isArray(x)?x:[])}).catch(e=>console.warn('progress load failed',e));
 },[user?.id]);
 useEffect(()=>{if(user?.id)load()},[user?.id,load]);
 useEffect(()=>{
  if(user?.role!=='ADMIN' && page==='admin'){setPage('dashboard');localStorage.setItem('nova_page','dashboard');window.location.hash='#/dashboard'}
 },[user?.role,page]);
 useEffect(()=>{const isStudent=String(user?.role||'STUDENT').toUpperCase()==='STUDENT';if(user?.id && isStudent && user.profileComplete===false && page!=='onboarding'){setPage('onboarding');localStorage.setItem('nova_page','onboarding');window.location.replace('#/onboarding')}},[user?.id,user?.role,user?.profileComplete,page]);
 useEffect(()=>{
  if(!user?.id)return;
  const activeId=String(user.id);
  let alive=true;
  api('/users/'+user.id).then(profile=>{
   const cur=readUser();
   if(!alive||!profile||typeof profile!=='object'||!cur||String(cur.id)!==activeId)return;
   setUser(prev=>{
    if(!prev||String(prev.id)!==activeId)return prev;
    const next={...prev,...profile};
    if(typeof profile.profileComplete!=='boolean')next.profileComplete=prev.profileComplete;
    try{localStorage.setItem('ai_user',JSON.stringify(next))}catch{}
    return next;
   });
   if(profile.preferredAiLanguage&&String(readUser()?.id||'')===activeId)localStorage.setItem(AI_LANGUAGE_KEY,profile.preferredAiLanguage);
  }).catch(()=>{});
  return()=>{alive=false};
 },[user?.id]);
 useEffect(()=>{
  if(!user?.token)return;
  let cancelled=false,timer=null;
  const check=()=>{api('/ai/status').then(s=>{if(!cancelled){setAiStatus(s);if(timer){clearTimeout(timer);timer=null;}}}).catch(()=>{if(!cancelled){setAiStatus({configured:false,model:'backend offline'});timer=setTimeout(check,20000);}})};
  check();
  return()=>{cancelled=true;if(timer)clearTimeout(timer)};
 },[user?.id]);

 const persistBeforeNavigation=(reason='navigation')=>{
  try{
    beginNavigationPersistence(reason);
    window.dispatchEvent(new Event('nova:persist-before-navigation'));
  }catch{}
 };
 const pushHash=(nextKey)=>{
  const nextHash='#/'+nextKey;
  if(window.location.hash!==nextHash)window.location.hash=nextHash;
 };
 const openCourse=(id,nextLessonId=null)=>{
  if(!user||!id)return;
  saveCurrentScroll();
  const numId=Number(id);
  const numLesson=nextLessonId?Number(nextLessonId):null;
  const nextKey=numLesson?`course/${numId}/lesson/${numLesson}`:`course/${numId}`;
  if(routeKeyRef.current!==nextKey){persistBeforeNavigation();navModeRef.current='push';inAppNavCountRef.current+=1;}
  setCourseId(numId);
  setLessonId(numLesson);
  setPage('course');
  localStorage.setItem('nova_page','course');
  pushHash(nextKey);
  setMobile(false);
 };
 const openLesson=(cid,lid)=>{openCourse(cid,lid)};
 const onDsaSlug=useCallback((nextSlug)=>{
  saveCurrentScroll();
  const nextKey=nextSlug?`dsa/${nextSlug}`:'dsa';
  if(routeKeyRef.current!==nextKey){persistBeforeNavigation();navModeRef.current='push';inAppNavCountRef.current+=1;}
  setDsaSlug(nextSlug||null);
  setPage('dsa');
  localStorage.setItem('nova_page','dsa');
  pushHash(nextKey);
 },[]);
 const onGateTab=useCallback((nextTab)=>{
  saveCurrentScroll();
  const cleanTab=nextTab||'overview';
  const nextKey=cleanTab==='overview'?'gatecse':`gatecse/${cleanTab}`;
  if(routeKeyRef.current!==nextKey){persistBeforeNavigation();navModeRef.current='push';inAppNavCountRef.current+=1;}
  setGateTab(cleanTab);
  setPage('gatecse');
  localStorage.setItem('nova_page','gatecse');
  pushHash(nextKey);
 },[]);
 const onStudioTab=useCallback((nextTab)=>{
  saveCurrentScroll();
  const cleanTab=nextTab==='voice'?'voice':'teacher';
  const nextKey=cleanTab==='voice'?'learning-studio/voice':'learning-studio';
  if(routeKeyRef.current!==nextKey){persistBeforeNavigation();navModeRef.current='push';inAppNavCountRef.current+=1;}
  setStudioTab(cleanTab);
  setPage('learning-studio');
  localStorage.setItem('nova_learning_studio_tab',cleanTab);
  localStorage.setItem('nova_page','learning-studio');
  pushHash(nextKey);
 },[]);
 const go=id=>{
  if(!user)return;
  if(id==='admin'&&role!=='ADMIN')return;
  saveCurrentScroll();
  const legacyStudio={tutor:'teacher',notes:'teacher',voice:'voice'};
  const target=legacyStudio[id]?'learning-studio':id;
  const nextStudioTab=legacyStudio[id]||(target==='learning-studio'?'teacher':null);
  const nextKey=target==='learning-studio'&&nextStudioTab==='voice'?'learning-studio/voice':target;
  if(nextStudioTab){localStorage.setItem('nova_learning_studio_tab',nextStudioTab);setStudioTab(nextStudioTab);}
  if(target==='dsa')setDsaSlug(null);
  if(target==='gatecse')setGateTab('overview');
  if(routeKeyRef.current!==nextKey){persistBeforeNavigation();navModeRef.current='push';inAppNavCountRef.current+=1;}
  setPage(target);
  localStorage.setItem('nova_page',target);
  pushHash(nextKey);
  setMobile(false);
 };

 // Continuous scroll tracking keyed by full routeKey (e.g. course/1/lesson/27, dsa/two-sum, dashboard).
 useEffect(()=>{
  let frame=0;
  const save=()=>{if(frame)return;frame=requestAnimationFrame(()=>{frame=0;saveCurrentScroll()})};
  window.addEventListener('scroll',save,{passive:true});
  return()=>{window.removeEventListener('scroll',save);if(frame)cancelAnimationFrame(frame)};
 },[routeKey]);

 // Deterministic scroll restoration: forward pushes start at 0; Back/Forward restores
 // the saved scrollY using ResizeObserver until async content reaches target height.
 useEffect(()=>{
  const mode=navModeRef.current;
  navModeRef.current='pop';
  if(mode==='push'){
   restoringScrollRef.current=false;
   window.scrollTo({top:0,left:0,behavior:'auto'});
   return;
  }
  const raw=sessionStorage.getItem(scrollStoreKey(routeKey));
  const target=Number(raw);
  if(!Number.isFinite(target)||target<=0){
   restoringScrollRef.current=false;
   window.scrollTo({top:0,left:0,behavior:'auto'});
   return;
  }
  restoringScrollRef.current=true;
  let cancelled=false,userInteracted=false,raf=0;
  const startedAt=Date.now();
  const stopUser=()=>{userInteracted=true;cleanup();};
  const apply=()=>{
   if(cancelled||userInteracted)return;
   window.scrollTo({top:target,left:0,behavior:'auto'});
   if(Math.abs(window.scrollY-target)<=2||Date.now()-startedAt>2500){
    cleanup();
   }
  };
  let ro=null;
  if(typeof ResizeObserver!=='undefined'){
   ro=new ResizeObserver(()=>{if(!cancelled&&!userInteracted){cancelAnimationFrame(raf);raf=requestAnimationFrame(apply)}});
   ro.observe(document.body);
  }
  const timer=setInterval(()=>{if(!cancelled&&!userInteracted)apply()},60);
  const maxTimer=setTimeout(()=>cleanup(),2600);
  const cleanup=()=>{
   cancelled=true;
   restoringScrollRef.current=false;
   cancelAnimationFrame(raf);
   clearInterval(timer);
   clearTimeout(maxTimer);
   ro?.disconnect();
   window.removeEventListener('wheel',stopUser);
   window.removeEventListener('touchstart',stopUser);
   window.removeEventListener('keydown',stopUser);
   window.removeEventListener('pointerdown',stopUser);
  };
  window.addEventListener('wheel',stopUser,{passive:true});
  window.addEventListener('touchstart',stopUser,{passive:true});
  window.addEventListener('keydown',stopUser,{passive:true});
  window.addEventListener('pointerdown',stopUser,{passive:true});
  raf=requestAnimationFrame(apply);
  return cleanup;
 },[routeKey]);

 useEffect(()=>{const f=()=>go('tutor');window.addEventListener('nova-go-tutor',f);return()=>window.removeEventListener('nova-go-tutor',f)},[page,user?.id]);
 useEffect(()=>{if(!adminDenied)return;const t=setTimeout(()=>setAdminDenied(false),4200);return()=>clearTimeout(t)},[adminDenied]);

 useEffect(()=>{
  const onHash=()=>{
   const session=readUser();
   if(!session){setPage('login');return}
   const parsed=parseAppHash(window.location.hash);
   const role=String(session.role||'STUDENT').toUpperCase();
   const isStudent=role==='STUDENT';
   const needsProfile=isStudent&&session.profileComplete===false;

   if(parsed.page==='onboarding'){
    if(!needsProfile){
     setPage('dashboard');window.location.replace('#/dashboard');return;
    }
   }
   if(parsed.page==='login'){
    const target=needsProfile?'onboarding':'dashboard';
    setPage(target);window.location.replace('#/'+target);return;
   }
   const h=ALLOWED_PAGES.includes(parsed.page)?parsed.page:'dashboard';
   if(h==='admin'&&role!=='ADMIN'){
    setPage('dashboard');window.location.replace('#/dashboard');setAdminDenied(true);return;
   }
   if(h==='course'&&!parsed.courseId){
    setPage('dashboard');window.location.replace('#/dashboard');return;
   }
   const finalRouteKey=h==='course'?(parsed.lessonId?`course/${parsed.courseId}/lesson/${parsed.lessonId}`:`course/${parsed.courseId}`)
    :h==='dsa'?(parsed.dsaSlug?`dsa/${parsed.dsaSlug}`:'dsa')
    :h==='gatecse'?(parsed.gateTab&&parsed.gateTab!=='overview'?`gatecse/${parsed.gateTab}`:'gatecse')
    :h==='learning-studio'?(parsed.studioTab==='voice'?'learning-studio/voice':'learning-studio')
    :h;
   if(navModeRef.current!=='push'&&finalRouteKey!==routeKeyRef.current){
    restoringScrollRef.current=true;
   }
   if(h==='course'){
    setCourseId(parsed.courseId);
    setLessonId(parsed.lessonId||null);
   }
   if(h==='dsa')setDsaSlug(parsed.dsaSlug||null);
   if(h==='gatecse')setGateTab(parsed.gateTab||'overview');
   if(h==='learning-studio')setStudioTab(parsed.studioTab||null);
   if(finalRouteKey!==routeKeyRef.current)persistBeforeNavigation();
   setPage(h);
   localStorage.setItem('nova_page',h);
  };
  window.addEventListener('hashchange',onHash);
  if(!window.location.hash)window.location.replace('#/'+routeKeyRef.current);
  return()=>window.removeEventListener('hashchange',onHash);
 },[user?.role]);

 useEffect(()=>{
  if(!user)return;
  const isStudent=String(user.role||'STUDENT').toUpperCase()==='STUDENT';
  const needsProfile=isStudent&&user.profileComplete===false;
  if(page==='login'||(!needsProfile&&page==='onboarding')){
   const target=needsProfile?'onboarding':'dashboard';
   setPage(target);localStorage.setItem('nova_page',target);window.location.replace('#/'+target);
  }
 },[user,page]);
 useScrollReveal(null,[page]);
 const role=String(user?.role||'STUDENT').toUpperCase();
 if(page==='onboarding') return <Onboarding user={user} onComplete={next=>{localStorage.setItem('ai_user',JSON.stringify(next));localStorage.setItem('nova_page','dashboard');setUser(next);setPage('dashboard');window.location.replace('#/dashboard')}}/>;
 const navModel=[
  {id:'learn',label:'Learn',items:[['dashboard','Home',LayoutDashboard],['notifications','Today',Bell],['courses','Courses',BookOpen],['knowledge','Knowledge Hub',FileSearch]]},
  {id:'practice',label:'Practice',items:[['practice','Practice hub',Target],['dsa','DSA Practice',Code2],['exam','Exam Simulator',Trophy],['gatecse','GATE CSE',GraduationCap],['revision','Revision',RotateCcw]]},
  {id:'ai',label:'AI',items:[['learning-studio','AI Teacher',BrainCircuit],['chat','AI Chat',MessageCircle],['nova-brain','Nova Brain',Brain],['mentor','AI Mentor',Sparkles]]},
  {id:'community',label:'More',items:[['community','Community',Users],['achievements','Achievements',Trophy],['career','Career',Briefcase],['about','About NovaTutor',Lightbulb],...(role==='ADMIN'?[['admin','Admin Panel',WandSparkles]]:[])]},
 ];
 const navActiveGroup=navModel.find(g=>g.items.some(([id])=>id===page))?.id;
 const logout=()=>{if(role!=='GUEST'){persistBeforeNavigation('logout')}else{api('/auth/guest',{method:'DELETE'}).catch(()=>{})}clearUserClientState(user)};
 const switchAccount=()=>{if(role!=='GUEST'){persistBeforeNavigation('switch-account')}else{api('/auth/guest',{method:'DELETE'}).catch(()=>{})}clearUserClientState(user)};
 const updateUser=next=>{const normalized={...(user||{}),...(next||{}),role:String(next?.role||user?.role||'STUDENT').toUpperCase()};localStorage.setItem('ai_user',JSON.stringify(normalized));setUser(normalized)};
 if(!user)return <Auth onLogin={u=>{invalidatePendingSessionRefresh();bootstrappedUserRef.current=null;inAppNavCountRef.current=0;const next={...u,role:String(u.role||'STUDENT').toUpperCase()};resetTransientLearningState(next.id);localStorage.removeItem('nova_nav_stack');const needsProfile=next.role==='STUDENT'&&next.profileComplete===false;const target=needsProfile?'onboarding':'dashboard';localStorage.setItem('ai_user',JSON.stringify(next));localStorage.setItem('nova_page',target);setUser(next);setPage(target);window.location.replace('#/'+target)}} dark={dark} setDark={setDark}/>;
 return <div className="app app-topnav">
 <TopNav
  user={user} role={role} page={page} go={go} dark={dark} setDark={setDark}
  navModel={navModel} activeGroup={navActiveGroup} mobile={mobile} setMobile={setMobile} vp={vp}
  logout={logout} aiConfigured={aiStatus.configured}
 />
 {mobile&&<div className="nav-shade" onClick={()=>setMobile(false)}/>}
 <main className="main-topnav">
 {wakingServer&&<div className="nv-toast" role="status">Waking up NovaTutor server… this can take a few seconds after idle.</div>}
 <div className="page-transition"><ErrorBoundary key={page}><React.Suspense fallback={<div className="skeleton" style={{minHeight:'240px',margin:'24px 0'}}/>}>{adminDenied&&<div className="nv-toast" role="status">Admin area is restricted to administrator accounts.</div>}{page==='dashboard'&&<Dashboard courses={courses} progress={progress} go={go} openCourse={openCourse} user={user}/>} {page==='course'&&<CoursePage courseId={courseId} lessonId={lessonId} onSelectLesson={lid=>openLesson(courseId,lid)} courses={courses} progress={progress} refresh={load} onBack={()=>inAppNavCountRef.current>0?window.history.back():go('courses')}/>} {page==='coach'&&<NovaCoach user={user} go={go} courses={courses}/>} {page==='study-room'&&<NovaCoach user={user} go={go} courses={courses} initialTab="community"/>} {page==='analytics'&&<Analytics user={user}/>} {page==='nova-os'&&<NovaBrain user={user} go={go}/>} {page==='nova-brain'&&<NovaBrain user={user} go={go}/>} {page==='practice'&&<PracticeHub courses={courses} progress={progress} refresh={load} user={user} go={go}/>} {page==='prepare'&&<PrepareHub user={user} go={go} gateTab={gateTab} onGateTab={onGateTab} dsaSlug={dsaSlug} onDsaSlug={onDsaSlug}/>} {page==='courses'&&<MyLearningHub courses={courses} progress={progress} refresh={load} user={user} go={go} openCourse={openCourse}/>} {page==='learning-studio'&&<LearningStudio user={user} routeTab={studioTab} onRouteTab={onStudioTab}/>} {page==='tutor'&&<LearningStudio user={user} initialTab="teacher" onRouteTab={onStudioTab}/>} {page==='code'&&<CodeLab user={user}/>} {page==='quiz'&&<Quiz courses={courses} progress={progress} refresh={load} user={user}/>} {page==='chat'&&<ChatWorkspace user={user}/>} {page==='knowledge'&&<KnowledgeHub user={user}/>}
 {page==='mentor'&&<AdaptiveMentor user={user} courses={courses}/>} {page==='planner'&&<StudyPlanner user={user}/>} {page==='flashcards'&&<Flashcards user={user}/>} {page==='achievements'&&<Achievements user={user} go={go}/>} {page==='profile'&&<AILearningProfile user={user} courses={courses} go={go}/>} {page==='interview'&&<Interviewer user={user}/>} {page==='voice'&&<LearningStudio user={user} initialTab="voice" onRouteTab={onStudioTab}/>} {page==='dpp'&&<CourseDppIde user={user} courses={courses}/>} {page==='exam'&&<ExamSimulator user={user}/>} {page==='gatecse'&&<GateCse routeTab={gateTab} onRouteTab={onGateTab}/>} {page==='dsa'&&<DsaPractice user={user} api={api} routeSlug={dsaSlug} onRouteSlug={onDsaSlug}/>} {page==='career'&&<CareerHub user={user} go={go}/>} {page==='community'&&<CommunityHub user={user} go={go}/>} {page==='notifications'&&<TodayHub user={user} go={go}/>} {page==='revision'&&<RevisionHub user={user} go={go}/>} {page==='settings'&&<SettingsPage user={user} dark={dark} setDark={setDark} logout={logout} switchAccount={switchAccount} onUserUpdate={updateUser} aiStatus={aiStatus}/>} {page==='about'&&<PublicPage page="about" signedIn onBack={()=>go('dashboard')}/>} {page==='privacy'&&<PublicPage page="privacy" signedIn onBack={()=>go('settings')}/>} {page==='terms'&&<PublicPage page="terms" signedIn onBack={()=>go('settings')}/>} {page==='contact'&&<PublicPage page="contact" signedIn onBack={()=>go('dashboard')}/>} {page==='admin'&&(role==='ADMIN'?<Admin user={user} courses={courses} refreshCourses={load} onBack={()=>go('dashboard')}/>:<AdminLocked go={go}/>)}</React.Suspense></ErrorBoundary></div></main></div>
}
function readHashRoute(){
 const raw=String(window.location.hash||'').replace(/^#\/?/,'');
 const [path,query]=raw.split('?');
 return {path:(path||'').toLowerCase(),params:new URLSearchParams(query||'')};
}

function courseIdFromHash(){
 return parseAppHash(window.location.hash).courseId;
}

/* Google Identity Services button. The backend verifies the returned ID token
   against Google's JWKS; this component never sends an email or identity of
   its own. It only mounts when the server reports a configured client id, so
   there is never a dead "Continue with Google" control. */
function GoogleSignIn({clientId,onCredential,onError}){
 const hostRef=useRef(null);
 const credentialRef=useRef(onCredential);
 const errorRef=useRef(onError);
 credentialRef.current=onCredential;
 errorRef.current=onError;
 useEffect(()=>{
  if(!clientId||!hostRef.current)return;
  let cancelled=false;
  const init=()=>{
   if(cancelled||!hostRef.current||!window.google?.accounts?.id)return;
   window.google.accounts.id.initialize({
    client_id:clientId,
    auto_select:false,
    cancel_on_tap_outside:true,
    callback:response=>{
     if(response?.credential)credentialRef.current(response.credential);
     else errorRef.current?.('Google sign-in was cancelled.');
    }
   });
   window.google.accounts.id.renderButton(hostRef.current,{
    theme:document.documentElement.classList.contains('dark')?'filled_black':'outline',
    size:'large',width:320,text:'continue_with',shape:'rectangular',logo_alignment:'left'
   });
  };
  if(window.google?.accounts?.id){init();return ()=>{cancelled=true}}
  const existing=document.getElementById('gsi-client');
  if(existing){existing.addEventListener('load',init);return ()=>{cancelled=true;existing.removeEventListener('load',init)}}
  const script=document.createElement('script');
  script.id='gsi-client';script.src='https://accounts.google.com/gsi/client';script.async=true;script.defer=true;
  script.onload=init;
  script.onerror=()=>errorRef.current?.('Google sign-in could not load. Check your connection and try again.');
  document.head.appendChild(script);
  return ()=>{cancelled=true};
 },[clientId]);
 return <div className="google-signin" ref={hostRef}/>;
}

function NovaFooter({onNavigate,compact=false}){
 const links=[['about','About us'],['contact','Contact & support'],['privacy','Privacy policy'],['terms','Terms & conditions']];
 return <footer className={'nova-footer'+(compact?' nova-footer-compact':'')}>
  <div className="nova-footer-brand"><BrandMark size={22}/><span><b>NovaTutor</b><small>THE LEARNING WORKSPACE</small></span></div>
  <nav className="nova-footer-links" aria-label="Company">
   {links.map(([id,label])=><button key={id} type="button" onClick={()=>onNavigate(id)}>{label}</button>)}
  </nav>
  <p className="nova-footer-copy">© {new Date().getFullYear()} NovaTutor. Built for focused, accessible learning.</p>
 </footer>;
}

const PUBLIC_CONTENT={
 about:{
  eyebrow:'ABOUT NOVATUTOR',
  title:<>Learning should feel <span>clear, personal and possible.</span></>,
  intro:'NovaTutor is an independent learning workspace for students preparing for university courses, GATE CSE, placements and self-directed study. It brings lessons, practice, revision, coding and an AI teacher into one calm place.',
  sections:[
   ['Why NovaTutor exists','Most study tools optimise for content volume. Students rarely lack material; they lack a clear next step. NovaTutor starts from the learner\'s goal, recent practice and weak concepts, then recommends one useful action instead of an endless catalogue.'],
   ['The learning problem it solves','Learning is fragmented across notes, videos, PDFs, quizzes and code editors. Progress is hard to see and easy to lose. NovaTutor keeps the learning loop — learn, practice, detect, explain, revise, master — in one workspace, and records real activity instead of inventing streak data.'],
   ['What you can do today','Structured courses and lessons; adaptive quizzes and daily practice problems; GATE CSE notes and practice; a DSA judge with real execution verdicts; AI Teacher, AI Chat and an adaptive mentor; flashcards, a study planner, revision queues and analytics.'],
   ['An honest AI tutor','Nova explains, asks and gives feedback, but it is not a replacement for a teacher or an official exam authority. Answers are generated by a language model and can be wrong. NovaTutor keeps the API key server-side, bounds requests, and never fabricates a response when the provider is unavailable.'],
   ['Our mission','Make high-quality guided learning available to students who cannot afford expensive coaching, without locking their progress behind a paywall. The product is built to run on free-tier infrastructure so it can stay accessible while it grows.']
  ]
 },
 privacy:{
  eyebrow:'PRIVACY POLICY',
  title:<>Your data, <span>plainly explained.</span></>,
  intro:'This policy describes what NovaTutor actually stores today. It is written to be read, not to hide behind legal language.',
  sections:[
   ['What we collect','Account details you provide (name, email, password hash), optional learning profile answers, learning activity such as lessons completed, quiz attempts, DSA submissions, flashcards and study sessions, AI conversation content you submit, and basic technical logs needed to operate the service.'],
   ['How it is used','To sign you in, personalise recommendations, show your progress, operate the AI features you request, secure the platform, and diagnose failures. We do not sell personal data and we do not use it for advertising.'],
   ['Passwords and tokens','Passwords are stored only as BCrypt hashes. Email verification and password reset tokens are stored as SHA-256 hashes, expire, and can be used once. API keys for AI and email providers remain server-side.'],
   ['AI processing','When you use an AI feature, the text you submit is sent to the configured AI provider so it can generate a response. Do not submit sensitive personal information. AI responses are not used to train NovaTutor models.'],
   ['Storage and retention','Data is stored in the application database and, for some interface preferences, in your browser. You can request deletion of your account and learning data through the support channel.'],
   ['Your choices','You can edit your profile, change your AI language preference, switch appearance, and sign out at any time. Contact support to request export or deletion.']
  ]
 },
 terms:{
  eyebrow:'TERMS & CONDITIONS',
  title:<>Fair use of <span>a learning tool.</span></>,
  intro:'By using NovaTutor you agree to these terms. They exist to keep the platform useful and safe for everyone.',
  sections:[
   ['Your account','Provide accurate information, keep your password private, and do not share your account. You are responsible for activity under your account. Accounts may be suspended for abuse or attempts to disrupt the service.'],
   ['Acceptable use','Do not submit malicious code, attempt to break the sandbox, scrape the service, attack other users, upload illegal content, or use the AI features to generate harmful material. Coding submissions run in an isolated external sandbox and may be rate-limited.'],
   ['Educational content','Lessons, practice questions and AI answers are study aids. They may contain mistakes. Always verify important facts, exam rules and official syllabus details with an authoritative source.'],
   ['AI limitations','AI output is probabilistic and can be incomplete or incorrect. NovaTutor does not guarantee any exam result or outcome. Never rely on it for medical, legal or financial decisions.'],
   ['Availability','The service runs on free-tier infrastructure and may be unavailable during maintenance, provider outages or rate limits. Features can change as the product evolves.'],
   ['Changes','These terms may be updated as the product changes. Continued use after an update means you accept the revised terms.']
  ]
 },
 contact:{
  eyebrow:'CONTACT & SUPPORT',
  title:<>Talk to a <span>real person.</span></>,
  intro:'NovaTutor is maintained by a small independent team. The fastest way to report a bug, request account deletion, or ask a question is the public issue tracker.',
  sections:[
   ['Issue tracker','Open an issue at github.com/ipiyushpandey/NovaTutor/issues. Include what you expected, what happened, and the page you were on. Never paste passwords, tokens or personal data into an issue.'],
   ['Account and privacy requests','For account deletion or a data request, open an issue titled "Account request" from the email associated with your account. We will confirm ownership before acting.'],
   ['Security reports','If you believe you found a security vulnerability, report it privately through GitHub security advisories rather than a public issue, and include reproduction steps.'],
   ['Response expectations','This is a volunteer-maintained project, so responses may take a few days. Clear reports with reproduction steps are handled first.']
  ]
 }
};

function PublicPage({page,onBack,signedIn=false}){
 const content=PUBLIC_CONTENT[page]||PUBLIC_CONTENT.about;
 return <div className="public-page">
  <header className="public-head">
   <button className="public-brand" onClick={onBack}><BrandMark size={28}/><span><b>NovaTutor</b><small>THE LEARNING WORKSPACE</small></span></button>
   <button className="secondary compact" onClick={onBack}>{signedIn?'Back to dashboard':'Back to sign in'}</button>
  </header>
  <main className="public-main">
   <span className="eyebrow">{content.eyebrow}</span>
   <h1>{content.title}</h1>
   <p className="public-intro">{content.intro}</p>
   <div className="public-sections">{content.sections.map(([title,body],i)=><section key={title} style={{'--i':i}}><h2>{title}</h2><p>{body}</p></section>)}</div>
   {page==='contact'&&<a className="primary public-cta" href="https://github.com/ipiyushpandey/NovaTutor/issues" target="_blank" rel="noreferrer">Open the issue tracker</a>}
  </main>
  <NovaFooter onNavigate={id=>{window.location.hash='/'+id}}/>
 </div>;
}

function Auth({onLogin,dark,setDark}){
 const [mode,setMode]=useState('login');
 const [adminMode,setAdminMode]=useState(false);
 const [form,setForm]=useState({name:'',email:'',password:'',confirm:''});
 const [err,setErr]=useState('');
 const [notice,setNotice]=useState('');
 const [loading,setLoading]=useState(false);
 const [showPass,setShowPass]=useState(false);
 const [providers,setProviders]=useState({googleEnabled:false,googleClientId:'',emailDeliveryConfigured:null});
 const [pending,setPending]=useState(null);
 const [token,setToken]=useState('');
 const [verifyState,setVerifyState]=useState(null);
 const [publicPage,setPublicPage]=useState(()=>{const r=readHashRoute();return PUBLIC_CONTENT[r.path]?r.path:''});

 useEffect(()=>{
  api('/auth/providers').then(setProviders).catch(()=>setProviders({googleEnabled:false,googleClientId:'',emailDeliveryConfigured:null}));
 },[]);

 useEffect(()=>{
  const sync=()=>{
   const route=readHashRoute();
   if(PUBLIC_CONTENT[route.path]){setPublicPage(route.path);return}
   setPublicPage('');
   if(route.path==='verify-email'){
    const t=route.params.get('token')||'';
    setToken(t);setMode('verify');setVerifyState(null);setErr('');
    if(!t){setVerifyState({ok:false,message:'This verification link is missing its token.'});return}
    api('/auth/verify-email',{method:'POST',body:JSON.stringify({token:t})})
     .then(r=>setVerifyState({ok:true,message:r?.message||'Your email is verified. You can sign in now.'}))
     .catch(e=>setVerifyState({ok:false,message:e.message||'This verification link could not be verified.'}));
    return;
   }
   if(route.path==='reset-password'){
    const t=route.params.get('token')||'';
    setToken(t);setMode('reset');setErr('');setNotice('');
    if(!t)setErr('This reset link is missing its token. Request a new one.');
   }
  };
  sync();
  window.addEventListener('hashchange',sync);
  return ()=>window.removeEventListener('hashchange',sync);
 },[]);

 function navigatePublic(id){window.location.hash='/'+id}

 async function submit(e){
  e.preventDefault();
  if(loading)return;
  setErr('');setNotice('');
  if(mode==='register'&&form.password!==form.confirm){setErr('Passwords do not match.');return}
  setLoading(true);
  try{
   if(mode==='login'){
    const result=await api('/auth/login',{method:'POST',body:JSON.stringify({email:form.email,password:form.password,portal:adminMode?'admin':'student'}),timeoutMs:25000});
    onLogin(result);
   }else if(mode==='register'){
    const result=await api('/auth/register',{method:'POST',body:JSON.stringify({name:form.name,email:form.email,password:form.password})});
    setPending(result);setMode('pending');
   }else if(mode==='forgot'){
    const result=await api('/auth/forgot-password',{method:'POST',body:JSON.stringify({email:form.email})});
    setNotice(result?.message||'If an account exists for that email, a reset link has been sent.');
   }else if(mode==='reset'){
    const result=await api('/auth/reset-password',{method:'POST',body:JSON.stringify({token,password:form.password})});
    setNotice(result?.message||'Your password has been changed. Sign in with the new password.');
    setMode('login');setForm(f=>({...f,password:'',confirm:''}));
   }
  }catch(x){
   if(x.code==='EMAIL_UNVERIFIED'){
    setPending({email:form.email,verificationSent:false,
      emailDeliveryConfigured:typeof providers.emailDeliveryConfigured==='boolean'?providers.emailDeliveryConfigured:null,
      message:x.message});
    setMode('unverified');
   }else setErr(x.message||'Could not continue. Please try again.');
  }finally{setLoading(false)}
 }

 async function resend(){
  const email=pending?.email||form.email;
  if(!email||loading)return;
  setLoading(true);setErr('');setNotice('');
  try{
   const r=await api('/auth/resend-verification',{method:'POST',body:JSON.stringify({email})});
   setPending(p=>({...(p||{email}),email,
     verificationSent:Boolean(r?.sent),
     emailDeliveryConfigured:typeof r?.emailDeliveryConfigured==='boolean'?r.emailDeliveryConfigured:(p?.emailDeliveryConfigured??null)}));
   setNotice(r?.message||'If an unverified account exists for that address, a new link has been sent.');
  }catch(x){setErr(x.message||'Could not resend the verification email.')}
  finally{setLoading(false)}
 }

 async function startGuest(){
  if(loading)return;
  setErr('');setNotice('');setLoading(true);
  try{
   const result=await api('/auth/guest',{method:'POST',timeoutMs:25000});
   onLogin({...result,profileComplete:false});
  }catch(x){setErr(x.message||'Guest mode could not start. Please try again.')}
  finally{setLoading(false)}
 }

 async function googleSignIn(credential){
  if(loading)return;
  setErr('');setLoading(true);
  try{
   const result=await api('/auth/google',{method:'POST',body:JSON.stringify({credential})});
   onLogin(result);
  }catch(x){setErr(x.message||'Google sign-in failed. Check that this browser allows Google sign-in, then retry.')}
  finally{setLoading(false)}
 }

 if(publicPage) return <PublicPage page={publicPage} onBack={()=>{window.location.hash='/login';setPublicPage('')}}/>;

 const isAuthForm=['login','register','forgot'].includes(mode);
 const deliveryUnavailable=pending?.emailDeliveryConfigured===false
   ||(pending?.emailDeliveryConfigured==null&&providers.emailDeliveryConfigured===false);
 const heading=mode==='login'?(adminMode?'Admin sign in':'Welcome back'):mode==='register'?'Create your account':mode==='forgot'?'Reset your password':mode==='pending'?(deliveryUnavailable?'Email verification is unavailable':'Check your inbox'):mode==='unverified'?(deliveryUnavailable?'Email verification is unavailable':'Verify your email'):'Choose a new password';
 const sub=mode==='login'?(adminMode?'Owner access to the operational control center.':'Continue where you left off.'):mode==='register'?'A few details, then confirm your email to activate your workspace.':mode==='forgot'?'Enter your account email and we will send a single-use link.':mode==='pending'?(deliveryUnavailable?'Your account is created, but this server cannot send verification email yet.':'Email verification keeps accounts secure.'):mode==='unverified'?'Your account exists but this address is not confirmed yet.':'Set a new password for your NovaTutor account.';

 return <div className="auth">
 <BooksScene/>
 <form className="auth-form" onSubmit={submit} noValidate>
  <button type="button" className="auth-theme" onClick={()=>setDark(x=>!x)} aria-label={dark?'Switch to bright mode':'Switch to dark mode'}>{dark?'Bright mode':'Dark mode'}</button>
  <div className="auth-brand"><BrandMark size={32}/><div><b>NovaTutor</b><span>THE LEARNING WORKSPACE</span></div></div>

  {isAuthForm&&<div className="auth-mode" role="group" aria-label="Account type">
   <button type="button" className={mode==='login'&&!adminMode?'selected':''} aria-pressed={mode==='login'&&!adminMode} onClick={()=>{setMode('login');setAdminMode(false);setErr('');setNotice('')}}>Student</button>
   <button type="button" className={mode==='login'&&adminMode?'selected':''} aria-pressed={mode==='login'&&adminMode} onClick={()=>{setMode('login');setAdminMode(true);setErr('');setNotice('')}}>Admin</button>
   <button type="button" className={mode==='register'?'selected':''} aria-pressed={mode==='register'} onClick={()=>{setMode('register');setAdminMode(false);setErr('');setNotice('')}}>Create account</button>
  </div>}

  <h2>{heading}</h2>
  <p className="auth-sub">{sub}</p>
     {err&&<div className="error" role="alert">{err}</div>}
  {notice&&<div className="auth-notice" role="status">{notice}</div>}
  {mode==='forgot'&&deliveryUnavailable&&<div className="auth-warning" role="status">
    <b>Password reset by email is unavailable.</b>
    <span>This server cannot send email yet. Ask an administrator to reset your password from the admin panel, or contact support with your account email.</span>
    <button type="button" className="auth-inline-link" onClick={()=>navigatePublic('contact')}>Contact support</button>
  </div>}

  {mode==='verify'&&<div className="auth-state">
   {!verifyState?<><div className="auth-spinner" aria-hidden="true"/><p>Verifying your email address…</p></>
    :<><div className={'auth-state-icon '+(verifyState.ok?'ok':'bad')}>{verifyState.ok?'✓':'!'}</div><h3>{verifyState.ok?'Email verified':'Verification failed'}</h3><p>{verifyState.message}</p>
      <button type="button" className="primary full" onClick={()=>{window.location.hash='/login';setMode('login');setErr('');setNotice(verifyState.ok?'Email verified. Sign in to continue.':'')}}>Continue to sign in</button>
      {!verifyState.ok&&<button type="button" className="switch" onClick={()=>{setMode('unverified');setPending({email:form.email,emailDeliveryConfigured:typeof providers.emailDeliveryConfigured==='boolean'?providers.emailDeliveryConfigured:null});setErr('')}}>Resend verification email</button>}</>}
  </div>}

  {(mode==='pending'||mode==='unverified')&&<div className="auth-state">
   <div className="auth-state-icon ok">✉</div>
   <h3>{mode==='pending'?'Verify your email to activate your account':'Verify your email'}</h3>
   <p>{deliveryUnavailable?'Your email address is not confirmed yet. This server cannot send the verification email right now, so the account stays locked until email delivery is configured.':(pending?.message||'Check your inbox for the verification link. It expires in 24 hours.')}</p>
   {deliveryUnavailable&&<div className="auth-warning" role="status">
     <b>Email verification is temporarily unavailable.</b>
     <span>Your account is safe, but this server cannot send email yet. An administrator can verify your account manually from the admin panel; contact support with your account email.</span>
     <button type="button" className="auth-inline-link" onClick={()=>navigatePublic('contact')}>Contact support</button>
   </div>}
   <button type="button" className="primary full" disabled={loading||!pending?.email||deliveryUnavailable} onClick={resend}>{loading?'Sending…':'Resend verification email'}</button>
   {deliveryUnavailable&&<p className="auth-note">Resending is disabled until delivery is configured, so you are not shown a false confirmation.</p>}
   <button type="button" className="switch" onClick={()=>{setMode('login');setErr('');setNotice('')}}>Back to sign in</button>
  </div>}

  {isAuthForm&&<>
   {mode==='register'&&<><label className="auth-label" htmlFor="auth-name">Full name</label>
   <input id="auth-name" autoComplete="name" placeholder="Your name" value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></>}
   <label className="auth-label" htmlFor="auth-email">Email</label>
   <input id="auth-email" type="email" autoComplete="email" placeholder="you@example.com" value={form.email} onChange={e=>setForm({...form,email:e.target.value})} required/>
   {mode!=='forgot'&&<><label className="auth-label" htmlFor="auth-pass">{mode==='register'?'Create password':'Password'}</label>
   <div className="auth-pass"><input id="auth-pass" type={showPass?'text':'password'} autoComplete={mode==='login'?'current-password':'new-password'} placeholder="••••••••" value={form.password} onChange={e=>setForm({...form,password:e.target.value})}/><button type="button" className="auth-pass-toggle" onClick={()=>setShowPass(s=>!s)} aria-pressed={showPass} aria-label={showPass?'Hide password':'Show password'}>{showPass?'Hide':'Show'}</button></div></>}
   {mode==='register'&&<><label className="auth-label" htmlFor="auth-confirm">Confirm password</label>
   <input id="auth-confirm" type={showPass?'text':'password'} autoComplete="new-password" placeholder="Repeat your password" value={form.confirm} onChange={e=>setForm({...form,confirm:e.target.value})}/></>}
   {mode==='login'&&!adminMode&&<button type="button" className="auth-inline-link" onClick={()=>{setMode('forgot');setErr('');setNotice('')}}>Forgot your password?</button>}
   <button className="primary full auth-submit" disabled={loading||(mode==='forgot'&&deliveryUnavailable)}>{loading?(mode==='login'?'Signing in…':mode==='register'?'Creating account…':'Sending…'):(mode==='login'?(adminMode?'Sign in to Admin':'Sign in'):mode==='register'?'Create account':deliveryUnavailable?'Email delivery unavailable':'Send reset link')}</button>
   {(mode==='login'||mode==='register')&&!adminMode&&providers.googleEnabled&&<>
    <div className="auth-divider"><span>or</span></div>
    <GoogleSignIn clientId={providers.googleClientId} onCredential={googleSignIn} onError={setErr}/>
    <p className="auth-google-note">Google verifies your email address; no separate verification email is needed.</p>
   </>}
   {mode==='login'&&!adminMode&&<>
    <div className="auth-divider"><span>or</span></div>
    <button type="button" className="secondary full auth-guest" onClick={startGuest} disabled={loading}>Continue as guest</button>
    <p className="auth-note">Guest mode uses a private temporary session. Progress is isolated to this browser session and is deleted after 24 hours.</p>
    <button type="button" className="switch" onClick={()=>{setMode('register');setErr('')}}>New here? Create an account</button>
   </>}
   {mode==='register'&&<button type="button" className="switch" onClick={()=>{setMode('login');setErr('')}}>Already have an account? Sign in</button>}
   {mode==='forgot'&&<button type="button" className="switch" onClick={()=>{setMode('login');setErr('');setNotice('')}}>Back to sign in</button>}
  </>}

  {mode==='reset'&&<>
   <label className="auth-label" htmlFor="auth-new-pass">New password</label>
   <div className="auth-pass"><input id="auth-new-pass" type={showPass?'text':'password'} autoComplete="new-password" placeholder="At least 6 characters" value={form.password} onChange={e=>setForm({...form,password:e.target.value})}/><button type="button" className="auth-pass-toggle" onClick={()=>setShowPass(s=>!s)}>{showPass?'Hide':'Show'}</button></div>
   <button className="primary full auth-submit" disabled={loading||!token}>{loading?'Updating…':'Update password'}</button>
   <button type="button" className="switch" onClick={()=>{setMode('login');setErr('');setNotice('')}}>Back to sign in</button>
  </>}

  <p className="auth-fineprint">By continuing you agree to our <button type="button" onClick={()=>navigatePublic('terms')}>Terms</button> and <button type="button" onClick={()=>navigatePublic('privacy')}>Privacy Policy</button>.</p>
  <NovaFooter onNavigate={navigatePublic} compact/>
 </form>
</div>
}


function Onboarding({user,onComplete}){
 const [form,setForm]=useState({name:user.name||'',educationLevel:'B.Tech / College',learningGoal:'',targetExam:'',interests:'',strengths:'',weaknesses:'',learningStyle:'Visual + practical',dailyStudyMinutes:60,preferredAiLanguage:getAiLanguage()});
 const [step,setStep]=useState(1),[loading,setLoading]=useState(false),[error,setError]=useState('');
 const styles=['Visual + practical','Step-by-step','Practice first','Theory first'];

 function validateStep(s){
  if(s===1){
   if(!isMeaningfulText(form.learningGoal,5,500)){
    return 'Please enter a meaningful learning goal (at least 5 characters, e.g. "GATE CSE & algorithms").';
   }
  }
  if(s===2){
   if(!isMeaningfulText(form.interests,5,500)){
    return 'Please enter your learning interests (at least 5 characters, e.g. "Java, DSA, Cloud").';
   }
   if(!isMeaningfulText(form.weaknesses,5,500)){
    return 'Please describe topics you want to improve (at least 5 characters, e.g. "Dynamic programming").';
   }
   if(!form.learningStyle){
    return 'Please select a learning style.';
   }
  }
  return '';
 }

 function nextStep(){
  const err=validateStep(step);
  if(err){setError(err);return}
  setError('');
  setStep(step+1);
 }

 async function save(){
  const err1=validateStep(1);if(err1){setError(err1);setStep(1);return}
  const err2=validateStep(2);if(err2){setError(err2);setStep(2);return}
  setLoading(true);setError('');
  try{
   const r=await api('/users/'+user.id,{method:'PUT',body:JSON.stringify({...form,dailyStudyMinutes:Number(form.dailyStudyMinutes)})});
   localStorage.setItem(AI_LANGUAGE_KEY,form.preferredAiLanguage);
   onComplete({...user,...r,profileComplete:true});
  }catch(e){
   setError(e.message||'Could not save your learning profile.');
  }finally{
   setLoading(false);
  }
 }
 return <div className="onboarding-page"><div className="onboarding-card"><div className="onboarding-head"><div className="onboarding-orb"><Sparkles size={22}/></div><div><span className="eyebrow">NOVA PERSONALIZATION</span><h1>Let Nova <span>know you.</span></h1><p>Answer a few questions once. Your AI teacher, practice and study recommendations will use this profile.</p></div></div><div className="onboarding-progress"><span className={step>=1?'on':''}/><span className={step>=2?'on':''}/><span className={step>=3?'on':''}/></div>{step===1&&<div className="onboarding-grid"><label>EDUCATION LEVEL<select value={form.educationLevel} onChange={e=>setForm({...form,educationLevel:e.target.value})}><option>B.Tech / College</option><option>School</option><option>Graduate</option><option>Working professional</option><option>Other</option></select></label><label>MAIN GOAL<input value={form.learningGoal} onChange={e=>setForm({...form,learningGoal:e.target.value})} placeholder="e.g. GATE CSE + Java placement preparation"/></label><label>TARGET EXAM <span>optional</span><input value={form.targetExam} onChange={e=>setForm({...form,targetExam:e.target.value})} placeholder="GATE, placement, university exams…"/></label><label>DAILY STUDY TIME<select value={form.dailyStudyMinutes} onChange={e=>setForm({...form,dailyStudyMinutes:e.target.value})}><option value="30">30 minutes</option><option value="60">1 hour</option><option value="90">1.5 hours</option><option value="120">2 hours</option><option value="180">3+ hours</option></select></label></div>}{step===2&&<div className="onboarding-grid"><label>INTERESTS<textarea value={form.interests} onChange={e=>setForm({...form,interests:e.target.value})} placeholder="Java, DSA, AI, web development, GATE…"/></label><label>STRENGTHS<textarea value={form.strengths} onChange={e=>setForm({...form,strengths:e.target.value})} placeholder="What are you already comfortable with?"/></label><label>WEAKNESSES<textarea value={form.weaknesses} onChange={e=>setForm({...form,weaknesses:e.target.value})} placeholder="What topics confuse you or need improvement?"/></label><label>LEARNING STYLE<div className="choice-grid">{styles.map(x=><button type="button" className={form.learningStyle===x?'choice active':'choice'} onClick={()=>setForm({...form,learningStyle:x})} key={x}><b>{x}</b><small>{x==='Visual + practical'?'Diagrams + examples':x==='Step-by-step'?'Slow guided teaching':x==='Practice first'?'Learn by solving':'Concept before practice'}</small></button>)}</div></label></div>}{step===3&&<div className="onboarding-final"><div className="profile-preview"><div className="profile-preview-icon"><BrainCircuit size={24}/></div><div><b>Your Nova profile</b><p><strong>Goal:</strong> {form.learningGoal||'—'}</p><p><strong>Interests:</strong> {form.interests||'—'}</p><p><strong>Weaknesses:</strong> {form.weaknesses||'—'}</p><p><strong>Style:</strong> {form.learningStyle} • <strong>Study:</strong> {form.dailyStudyMinutes} min/day</p></div></div><label>AI TEACHING LANGUAGE<select value={form.preferredAiLanguage} onChange={e=>setForm({...form,preferredAiLanguage:e.target.value})}>{AI_LANGUAGES.map(x=><option key={x}>{x}</option>)}</select></label><div className="visual-teaching-note"><Sparkles size={18}/><div><b>Visual teaching is on</b><small>Nova will prefer diagrams, examples, flowcharts and visual explanations when they make a concept easier to understand.</small></div></div></div>}{error&&<div className="error">{error}</div>}<div className="onboarding-actions">{step>1?<button className="secondary" onClick={()=>setStep(step-1)}>Back</button>:<span/>}{step<3?<button className="primary" onClick={nextStep}>Continue <ChevronRight size={15}/></button>:<button className="primary" onClick={save} disabled={loading}>{loading?'Saving your profile…':'Start my personalized NovaTutor'} <Sparkles size={15}/></button>}</div></div></div>
}
function CourseDppIde({user,courses}){
 const dppInitial=React.useMemo(()=>({courseId:courses[0]?.id||'',dpp:null,answers:{},skipped:{},submitted:false,language:'Java',code:'public class Main {\n    public static void main(String[] args) {\n        System.out.println("Hello NovaTutor");\n    }\n}',analysis:'',ideTask:null}),[courses[0]?.id]);
 const [session,setSession]=useLiveRuntimeSession(user?.id,'practice.dppIde',dppInitial);
 const courseId=session.courseId||courses[0]?.id||'',dpp=session.dpp||null,answers=session.answers||{},skipped=session.skipped||{},submitted=Boolean(session.submitted),language=session.language||'Java',code=session.code||'',analysis=session.analysis||'',ideTask=session.ideTask||null;
 const [htmlPreview,setHtmlPreview]=useState(false);
 const [previewKey,setPreviewKey]=useState(0);
 const previewFrameRef=useRef(null);
 const previewCodeRef=useRef('');
 previewCodeRef.current=code;
 const sendPreviewToIframe=React.useCallback(()=>{
  try{previewFrameRef.current?.contentWindow?.postMessage({type:'nova-ide-render',html:previewCodeRef.current},'*');}catch{}
 },[]);
 const update=React.useCallback((patch)=>setSession(s=>({...s,...(typeof patch==='function'?patch(s):patch)})),[setSession]);
 const setCourseId=x=>update(s=>({courseId:typeof x==='function'?x(s.courseId):x}));
 const setDpp=x=>update(s=>({dpp:typeof x==='function'?x(s.dpp):x}));
 const setAnswers=x=>update(s=>({answers:typeof x==='function'?x(s.answers||{}):x}));
 const setSkipped=x=>update(s=>({skipped:typeof x==='function'?x(s.skipped||{}):x}));
 const setSubmitted=x=>update(s=>({submitted:typeof x==='function'?x(Boolean(s.submitted)):x}));
 const setLanguage=x=>update(s=>({language:typeof x==='function'?x(s.language||'Java'):x}));
 const setCode=x=>update(s=>({code:typeof x==='function'?x(s.code||''):x}));
 const setAnalysis=x=>update(s=>({analysis:typeof x==='function'?x(s.analysis||''):x}));
 const setIdeTask=x=>update(s=>({ideTask:typeof x==='function'?x(s.ideTask||null):x}));
 const [loading,setLoading]=useState(false),[error,setError]=useState(''),[running,setRunning]=useState(false);
 const selected=courses.find(c=>String(c.id)===String(courseId));
 useEffect(()=>{if(!courseId&&courses[0])setCourseId(courses[0].id)},[courses]);
 function starter(lang){return lang==='HTML'?'<h1>Hello NovaTutor</h1>\n<p>Build something great.</p>':lang==='Python'?'print("Hello NovaTutor")':lang==='C++'?'#include <iostream>\nusing namespace std;\nint main(){ cout << "Hello NovaTutor"; }':lang==='JavaScript'?'console.log("Hello NovaTutor");':'public class Main {\n    public static void main(String[] args) {\n        System.out.println("Hello NovaTutor");\n    }\n}'}
 function fallbackDpp(){
   const topic=selected?.title||'the current course';
   return [
    {number:1,type:'MCQ',question:`Which is the best first step when solving a problem in ${topic}?`,options:[{label:'A',text:'Understand the requirements and constraints'},{label:'B',text:'Write random code immediately'},{label:'C',text:'Skip the examples'},{label:'D',text:'Ignore edge cases'}],answer:'A',explanation:'Start by understanding the problem, constraints and expected output.'},
    {number:2,type:'MCQ',question:`Which practice most improves retention while studying ${topic}?`,options:[{label:'A',text:'Passive rereading only'},{label:'B',text:'Active recall and practice'},{label:'C',text:'Skipping difficult topics'},{label:'D',text:'Studying only once'}],answer:'B',explanation:'Active recall and deliberate practice strengthen retrieval and understanding.'},
    {number:3,type:'MCQ',question:`What should you check after completing a ${topic} solution?`,options:[{label:'A',text:'Only the happy path'},{label:'B',text:'Correctness, edge cases and complexity'},{label:'C',text:'Only formatting'},{label:'D',text:'Nothing'}],answer:'B',explanation:'Validate correctness, edge cases and relevant time/space costs.'},
    {number:4,type:'PRACTICAL',question:`Explain one important concept from ${topic} in 3–5 sentences and give one example.`,options:[],answer:'A correct concept explanation with a relevant example.',explanation:'Focus on definition, mechanism and one concrete example.'},
    {number:5,type:'PRACTICAL',question:`Describe how you would approach a medium-level problem from ${topic}. Include the main steps before coding.`,options:[],answer:'A clear sequence of problem understanding, approach, implementation and validation.',explanation:'A good solution starts with reasoning before implementation.'},
    {number:6,type:'PRACTICAL',question:`Challenge: identify one common mistake students make in ${topic} and explain how to avoid it.`,options:[],answer:'A relevant mistake plus a practical prevention strategy.',explanation:'The challenge checks whether the learner can diagnose and prevent mistakes.'}
   ];
 }
 function normalizeDpp(answer){
   if(!answer)return null;
   let text=String(answer).trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
   const candidates=[text];
   const first=text.indexOf('{'),last=text.lastIndexOf('}');if(first>=0&&last>first)candidates.push(text.slice(first,last+1));
   const af=text.indexOf('['),al=text.lastIndexOf(']');if(af>=0&&al>af)candidates.push(text.slice(af,al+1));
   for(const candidate of candidates){try{const parsed=JSON.parse(candidate);const raw=Array.isArray(parsed)?parsed:(Array.isArray(parsed.tasks)?parsed.tasks:Array.isArray(parsed.questions)?parsed.questions:null);if(!raw)continue;const tasks=raw.map((t,i)=>{const options=Array.isArray(t.options)?t.options.map((o,j)=>typeof o==='string'?{label:String.fromCharCode(65+j),text:o}:{label:String(o.label||String.fromCharCode(65+j)).toUpperCase().slice(0,1),text:String(o.text||o.value||o.option||'')}).filter(o=>o.text):[];return {number:i+1,type:String(t.type||'MCQ').toUpperCase().includes('PRACT')?'PRACTICAL':'MCQ',question:String(t.question||t.prompt||t.text||'').trim(),options,answer:String(t.answer||t.correctAnswer||t.correct||'').trim(),explanation:String(t.explanation||t.reason||'').trim()}}).filter(t=>t.question);if(tasks.length>=6)return tasks.slice(0,6)}catch{}}
   const lines=text.split(/\r?\n/),tasks=[];let cur=null;
   for(const raw of lines){const line=raw.trim();if(!line)continue;const m=line.match(/^(?:Q(?:uestion)?\s*)?(\d+)[.)\-:]\s*(.*)$/i);if(m){if(cur)tasks.push(cur);cur={number:Number(m[1]),type:'MCQ',question:m[2],options:[],answer:'',explanation:''};continue}if(!cur)continue;const om=line.match(/^([A-D])[.)\-:]\s*(.+)$/i);if(om){cur.options.push({label:om[1].toUpperCase(),text:om[2]});continue}const km=line.match(/^(?:answer|correct answer|key)\s*[:\-]\s*(.*)$/i);if(km){cur.answer=km[1].trim();continue}const em=line.match(/^(?:explanation|why)\s*[:\-]\s*(.*)$/i);if(em){cur.explanation=em[1];continue}cur.question+=' '+line}
   if(cur)tasks.push(cur);if(tasks.length>=6)return tasks.slice(0,6);return null;
 }
 async function generate(){if(!courseId)return;setLoading(true);setError('');setSubmitted(false);setAnswers({});setSkipped({});setIdeTask(null);setAnalysis('');try{const r=await api('/dpp/generate',{method:'POST',body:JSON.stringify({userId:user.id,courseId:Number(courseId),requestSeed:Date.now()})});let parsed=normalizeDpp(r.answer||'');if(!parsed||parsed.length!==6){await new Promise(resolve=>setTimeout(resolve,250));try{const retry=await api('/dpp/generate',{method:'POST',body:JSON.stringify({userId:user.id,courseId:Number(courseId),requestSeed:Date.now()+1})});parsed=normalizeDpp(retry.answer||'')}catch{} }if(!parsed||parsed.length!==6)parsed=fallbackDpp();setDpp(parsed)}catch(e){setDpp(fallbackDpp());setError('Nova AI is temporarily unavailable, so a practice DPP was loaded automatically.')}finally{setLoading(false)}}
 function setAnswer(n,v){if(submitted)return;setSkipped(prev=>{const next={...prev};delete next[n];return next});setAnswers(prev=>({...prev,[n]:v}))}
 function skipQuestion(n){if(submitted)return;setAnswers(prev=>{const next={...prev};delete next[n];return next});setSkipped(prev=>({...prev,[n]:true}))}
 function resumeQuestion(n){if(submitted)return;setSkipped(prev=>{const next={...prev};delete next[n];return next})}
 function answerWords(value){return String(value||'').toLowerCase().replace(/[^a-z0-9+#.\s]/g,' ').split(/\s+/).filter(w=>w.length>2&&!['the','and','for','with','that','this','from','into','are','was','has','have','your','you','not','can','use','using','what','when','where','how','why','then','than','its','their'].includes(w))}
 function textAnswerCorrect(expected,actual){const a=String(actual||'').trim().toLowerCase(),e=String(expected||'').trim().toLowerCase();if(!a||!e)return false;if(a===e||a.includes(e)||e.includes(a))return true;const keys=[...new Set(answerWords(e))];if(!keys.length)return false;const got=new Set(answerWords(a));const hits=keys.filter(k=>got.has(k)).length;return hits>=Math.max(1,Math.ceil(keys.length*.4))}
 async function submitDpp(){if(!dpp?.length)return;const incomplete=dpp.some((_,i)=>!String(answers[i+1]||'').trim()&&!skipped[i+1]);if(incomplete){setError('Answer or skip every task before submitting.');return}setError('');setSubmitted(true);const earned=resultItems.filter(Boolean).length;const percent=Math.round((earned/dpp.length)*100);try{await api('/intelligence/'+user.id+'/events',{method:'POST',body:JSON.stringify({type:'DPP_COMPLETED',subject:selected?.title||'Course Practice',topic:'Daily Practice Problems',score:percent,durationSeconds:0,details:`Completed DPP: ${earned}/${dpp.length} tasks.`})});window.dispatchEvent(new Event('nova:learning-updated'))}catch{}}
 function scoreTask(t,i){if(skipped[i+1])return false;return textAnswerCorrect(t.answer,answers[i+1])}
 const resultItems=dpp?.map((t,i)=>scoreTask(t,i))||[];
 const totalMarks=dpp?.length||0;
 const earnedMarks=submitted?resultItems.filter(Boolean).length:0;
 const percent=submitted&&totalMarks?Math.round((earnedMarks/totalMarks)*100):0;
 function explainTask(t){setIdeTask(t);setAnalysis('');window.setTimeout(()=>document.querySelector('.course-ide')?.scrollIntoView({behavior:'smooth',block:'start'}),0)}
 async function runCode(){setRunning(true);setAnalysis('');try{if(language==='HTML'){setHtmlPreview(true);setPreviewKey(k=>k+1);setAnalysis(ideTask?`Live preview updated for: ${ideTask.question}`:'HTML preview updated.');return}const taskQuestion=ideTask?.question||'Explain the current course coding task and how to approach it without giving a full copy-paste solution.';const r=await api('/code/analyze',{method:'POST',body:JSON.stringify({mode:'DEBUG',language,level:'intermediate',question:taskQuestion,code,responseLanguage:getAiLanguage()})});setAnalysis(r.answer||'No analysis returned.')}catch(e){setAnalysis(e.message||'Could not analyze code.')}finally{setRunning(false)}}
 return <><div className="page-title"><span className="eyebrow">COURSE PRACTICE SYSTEM</span><h1>DPP <span>& IDE.</span></h1><p>Practice every day inside the course. Nova generates targeted problems from your course and learning profile, then gives you a focused workspace.</p></div>
 <div className="dpp-hero"><div><span className="eyebrow">DAILY PRACTICE PROBLEMS</span><h2>{selected?.title||'Choose a course'} • Today's set</h2><p>6 tasks • 3 concepts • 2 practical problems • 1 challenge</p></div><div className="dpp-hero-actions"><select aria-label="Course" value={courseId} onChange={e=>{setCourseId(e.target.value);setDpp(null);setAnswers({});setSkipped({});setSubmitted(false);setError('');setIdeTask(null);setAnalysis('')}}>{courses.map(c=><option key={c.id} value={c.id}>{c.title}</option>)}</select><button className="primary" onClick={generate} disabled={loading||!courseId}>{loading?'Creating DPP…':'Generate today’s DPP'} <Target size={15}/></button></div></div>
 {error&&<div className="error">{error}</div>}
 <div className="dpp-layout"><section className="panel dpp-card"><div className="panel-head"><div><span className="eyebrow">PERSONALIZED SET</span><h3>Today's DPP</h3></div><CheckCircle2 size={20}/></div>
 {!dpp?<div className="empty"><Target size={42}/><b>Ready for today's practice?</b><span>Generate a fresh DPP. Nova will prioritize your interests and weak areas.</span></div>:<><div className="dpp-status"><span>{submitted?`Result: ${earnedMarks}/${totalMarks} marks • ${percent}%`:'Answer or skip every task, then submit once at the end.'}</span><b>{Object.keys(answers).length+Object.keys(skipped).length}/{dpp.length}</b></div>
 <div className="dpp-navigator"><span className="dpp-nav-label">QUESTIONS</span>{dpp.map((_,i)=>{const n=i+1,done=Boolean(String(answers[n]||'').trim())||Boolean(skipped[n]);return <button type="button" key={n} className={done?'done':''} onClick={()=>document.getElementById(`dpp-q-${n}`)?.scrollIntoView({behavior:'smooth',block:'center'})}>{n}</button>})}</div>{submitted&&<div className="dpp-result-summary"><div><span>YOUR SCORE</span><strong>{earnedMarks}/{totalMarks}</strong></div><div><span>PERCENTAGE</span><strong>{percent}%</strong></div><div><span>STATUS</span><strong>{percent>=80?'Excellent':percent>=60?'Good':'Needs revision'}</strong></div></div>}<div className="dpp-question-list">{dpp.map((t,i)=>{const idx=i+1,result=submitted?scoreTask(t,i):null,opts=Array.isArray(t.options)?t.options:[];return <article id={`dpp-q-${idx}`} className={'dpp-question '+(submitted?(result?'is-correct':'is-wrong'):'')+(skipped[idx]?' is-skipped':'')} key={idx}><div className="dpp-q-head"><span className="dpp-q-number">{String(idx).padStart(2,'0')}</span><span className="dpp-q-type">{t.type==='MCQ'?'CONCEPT':'PRACTICAL'}</span>{submitted&&<span className={'dpp-result '+(result?'ok':'bad')}>{result?'+1 Correct':'0 Wrong'}</span>}</div><h4>{t.question}</h4>{opts.length>=2?<div className="dpp-options">{opts.map(o=><button type="button" key={o.label} disabled={submitted||skipped[idx]} className={'dpp-option '+(answers[idx]===o.label?'selected ':'')+(submitted&&o.label===t.answer?'correct ':'')+(submitted&&answers[idx]===o.label&&o.label!==t.answer?'wrong ':'')} onClick={()=>setAnswer(idx,o.label)}><span>{o.label}</span><b>{o.text}</b></button>)}</div>:<textarea className="dpp-answer" disabled={submitted||skipped[idx]} value={answers[idx]||''} onChange={e=>setAnswer(idx,e.target.value)} placeholder={skipped[idx]?'Skipped — click “Answer this” to return.':'Write your answer / key points here…'}/>}{skipped[idx]&&!submitted&&<div className="dpp-skipped-note">Skipped for now — it will be counted as unanswered/0 marks in the final result unless you return to answer it.</div>}<div className="dpp-question-actions">
 <button className="text-btn" onClick={()=>explainTask(t)}><Code2 size={14}/> Explain this in IDE</button>
 {!submitted&&(skipped[idx]?<button className="dpp-skip-btn" type="button" onClick={()=>resumeQuestion(idx)}>Answer this</button>:<button className="dpp-skip-btn" type="button" onClick={()=>skipQuestion(idx)}>Skip for now</button>)}
 </div>{submitted&&t.explanation&&<div className="dpp-explanation"><Lightbulb size={16}/><span><b>Nova's explanation:</b> {t.explanation}</span></div>}{submitted&&!result&&<div className="dpp-wrong-note">Your answer was marked <b>Wrong</b>. Review the explanation and retry this concept.</div>}</article>})}</div><div className="dpp-submit-bar"><span>{submitted?'All answers submitted. Review your results.':'No answer is marked correct before final submission.'}</span><button className="primary" onClick={submitDpp} disabled={submitted||(Object.keys(answers).length+Object.keys(skipped).length)<dpp.length}>{submitted?'Submitted ✓':'Submit all answers'} <CheckCircle2 size={15}/></button></div></>}</section>
 <section className="panel course-ide"><div className="panel-head"><div><span className="eyebrow">COURSE IDE</span><h3>{ideTask?'Explain this DPP question.':'Build, test, improve.'}</h3>{ideTask&&<small className="ide-task-label">{ideTask.question}</small>}</div><Code2 size={20}/></div><div className="ide-toolbar"><select aria-label="Language" value={language} onChange={e=>{setLanguage(e.target.value);setCode(starter(e.target.value));setHtmlPreview(false);setAnalysis('')}}><option>Java</option><option>HTML</option><option>CSS</option><option>JavaScript</option><option>Python</option><option>C++</option></select><span>{ideTask?'Question-specific guidance':'Choose a question from the DPP to get targeted guidance'}</span><button className="secondary" onClick={()=>setCode(starter(language))}>Starter code</button></div>
 <div className="ide-howto"><b>How to use the Course IDE</b><span>1. Pick a language → 2. Choose a DPP question → 3. Write or edit code → 4. Run/Analyze → 5. Use Nova's feedback to improve.</span></div>
 <textarea aria-label="Code editor" className="course-ide-editor" value={code} onChange={e=>setCode(e.target.value)} spellCheck="false"/><div className="ide-actions"><button className="primary" onClick={runCode} disabled={running}>{running?'Analyzing…':language==='HTML'?'Run preview':'Explain & analyze'} <PlayCircle size={15}/></button><button className="secondary" onClick={()=>{setCode('');setAnalysis('');setHtmlPreview(false)}}>Clear</button></div>{htmlPreview&&language==='HTML'&&<iframe key={previewKey} ref={previewFrameRef} title="NovaTutor HTML preview" className="html-preview" sandbox="allow-scripts" referrerPolicy="no-referrer" allow="" src="/ide-preview.html" onLoad={sendPreviewToIframe}/>} {analysis&&<div className="ide-analysis"><b>Nova IDE feedback</b><AiMarkdown content={analysis}/></div>}</section></div></>
}

function Admin({user,courses,refreshCourses,onBack}){ return <AdminControlCenter user={user} courses={courses} refreshCourses={refreshCourses} api={api} onBack={onBack}/> }
function AdminLocked({go}){return <div className="admin-locked"><div className="locked-orb"><WandSparkles size={34}/></div><span className="eyebrow">OWNER AREA</span><h1>Admin <span>Control Center</span></h1><p>This module is protected. Sign in with the configured owner account to manage courses and students.</p><div className="locked-note">👑 Owner account is configured through the deployment environment.</div><button className="primary" onClick={()=>go('settings')}>Open Settings <ChevronRight size={15}/></button></div>}

function Analytics({user}){
 const [data,setData]=useState(null),[error,setError]=useState(''),[goal,setGoal]=useState(()=>Number(localStorage.getItem('daily_goal')||60));
 useModulePersistence(user?.id,'analytics',{goal},{goal:x=>setGoal(Number(x)||60)});
 const loadAnalytics=(showLoading=false)=>{if(showLoading)setData(null);setError('');api('/analytics/'+user.id).then(setData).catch(e=>setError(e.message))};
 useEffect(()=>{
  loadAnalytics(true);
  const timer=setInterval(()=>{if(!document.hidden)loadAnalytics(false)},60000);
  const refresh=()=>loadAnalytics(false);
  const onVis=()=>{if(!document.hidden)loadAnalytics(false)};
  window.addEventListener('nova:learning-updated',refresh);
  document.addEventListener('visibilitychange',onVis);
  return()=>{clearInterval(timer);window.removeEventListener('nova:learning-updated',refresh);document.removeEventListener('visibilitychange',onVis)};
 },[user.id]);
 if(error)return <div className="page-crash"><RefreshCw size={40}/><h2>Analytics could not load</h2><p>{error}</p><button className="primary" onClick={loadAnalytics}>Retry</button></div>;
 if(!data)return <div className="empty-page"><RefreshCw/><h3>Loading your learning analytics…</h3><p>We're calculating your progress from saved course activity.</p></div>;
 const max=Math.max(1,...data.courses.map(c=>c.percent));
 return <>
  <div className="page-title"><span className="eyebrow">LEARNING INTELLIGENCE</span><h1>Your <span>Analytics.</span></h1><p>See what you've learned, where you're strong and what to tackle next.</p></div>
  <div className="analytics-hero">
   <div className="level-card"><div className="level-ring"><b>{data.level}</b><small>LEVEL</small></div><div><span className="eyebrow">CURRENT LEVEL</span><h2>Keep building momentum.</h2><p>{data.xp.toLocaleString()} XP earned from completed learning activity.</p></div></div>
   <div className="goal-card"><div><span className="eyebrow">DAILY STUDY GOAL</span><h3>{goal} min</h3></div><input aria-label="Daily study goal in minutes" type="range" min="15" max="180" step="15" value={goal} onChange={e=>{setGoal(Number(e.target.value));localStorage.setItem('daily_goal',e.target.value)}}/><small>Set a realistic target. We'll use it in future study-planning features.</small></div>
  </div>
  <div className="analytics-stats"><Stat n={data.coursesStarted} t="Courses started"/><Stat n={data.lessonsCompleted} t="Lessons completed"/><Stat n={Math.round(data.overallProgress)+'%'} t="Overall progress"/><Stat n={data.xp.toLocaleString()} t="XP earned"/></div><IntelligencePanel user={user}/>
  <div className="analytics-grid">
   <section className="panel analytics-panel"><div className="panel-head"><div><span className="eyebrow">COURSE HEALTH</span><h3>Progress by course</h3></div><BarChart3 size={20}/></div>
    {data.courses.length===0?<div className="empty"><BookOpen/><b>No course activity yet</b><span>Complete a lesson and your progress will appear here.</span></div>:<div className="course-bars">{data.courses.map(c=><div className="bar-row" key={c.courseId}><div><b>{c.title}</b><span>{c.completedLessons}/{c.totalLessons} lessons</span></div><div className="bar"><i style={{width:(c.percent/max*100)+'%'}}/></div><strong>{Math.round(c.percent)}%</strong></div>)}</div>}
   </section>
   <section className="panel badge-panel"><div className="panel-head"><div><span className="eyebrow">ACHIEVEMENTS</span><h3>Your badges</h3></div><Trophy size={20}/></div>
    {data.badges.length?<div className="badges">{data.badges.map(b=><div className="badge" key={b}><div><Trophy size={18}/></div><b>{b}</b><small>Unlocked</small></div>)}</div>:<div className="empty"><Trophy/><b>Your first badge is waiting</b><span>Complete your first lesson to unlock it.</span></div>}
   </section>
  </div>
 </>
}
function IntelligencePanel({user}){const [data,setData]=useState(null),[loading,setLoading]=useState(true);const load=()=>{setLoading(true);api('/intelligence/'+user.id).then(setData).catch(()=>setData(null)).finally(()=>setLoading(false))};useEffect(load,[user.id]);if(loading)return <section className="panel intelligence-panel"><div className="panel-head"><div><span className="eyebrow">MEMORY ENGINE</span><h3>Learning memory is updating…</h3></div><RefreshCw size={19}/></div></section>;if(!data)return null;return <section className="panel intelligence-panel"><div className="panel-head"><div><span className="eyebrow">MEMORY ENGINE • V13</span><h3>NovaTutor understands your learning patterns.</h3></div><Brain size={20}/></div><div className="memory-stats"><div><b>{data.learningEvents}</b><span>learning events</span></div><div><b>{data.quizzes}</b><span>quiz attempts</span></div><div><b>{data.studyMinutes}</b><span>study minutes</span></div><div><b>{data.streak}</b><span>day streak</span></div></div><div className="intelligence-columns"><div><span className="eyebrow">WEAKNESS DETECTOR</span>{data.weakAreas?.length?<div className="weak-list">{data.weakAreas.slice(0,4).map((w,i)=><div className="weak-row" key={w.subject+w.topic+i}><div><b>{w.subject}</b><small>{w.topic} • {w.reason}</small></div><strong>{w.accuracy}%</strong></div>)}</div>:<div className="empty small"><CheckCircle2/><b>No weakness detected yet</b><span>Keep taking quizzes and completing lessons.</span></div>}</div><div><span className="eyebrow">NEXT BEST ACTIONS</span><div className="recommendation-list">{data.recommendations?.slice(0,3).map((r,i)=><div className="recommendation" key={r.type+i}><div className="rec-number">{i+1}</div><div><b>{r.title}</b><p>{r.description}</p><small>{r.action}</small></div></div>)}</div></div></div></section>}

function NovaLearningBrain({user,go,courses,sharedIntel,sharedLoading}){
 const usesShared=sharedIntel!==undefined;
 const [ownData,setOwnData]=useState(null); const [ownLoading,setOwnLoading]=useState(!usesShared);
 useEffect(()=>{if(usesShared)return;let alive=true;const load=()=>api('/intelligence/'+user.id).then(x=>{if(alive)setOwnData(x)}).catch(()=>{}).finally(()=>{if(alive)setOwnLoading(false)});load();const on=()=>load();window.addEventListener('nova:learning-updated',on);return()=>{alive=false;window.removeEventListener('nova:learning-updated',on)}},[user.id,usesShared]);
 const data=usesShared?sharedIntel:ownData;
 const loading=usesShared?Boolean(sharedLoading):ownLoading;
 if(loading)return <section className="panel nova-brain loading"><div><span className="eyebrow">NOVA BRAIN</span><h3>Reading your learning signals…</h3><p>Building a next-best-action plan from your real activity.</p></div><RefreshCw className="spin" size={22}/></section>;
 const weak=(data?.weakAreas||[])[0]; const recs=Array.isArray(data?.recommendations)?data.recommendations.slice(0,3):[];
 const goal=user.learningGoal||'your current learning goal';
 const weakName=weak?.subject||weak?.topic||'';
 const primary=recs[0];
 const target=primary?.target|| (weakName?'tutor':'notifications');
 const title=primary?.title|| (weakName?`Strengthen ${weakName} before moving on.`:'Build your next learning session.');
 const desc=primary?.description||`Nova is using your recent activity and profile goal — ${goal} — to choose a focused next step.`;
 return <section className="panel nova-brain reveal hover-lift"><div className="nova-brain-main"><div className="nova-brain-badge"><Brain size={17}/><span>NOVA BRAIN • PERSONALIZED</span></div><h2>{title}</h2><p>{desc}</p><div className="nova-brain-actions"><button className="primary" onClick={()=>go(target)}>{primary?.action||'Start next step'} <ChevronRight size={14}/></button>{weakName&&<button className="secondary" onClick={()=>go('revision')}>Review {weakName} <RotateCcw size={14}/></button>}</div></div><div className="nova-brain-side"><div><span className="eyebrow">LEARNING SIGNAL</span><b>{weakName||'Building profile'}</b><small>{weak?`${weak.accuracy}% recent accuracy • ${weak.reason||'needs focused practice'}`:'Keep learning so Nova can detect patterns.'}</small></div><div className="brain-steps"><span><CheckCircle2 size={13}/> Assess</span><span><Lightbulb size={13}/> Learn</span><span><Target size={13}/> Practice</span><span><RotateCcw size={13}/> Revisit</span></div></div>{recs.length>1&&<div className="nova-recommendations"><span className="eyebrow">MORE FOR YOU</span>{recs.slice(1).map((r,i)=><button key={r.type||r.title||i} onClick={()=>go(r.target||'analytics')}><span>{i+2}</span><div><b>{r.title}</b><small>{r.description}</small></div><ChevronRight size={14}/></button>)}</div>}</section>
}

function GlobalSearch({courses,go}){
 const [q,setQ]=useState(''); const [open,setOpen]=useState(false);
 const navItems=[['dashboard','Home'],['notifications','Today'],['courses','Learn'],['learning-studio','AI Teacher'],['practice','Practice'],['dpp','DPP'],['code','Code Lab'],['revision','Revision'],['knowledge','Knowledge Hub'],['prepare','Prepare'],['gatecse','GATE CSE'],['dsa','DSA Practice'],['nova-brain','Nova Brain'],['analytics','Analytics'],['study-room','Study Room'],['community','Community'],['interview','AI Interviewer'],['career','Career Hub'],['settings','Settings']];
 const term=q.trim().toLowerCase(); const results=term?[...navItems.filter(x=>x[1].toLowerCase().includes(term)).map(x=>({id:x[0],label:x[1],kind:'Module'})),...(courses||[]).filter(c=>String(c.title||'').toLowerCase().includes(term)).slice(0,5).map(c=>({id:'courses',label:c.title,kind:'Course'}))].slice(0,8):[];
 return <div className="global-search"><div className="global-search-input"><FileSearch size={16}/><input value={q} onFocus={()=>setOpen(true)} onChange={e=>{setQ(e.target.value);setOpen(true)}} onKeyDown={e=>{if(e.key==='Escape'){setOpen(false);setQ('')}if(e.key==='Enter'&&results[0]){go(results[0].id);setOpen(false);setQ('')}}} placeholder="Search NovaTutor…" aria-label="Search NovaTutor"/>{q&&<button onClick={()=>{setQ('');setOpen(false)}} aria-label="Clear search">×</button>}</div>{open&&term&&<div className="global-search-results">{results.length?results.map(r=><button key={r.id+r.label} onClick={()=>{go(r.id);setOpen(false);setQ('')}}><span className="search-kind">{r.kind}</span><b>{r.label}</b><ChevronRight size={13}/></button>):<div className="search-empty">No matching NovaTutor module or course.</div>}</div>}</div>
}

function Dashboard({courses,progress,go,openCourse,user}){const [live,setLive]=useState(null),[liveProgress,setLiveProgress]=useState(progress||[]),[intel,setIntel]=useState(null),[intelLoading,setIntelLoading]=useState(true),[intelUpdatedAt,setIntelUpdatedAt]=useState(null);const currentProgress=liveProgress.length?liveProgress:progress;
 /* Dashboard composition (redesign): a calm morning strip, one Continue band
    for the course in progress, a Today block, then secondary sections on
    scroll. Single shared intelligence fetch prevents 3x duplicate /intelligence
    requests and pauses background refresh while the tab is hidden. */
 const total=currentProgress.reduce((a,p)=>a+p.totalLessons,0),done=currentProgress.reduce((a,p)=>a+p.completedLessons,0),pct=total?Math.round(done/total*100):0;
 const visible=courses.slice(0,3);
 useEffect(()=>{
  if(!user?.id)return;
  let alive=true;
  const pull=()=>{
   Promise.allSettled([api('/analytics/'+user.id),api('/progress/'+user.id),api('/intelligence/'+user.id)]).then(([aRes,pRes,iRes])=>{
    if(!alive)return;
    if(aRes.status==='fulfilled')setLive(aRes.value);
    if(pRes.status==='fulfilled'&&Array.isArray(pRes.value))setLiveProgress(pRes.value);
    if(iRes.status==='fulfilled'){setIntel(iRes.value);setIntelUpdatedAt(new Date());}
    setIntelLoading(false);
   });
  };
  pull();
  const timer=setInterval(()=>{if(!document.hidden)pull()},60000);
  const refresh=()=>pull();
  const onVis=()=>{if(!document.hidden)pull()};
  window.addEventListener('nova:learning-updated',refresh);
  document.addEventListener('visibilitychange',onVis);
  return()=>{alive=false;clearInterval(timer);window.removeEventListener('nova:learning-updated',refresh);document.removeEventListener('visibilitychange',onVis)};
 },[user?.id]);
 const hour=new Date().getHours();const dayPhase=hour<12?'Good morning':hour<17?'Good afternoon':'Good evening';
 const dateStr=new Date().toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'});
 const inProgress=currentProgress.map(p=>({p,c:courses.find(c=>c.id===p.courseId)})).filter(x=>x.c&&x.p.percent>0&&x.p.percent<100).sort((a,b)=>b.p.percent-a.p.percent)[0]||null;
 const featured=inProgress||(()=>{const c=courses[0];const p=c?currentProgress.find(x=>x.courseId===c.id):null;return c?{c,p}:{}})();
 const [nextLesson,setNextLesson]=useState(null);
 useEffect(()=>{const courseId=featured?.c?.id;if(!courseId){setNextLesson(null);return}let alive=true;api('/courses/'+courseId).then(d=>{if(!alive)return;const lessons=d?.lessons||[];const idx=Math.min(Number(featured?.p?.completedLessons)||0,Math.max(0,lessons.length-1));setNextLesson(lessons[idx]||null)}).catch(()=>{});return()=>{alive=false}},[featured?.c?.id,featured?.p?.completedLessons]);
 return <>
  <section className="dash-morning reveal">
   <div className="dash-morning-copy"><span className="eyebrow">{dateStr}</span><h1>{dayPhase}, {user.name?.split(' ')[0]||'learner'}</h1></div>
   <div className="dash-morning-meta">
    {/* Unknown ≠ zero: until the analytics/progress payload arrives the chip
        shows an em dash instead of claiming the learner has no streak or XP. */}
    <span className="dash-chip dash-chip--energy" title="Day streak"><Trophy size={13}/>{(live||intel)?`${Number(live?.streak??intel?.streak??0)} day${Number(live?.streak??intel?.streak??0)===1?'':'s'}`:'—'}</span>
    <span className="dash-chip dash-chip--energy" title="Experience points"><BarChart3 size={13}/>{live?`${(live.xp||0).toLocaleString()} XP`:'—'}</span>
    <span className="dash-chip" title="Lessons completed"><BookOpen size={13}/>{total?`${done}/${total} lessons`:'—'}</span>
   </div>
  </section>
  {featured?.c&&<section className="dash-continue reveal hover-lift">
   <div className="dash-continue-main">
    <span className="eyebrow">{inProgress?'CONTINUE WHERE YOU LEFT OFF':'START LEARNING'}</span>
    <h2><span className="dash-continue-icon icon-rotate-subtle" aria-hidden="true">{featured.c.icon}</span>{featured.c.title}</h2>
    <p className="dash-next">{nextLesson?<>Next up · Lesson <b>{(Number(featured?.p?.completedLessons)||0)+1}</b> — {String(nextLesson.title||'').replace(/^Lesson\s*\d+\s*[—–-]\s*/i,'')}</>:'Pick up from your first lesson whenever you are ready.'}</p>
    <div className="dash-continue-progress"><div className="progress slim"><span style={{width:(featured.p?.percent||0)+'%'}}/></div><small>{Math.round(featured.p?.percent||0)}% complete{featured.c.totalLessons?` · ${featured.c.totalLessons} lessons`:''}</small></div>
   </div>
   <div className="dash-continue-action"><button className="primary" onClick={()=>openCourse?openCourse(featured.c.id):go('courses')}>Continue <ChevronRight size={15}/></button><button className="text-btn" onClick={()=>go('courses')}>All courses</button></div>
  </section>}
  <NovaLearningBrain user={user} go={go} courses={courses} sharedIntel={intel} sharedLoading={intelLoading}/>
  <IntelligenceSnapshot user={user} go={go} sharedIntel={intel} sharedUpdatedAt={intelUpdatedAt}/>
  <MasterySnapshot user={user} go={go} sharedIntel={intel}/>
  <div className="section-head reveal"><div><span className="eyebrow">YOUR PATH</span><h3>Continue learning</h3></div><button className="text-btn" onClick={()=>go('courses')}>View all</button></div>
  <div className="course-grid stagger-reveal">{visible.map((c,i)=><CourseCard key={c.id} c={c} p={currentProgress.find(x=>x.courseId===c.id)} openCourse={openCourse} i={i}/>)}{!visible.length&&<div className="empty course-grid-empty"><BookOpen size={28}/><b>No courses to show yet.</b><span>Your library appears here as soon as the catalog is available. The full catalog stays reachable from My Learning.</span><button className="secondary" onClick={()=>go('courses')}>Open My Learning</button></div>}</div>
 </>}
function IntelligenceSnapshot({user,go,sharedIntel,sharedUpdatedAt}){
 const usesShared=sharedIntel!==undefined;
 const [ownData,setOwnData]=useState(null);
 const [ownUpdatedAt,setOwnUpdatedAt]=useState(null);
 useEffect(()=>{
  if(usesShared||!user?.id)return;
  let alive=true;
  const load=async()=>{try{const next=await api('/intelligence/'+user.id);if(alive){setOwnData(next);setOwnUpdatedAt(new Date())}}catch{}};
  load();
  const onUpdate=()=>load();
  window.addEventListener('nova:learning-updated',onUpdate);
  const timer=setInterval(()=>{if(!document.hidden)load()},60000);
  return()=>{alive=false;window.removeEventListener('nova:learning-updated',onUpdate);clearInterval(timer)};
 },[user?.id,usesShared]);
 const data=usesShared?sharedIntel:ownData;
 const updatedAt=usesShared?sharedUpdatedAt:ownUpdatedAt;
 if(!data)return <section className="intelligence-snapshot loading"><div><span className="eyebrow">NOVA INTELLIGENCE</span><h3>Building your learning memory…</h3><p>NovaTutor is learning from your course, quiz and coding activity.</p></div><Brain size={28}/></section>;
 const weak=data.weakAreas?.[0];const rec=data.recommendations?.[0];
 return <section className="intelligence-snapshot reveal"><div className="intel-main"><span className="eyebrow">NOVA INTELLIGENCE • LIVE</span><h3>Here’s what you should do next.</h3><p>{rec?.description||'Keep learning and NovaTutor will personalize your next steps.'}</p><div className="intel-actions">{rec&&<button className="primary" onClick={()=>go(rec.target||'analytics')}>{rec.action}<ChevronRight size={14}/></button>}<button className="secondary" onClick={()=>go('analytics')}>View learning memory</button></div><small className="intel-updated">{updatedAt?`Updated ${updatedAt.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}`:'Updating…'}</small></div><div className="intel-mini"><div><b>{data.streak}</b><span>day streak</span></div><div><b>{data.quizzes}</b><span>quiz attempts</span></div><div><b>{data.studyMinutes}</b><span>study minutes</span></div>{weak&&<div className="intel-weak"><span>Weakest area</span><b>{weak.subject}</b><small>{weak.accuracy}% accuracy</small></div>}</div></section>}
function MasterySnapshot({user,go,sharedIntel}){
 const usesShared=sharedIntel!==undefined;
 const [ownData,setOwnData]=useState(null);
 useEffect(()=>{if(usesShared||!user?.id)return;const load=()=>api('/intelligence/'+user.id).then(setOwnData).catch(()=>{});load();window.addEventListener('nova:learning-updated',load);return()=>window.removeEventListener('nova:learning-updated',load)},[user?.id,usesShared]);
 const data=usesShared?sharedIntel:ownData;
 const items=(data?.mastery||[]).slice(0,5);
 return <section className="mastery-snapshot panel reveal"><div className="panel-head"><div><span className="eyebrow">NOVA BRAIN • MASTERY</span><h3>Know what to improve next</h3><small>Mastery is based on your recent quiz performance and changes as you practice.</small></div><Brain size={20}/></div>{items.length?<div className="mastery-list">{items.map((x,i)=><div className="mastery-row" key={x.subject+i}><div className="mastery-label"><b>{x.subject}</b><small>{x.state} • {x.trend}</small></div><div className="mastery-track"><span style={{width:Math.max(2,Math.min(100,Number(x.accuracy)||0))+'%'}}/></div><strong>{x.accuracy}%</strong></div>)}</div>:<div className="mastery-empty"><Brain size={25}/><div><b>Nova is still learning your pattern.</b><span>Complete a quiz or practice session and your mastery map will appear here.</span></div><button className="secondary" onClick={()=>go('quiz')}>Start a quiz <ChevronRight size={13}/></button></div>}<div className="mastery-footer"><span><CheckCircle2 size={13}/> <b>85%+</b> mastered</span><span><Lightbulb size={13}/> <b>65–84%</b> learning</span><span><Target size={13}/> <b>&lt;65%</b> needs work</span><button className="text-btn" onClick={()=>go('mentor')}>Open adaptive mentor <ChevronRight size={13}/></button></div></section>}


function Stat({n,t}){return <div className="stat"><b>{n}</b><span>{t}</span></div>}
function CourseCard({c,p,openCourse,i}){const percent=Math.round(p?.percent||0);const open=()=>openCourse(c.id);return <div className="course-card hover-lift" onClick={open} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();open()}}} role="button" tabIndex={0}><div className={'course-icon i'+i+' icon-rotate-subtle'}>{c.icon}</div><span className="level">{c.level}</span><h4>{c.title}</h4><p>{c.description}</p><div className="progress"><span style={{width:percent+'%'}}/></div><div className="course-foot"><small>{percent}% complete • {c.totalLessons} lessons</small><button onClick={e=>{e.stopPropagation();open()}}>Open <ChevronRight size={13}/></button></div></div>}
function CoursePage({courseId,lessonId,onSelectLesson,courses,progress,refresh,onBack}){
 const [detail,setDetail]=useState(null),[error,setError]=useState('');
 const summary=courses.find(c=>String(c.id)===String(courseId));
 useEffect(()=>{if(!courseId)return;let alive=true;setDetail(null);setError('');api('/courses/'+courseId).then(d=>{if(alive)setDetail(d)}).catch(e=>{if(alive)setError(e.message||'Could not load course.')});return()=>{alive=false}},[courseId]);
 if(error)return <div className="page-crash"><RefreshCw size={40}/><h2>Course could not load</h2><p>{error}</p><button className="secondary" onClick={onBack}>Back to Home</button></div>;
 if(!detail)return <><div className="page-title"><span className="eyebrow">COURSE</span><h1>{summary?.title||'Opening course…'}</h1><p>Loading lectures for this course.</p></div><div className="lesson-layout"><div className="panel skeleton-card"/><div className="panel skeleton-card"/></div></>;
 return <CourseDetail detail={detail} routeLessonId={lessonId} onSelectLesson={onSelectLesson} progress={progress.find(x=>x.courseId===detail.course.id)} refresh={refresh} back={onBack}/>;
}
function Courses({courses,progress,refresh,user,openCourse}){
 const [selected,setSelected]=useState(()=>{const v=localStorage.getItem('nova_open_course');localStorage.removeItem('nova_open_course');return v?Number(v):null;}),[detail,setDetail]=useState(null),[error,setError]=useState(''),[query,setQuery]=useState(''),[level,setLevel]=useState('All');
 useModulePersistence(user?.id,'courses',{selected:openCourse?null:selected,query,level},{selected:x=>{if(!openCourse)setSelected(x||null)},query:x=>setQuery(x||''),level:x=>setLevel(x||'All')});
 const visible=courses.filter(c=>(!query||c.title.toLowerCase().includes(query.toLowerCase())||c.description?.toLowerCase().includes(query.toLowerCase()))&&(level==='All'||c.level===level));
 useEffect(()=>{
  if(openCourse&&selected){openCourse(selected);setSelected(null);return;}
  if(selected){setError('');setDetail(null);api('/courses/'+selected).then(setDetail).catch(e=>setError(e.message||'Could not load course.'));}
 },[selected,openCourse]);
 const handleOpen=id=>{if(openCourse){openCourse(id)}else{setSelected(id)}};
 if(error)return <div className="page-crash"><RefreshCw size={40}/><h2>Course could not load</h2><p>{error}</p><button className="secondary" onClick={()=>{setError('');setSelected(null)}}>Back</button></div>;
 if(detail)return <CourseDetail detail={detail} progress={progress.find(x=>x.courseId===detail.course.id)} refresh={refresh} back={()=>{setSelected(null);setDetail(null)}}/>;
 return <><div className="page-title"><span className="eyebrow">CURRICULUM</span><h1>My <span>Learning.</span></h1><p>Detailed theory, examples and AI help — no videos required.</p></div><div className="course-filters"><input placeholder="Search courses…" value={query} onChange={e=>setQuery(e.target.value)}/><select aria-label="Level" value={level} onChange={e=>setLevel(e.target.value)}><option>All</option><option>Beginner</option><option>Intermediate</option><option>Advanced</option></select></div>
  {courses.length===0?<div className="empty-page"><BookOpen size={48}/><h3>No courses available yet</h3><p>Courses could not be loaded from the server right now. Check your connection and try reloading.</p><button className="primary" onClick={refresh}>Reload courses</button></div>:<div className="course-grid stagger-reveal">{visible.map((c,i)=><div className="course-card big hover-lift" key={c.id}><div className={'course-icon i'+i+' icon-rotate-subtle'}>{c.icon}</div><span className="level">{c.level}</span><h4>{c.title}</h4><p>{c.description}</p><div className="progress"><span style={{width:(progress.find(x=>x.courseId===c.id)?.percent||0)+'%'}}/></div><div className="course-foot"><small>{progress.find(x=>x.courseId===c.id)?.completedLessons||0}/{c.totalLessons} lessons done</small><button onClick={()=>handleOpen(c.id)}>Open course <ChevronRight size={13}/></button></div></div>)}</div>}
 </>;
}
function TheoryContent({content}){
 const lines=normalizeAiText(content).split('\n'); const out=[]; let list=[]; let code=[]; let inCode=false; let strayFence=false;
 const flushList=()=>{if(list.length){out.push(<ul className="theory-list" key={'l'+out.length}>{list.map((x,i)=><li key={i}>{mdInlineText(x)}</li>)}</ul>);list=[]}};
 const flushCode=()=>{if(code.length){out.push(<pre className="theory-code" key={'c'+out.length}><code>{code.join('\n')}</code></pre>);code=[]}};
 /* Some lesson bodies carry an unbalanced ``` fence, so a prose section such as
    "## Common mistakes" ends up inside a code block. Recover at the presentation
    layer: a Markdown h2+ line inside a fence closes the code block, renders as a
    heading, and the stray closing fence that follows is consumed instead of
    opening a new block. Well-formed fences never contain such a line. */
 lines.forEach((raw,i)=>{const line=raw.trimEnd();if(line.trim().startsWith('```')){if(inCode){flushCode();inCode=false} else if(strayFence){strayFence=false} else {flushList();inCode=true}return}if(inCode){if(/^#{2,6}\s/.test(line)){flushCode();inCode=false;strayFence=true}else{code.push(line);return}}if(!line.trim()){flushList();out.push(<div className="theory-spacer" key={'s'+i}/>);return}if(line.startsWith('### ')){flushList();out.push(<h4 key={i}>{mdInlineText(line.slice(4))}</h4>);return}if(line.startsWith('## ')){flushList();out.push(<h3 key={i}>{mdInlineText(line.slice(3))}</h3>);return}if(line.startsWith('# ')){flushList();out.push(<h2 key={i}>{mdInlineText(line.slice(2))}</h2>);return}if(/^[-*] /.test(line)){list.push(line.slice(2));return}if(/^\d+\. /.test(line)){list.push(line.replace(/^\d+\. /,''));return}out.push(<p key={i}>{mdInlineText(line)}</p>)});flushList();flushCode();return <div className="theory-render">{out}</div>
}

function CourseDetail({detail,routeLessonId,onSelectLesson,progress,refresh,back}){
 const currentUser=readUser();
 const bookmarkKey=`nova_bookmarks_${currentUser?.id||'guest'}`;
 const readBookmarks=()=>{const list=readJSON(bookmarkKey,null);if(Array.isArray(list))return list;const legacy=readJSON('nova_bookmarks',[]);return Array.isArray(legacy)?legacy:[]};
 const topicName=l=>l?.topic||String(l?.title||'Core Concepts').replace(/^Lesson\s+\d+\s*[—-]\s*/,'').replace(/\s*•\s*(Deep Dive|Worked Example|Practice Lab)$/,'').trim()||'Core Concepts';
 // Older seeded courses reuse orderIndex inside each topic. Keep topic order
 // from the API's original lesson insertion order, then sort within each topic.
 const topicGroups=Object.entries((detail.lessons||[]).reduce((acc,l)=>{const key=topicName(l);if(!acc[key])acc[key]=[];acc[key].push(l);return acc},{}));
 const groupedLessons=topicGroups.map(([topic,items])=>[topic,[...items].sort((a,b)=>{const ao=Number(a.orderIndex||0),bo=Number(b.orderIndex||0);return ao-bo||Number(a.id||0)-Number(b.id||0)})]);
 const orderedLessons=groupedLessons.flatMap(([,items])=>items);
 const findInitialLesson=()=>{if(routeLessonId){const hit=(detail.lessons||[]).find(l=>String(l.id)===String(routeLessonId));if(hit)return hit;}return orderedLessons[0]||detail.lessons?.[0]||null;};
 const [working,setWorking]=useState(false),[selectedLesson,setSelectedLesson]=useState(findInitialLesson),[localProgress,setLocalProgress]=useState(progress||null),[error,setError]=useState('');
 const prevRouteLessonIdRef=useRef(routeLessonId);
 useEffect(()=>{
  const prev=prevRouteLessonIdRef.current;
  prevRouteLessonIdRef.current=routeLessonId;
  if(routeLessonId){
   const hit=(detail.lessons||[]).find(l=>String(l.id)===String(routeLessonId));
   if(hit&&String(hit.id)!==String(selectedLesson?.id))setSelectedLesson(hit);
  }else if(prev){
   const first=orderedLessons[0]||detail.lessons?.[0]||null;
   if(first&&String(first.id)!==String(selectedLesson?.id))setSelectedLesson(first);
  }
 },[routeLessonId,detail.lessons]);
 const sequenceFor=lesson=>{const index=orderedLessons.findIndex(x=>String(x.id)===String(lesson?.id));return index<0?1:index+1};
 const lectureLabel=(lesson,index)=>{const raw=String(lesson?.title||'').replace(/^Lesson\s+\d+\s*[—-]\s*/,'').replace(/^Lecture\s+\d+\s*[—-]\s*/,'').trim();return `Lecture ${index+1}${raw?` — ${raw}`:''}`};
 const lectureNumberFor=lesson=>{const topic=topicName(lesson);const group=groupedLessons.find(([name])=>name===topic)?.[1]||[];const index=group.findIndex(x=>String(x.id)===String(lesson?.id));return index<0?1:index+1};
 const cleanLessonContent=content=>String(content||'').replace(/^\s*#{0,6}\s*Lesson\s+\d+\s*[—-]\s*[^\n]+\n?/i,'').replace(/^\s*#{0,6}\s*Lecture\s+\d+\s*[—-]\s*[^\n]+\n?/i,'');
 const [bookmarked,setBookmarked]=useState(()=>readBookmarks().includes(selectedLesson?.id));
 useModulePersistence(currentUser?.id||null,`course-detail-${detail.course.id}`,{selectedLessonId:selectedLesson?.id||null,bookmarked},{selectedLessonId:x=>{if(routeLessonId)return;const found=(detail.lessons||[]).find(l=>String(l.id)===String(x));if(found)setSelectedLesson(found)},bookmarked:x=>setBookmarked(Boolean(x))});
 const c=detail.course;
 useEffect(()=>{setLocalProgress(progress||null)},[progress]);
 useEffect(()=>{setBookmarked(readBookmarks().includes(selectedLesson?.id))},[selectedLesson]);
 async function complete(id){if(working)return null;setWorking(true);setError('');try{const user=readUser();if(!user)throw new Error('Please sign in again.');const result=await api(`/progress/${user.id}/course/${c.id}/lesson/${id}/complete`,{method:'POST',body:'{}'});setLocalProgress(result);if(refresh)refresh();window.dispatchEvent(new Event('nova:learning-updated'));return result}catch(e){setError(e.message||'Could not save progress.');return null}finally{setWorking(false)}}
 function toggleBookmark(){if(!selectedLesson)return;const list=readBookmarks();const next=list.includes(selectedLesson.id)?list.filter(x=>x!==selectedLesson.id):[...list,selectedLesson.id];localStorage.setItem(bookmarkKey,JSON.stringify(next));setBookmarked(!bookmarked)}
 async function launchTeacher(lesson){
  if(!lesson||working)return;
  const lessonContext=String(lesson?.content||'').slice(0,12000);
  const detailedPrompt=`Teach the current lesson clearly and usefully as a personal AI tutor. Give a focused explanation at the student's requested depth: explain the core idea, important steps, useful examples, formulas/code when relevant, common mistakes, and a concise recap. Do not turn this into a full textbook chapter or an exhaustive syllabus. Prioritize the student's current lesson and question.

COURSE: ${c.title}
LESSON: ${lesson.title}

LESSON CONTENT:
${lessonContext}`;
  // SECURITY: the internal teaching prompt (lesson context) must never reach
  // user-visible state. The prefill carries only the short student-facing
  // request for the composer; the internal prompt travels in contextPrompt and
  // is consumed by the AI request builder — never rendered.
  localStorage.setItem('nova_ai_prefill',JSON.stringify({topic:`${c.title} — ${lectureLabel(lesson,Math.max(0,lectureNumberFor(lesson)-1))}`,message:'Explain this lesson clearly with examples and a short recap.',contextPrompt:detailedPrompt,autoAsk:true,lessonId:lesson.id,courseId:c.id,contextKey:`lesson:${c.id}:${lesson.id}`}));
  localStorage.setItem('nova_page','tutor');
  window.dispatchEvent(new Event('nova-go-tutor'));
  setTimeout(()=>window.dispatchEvent(new Event('nova-ai-prefill')),0);
 }
 const askAI=()=>launchTeacher(selectedLesson);
 const completed=Number(localProgress?.completedLessons||0);
 /* Lesson reading experience (redesign): the flat lesson order drives
    prev/next navigation and the completion bar (which calls the existing
    POST /progress/:user/course/:course/lesson/:id/complete endpoint). */
 const flatLessons=useMemo(()=>groupedLessons.flatMap(([,items])=>items),[groupedLessons]);
 const lessonIndex=selectedLesson?flatLessons.findIndex(l=>l.id===selectedLesson.id):-1;
 const prevLesson=lessonIndex>0?flatLessons[lessonIndex-1]:null;
 const nextLesson=lessonIndex>=0&&lessonIndex<flatLessons.length-1?flatLessons[lessonIndex+1]:null;
 const isDone=selectedLesson?sequenceFor(selectedLesson)<=completed:false;
 const [chaptersOpen,setChaptersOpen]=useState(false);
 const gotoLesson=l=>{if(l){setSelectedLesson(l);setChaptersOpen(false);if(onSelectLesson){onSelectLesson(l.id)}else{window.scrollTo({top:0})}}};
 return <><div className="page-title">{back&&<div style={{marginBottom:6}}><button type="button" className="text-btn course-back-btn" onClick={back}>← Back</button></div>}<span className="eyebrow">{c.level} • {c.totalLessons} THEORY LESSONS</span><h1>{c.title}</h1><p>{c.description}</p><div className="course-meta"><span>📚 {detail.lessons?.length||0} lessons</span><span>⏱️ ~{Math.max(5,(selectedLesson?.content||'').split(/\s+/).length/160|0)} min reading</span></div></div>{error&&<div className="error-banner">{error}</div>}<div className={'lesson-layout'+(chaptersOpen?' chapters-open':'')}><div className="lesson-list"><button className="chapters-toggle" onClick={()=>setChaptersOpen(o=>!o)} aria-expanded={chaptersOpen}>{chaptersOpen?'Hide chapters':'Chapters'} <ChevronRight size={14}/></button><div className="lesson-chapters"><div className="lesson-summary"><b>{Math.round(localProgress?.percent||0)}%</b><span>course progress • {detail.lessons?.length||0} lessons</span><div className="progress"><span style={{width:(localProgress?.percent||0)+'%'}}/></div></div>{groupedLessons.map(([topic,items],groupIndex)=><section className="lesson-topic-group" key={topic}><div className="lesson-topic-head"><span>{String(groupIndex+1).padStart(2,'0')}</span><div><b>{topic}</b><small>{items.length} lectures</small></div></div>{items.map((l,lectureIndex)=>{const lDone=sequenceFor(l)<=completed;return <div className={'lesson-item '+(selectedLesson?.id===l.id?'selected':'')+(lDone?' done':'')} key={l.id} onClick={()=>gotoLesson(l)}><div className="lesson-number">{lDone?'✓':lectureIndex+1}</div><div><b>{lectureLabel(l,lectureIndex)}</b><small>{lDone?'Completed • review anytime':'Theory ready • open anytime'}</small></div><button className="icon-btn" disabled={working} onClick={e=>{e.stopPropagation();launchTeacher(l)}} title="Open AI Teacher & learn"><PlayCircle size={18}/></button></div>})}</section>)}</div></div><div className="lesson-ai">{selectedLesson?<><div className="lesson-top-actions"><span className="eyebrow">LECTURE {lectureNumberFor(selectedLesson)} OF {flatLessons.length}</span><button className={'round-btn '+(bookmarked?'saved':'')} onClick={toggleBookmark} title="Bookmark lesson">★</button></div><h3>{lectureLabel(selectedLesson,lectureNumberFor(selectedLesson)-1)}</h3><div className="lesson-reading"><div className="lesson-content">{selectedLesson.content?<TheoryContent content={cleanLessonContent(selectedLesson.content)}/>:<div className="empty"><BookOpen/><b>No lesson content yet</b><span>Ask the AI teacher to explain the topic.</span></div>}</div></div><div className="lesson-bottombar"><button className="nv-icon-btn" disabled={!prevLesson} onClick={()=>gotoLesson(prevLesson)} aria-label="Previous lesson">←</button><button className={'primary '+(isDone?'ghosted':'')} disabled={working} onClick={()=>complete(selectedLesson.id)}>{working?'Saving…':isDone?'✓ Completed':'Mark lesson complete'}</button><button className="nv-icon-btn" disabled={!nextLesson} onClick={()=>gotoLesson(nextLesson)} aria-label="Next lesson">→</button></div><div className="lesson-actions"><button className="secondary" disabled={working} onClick={askAI}><Sparkles size={15}/> Explain with AI</button><button className="secondary" disabled={working} onClick={()=>launchTeacher(selectedLesson)}>{working?'Opening AI Teacher…':'Learn with AI Teacher'} <BrainCircuit size={15}/></button></div></>:<><BrainCircuit size={28}/><h3>Select a lesson</h3><p>Choose a theory lesson from the list.</p></>}</div></div></>;
}
function CodeLab({user}){
 const codeInitial=React.useMemo(()=>({language:'Java',mode:'EXPLAIN',hintLevel:1,code:'public class Main {\n    public static void main(String[] args) {\n        int[] nums = {2, 4, 6, 8};\n        int sum = 0;\n        for (int n : nums) sum += n;\n        System.out.println(sum);\n    }\n}',question:'',level:'beginner',answer:'',runResult:null}),[]);
 const [session,setSession]=useLiveRuntimeSession(user?.id,'practice.codeLab',codeInitial);
 const language=session.language||'Java',mode=session.mode||'EXPLAIN',hintLevel=Number(session.hintLevel)||1,code=session.code||'',question=session.question||'',level=session.level||'beginner',answer=session.answer||'',runResult=session.runResult||null;
 const update=React.useCallback((patch)=>setSession(s=>({...s,...(typeof patch==='function'?patch(s):patch)})),[setSession]);
 const setLanguage=x=>update(s=>({language:typeof x==='function'?x(s.language||'Java'):x}));
 const setMode=x=>update(s=>({mode:typeof x==='function'?x(s.mode||'EXPLAIN'):x}));
 const setHintLevel=x=>update(s=>({hintLevel:typeof x==='function'?x(Number(s.hintLevel)||1):x}));
 const setCode=x=>update(s=>({code:typeof x==='function'?x(s.code||''):x}));
 const setQuestion=x=>update(s=>({question:typeof x==='function'?x(s.question||''):x}));
 const setLevel=x=>update(s=>({level:typeof x==='function'?x(s.level||'beginner'):x}));
 const setAnswer=x=>update(s=>({answer:typeof x==='function'?x(s.answer||''):x}));
 const setRunResult=x=>update(s=>({runResult:typeof x==='function'?x(s.runResult||null):x}));
 const [loading,setLoading]=useState(false),[runLoading,setRunLoading]=useState(false);
 const modes=[['EXPLAIN','Explain'],['DEBUG','Debug'],['FIX','Fix code'],['IMPROVE','Improve'],['HINT','Give hint'],['PRACTICE','Practice']];
 async function run(){if(!code.trim()&&mode!=='PRACTICE')return;setLoading(true);setAnswer('');if(mode==='HINT')setHintLevel(1);try{const r=await api('/code/analyze',{method:'POST',body:JSON.stringify({language,mode,code,question,level,responseLanguage:getAiLanguage()})});setAnswer(r.answer)}catch(e){setAnswer(e.message||'Code AI request failed. Please try again in a moment.')}finally{setLoading(false)}}
 async function execute(){if(!code.trim())return;setRunLoading(true);try{setRunResult(await api('/code/execute',{method:'POST',body:JSON.stringify({language,code,stdin:''})}))}catch(e){setRunResult({status:'ERROR',message:e.message})}finally{setRunLoading(false)}}
 return <><div className="page-title"><span className="eyebrow">V0.7 • ADVANCED CODING TUTOR</span><h1>Code <span>Lab.</span></h1><p>Explain, debug, fix and improve code with an AI mentor that adapts to your level.</p></div><div className="code-lab code-workspace"><div className="code-editor-card"><div className="code-toolbar"><div><b>Workspace</b><small>Write or paste your code</small></div><div className="code-selects"><select aria-label="Language" value={language} onChange={e=>setLanguage(e.target.value)}><option>Java</option><option>Python</option><option>C++</option><option>JavaScript</option><option>SQL</option></select><select aria-label="Level" value={level} onChange={e=>setLevel(e.target.value)}><option value="beginner">Beginner</option><option value="intermediate">Intermediate</option><option value="advanced">Advanced</option></select></div></div><div className="mode-grid code-modes">{modes.map(([id,label])=><button className={'mode '+(mode===id?'active':'')} onClick={()=>setMode(id)} key={id}><Code2 size={15}/><b>{label}</b><small>{id==='EXPLAIN'?'Understand it':id==='DEBUG'?'Find bugs':id==='FIX'?'Repair it':id==='IMPROVE'?'Refactor it':id==='HINT'?'Learn with hints':'Get a challenge'}</small></button>)}</div><label className="code-label">CODE</label><textarea aria-label="Code editor" className="code-area" value={code} onChange={e=>setCode(e.target.value)} spellCheck="false"/><label className="code-label">QUESTION / CONTEXT <span>optional</span></label><input className="code-question" value={question} onChange={e=>setQuestion(e.target.value)} placeholder={mode==='PRACTICE'?'e.g. Give me a Java linked-list problem':'e.g. Why is this loop slow?'}/><button className="primary full" onClick={run} disabled={loading}>{loading?'Analyzing…':'Run Code Mentor'} <Send size={14}/></button><button className="secondary full" onClick={execute} disabled={runLoading||!code.trim()||language==='SQL'} title={language==='SQL'?'SQL sandbox execution is not enabled in this coding runner. Use Code Mentor to analyze SQL.':''}>{runLoading?'Running sandbox…':'Run in Sandbox'} <PlayCircle size={14}/></button>{runResult&&<div className="sandbox-result"><b>{runResult.status==='PASSED'?'Execution successful':runResult.status==='TIMEOUT'?'Time limit exceeded':runResult.status==='RUNTIME_ERROR'?'Runtime / compilation error':runResult.status==='RUNNER_UNAVAILABLE'?'Sandbox unavailable':runResult.status==='SANDBOX_NOT_ENABLED'?'Sandbox not enabled':runResult.status}</b><small>{runResult.message||runResult.stderr||runResult.detail||''}</small>{runResult.stdout&&<pre>{runResult.stdout}</pre>}{runResult.stderr&&runResult.status!=='RUNTIME_ERROR'&&<pre>{runResult.stderr}</pre>}{runResult.status==='SANDBOX_NOT_ENABLED'&&<small>Code execution sandbox is currently disabled on this server. You can still use Run Code Mentor for AI analysis.</small>}{runResult.status==='RUNNER_UNAVAILABLE'&&<small>The code execution runner is temporarily unavailable. Please retry in a moment or use Run Code Mentor.</small>}</div>}</div><div className="code-answer-card"><div className="answer-head"><div className="ai-avatar"><Sparkles size={17}/></div><div><b>Nova Code AI</b><small>{mode==='EXPLAIN'?'Line-by-line learning':mode==='DEBUG'?'Bug detection':mode==='FIX'?'Safe repair':mode==='IMPROVE'?'Code review':mode==='HINT'?'Guided problem solving':'Practice generator'}</small></div></div>{answer?<><div className="answer code-answer"><AiMarkdown content={answer}/></div>{mode==='HINT'&&<div className="hint-ladder"><div><b>Hint ladder</b><small>Reveal help gradually instead of jumping to the solution.</small></div><div className="hint-actions"><button className="secondary" disabled={loading||hintLevel>=3} onClick={async()=>{setHintLevel(2);setLoading(true);try{const r=await api('/ai/ask',{method:'POST',body:JSON.stringify({task:'CODING',topic:question||'Coding problem',message:`Give ONLY the next-level hint (level 2) for this coding task. Do not give code or the final solution. Previous hint was:
${answer}`,level,language:getAiLanguage()})});setAnswer(r.answer||answer)}catch(e){}finally{setLoading(false)}}}>Deeper hint</button><button className="secondary" disabled={loading||hintLevel>=3} onClick={async()=>{setHintLevel(3);setLoading(true);try{const r=await api('/ai/ask',{method:'POST',body:JSON.stringify({task:'CODING',topic:question||'Coding problem',message:`Give the solution approach and pseudocode for this coding task. Do not provide full copy-paste code. Build from the previous hint:
${answer}`,level,language:getAiLanguage()})});setAnswer(r.answer||answer)}catch(e){}finally{setLoading(false)}}}>Show approach</button></div><small className="hint-level">Level {hintLevel} / 3</small></div>}</>:<div className="empty"><Code2 size={42}/><b>Your coding feedback will appear here</b><span>Choose a mode, add code and run the mentor.</span></div>}</div></div></>
}

function AiPanel({task,title,subtitle,icon,user,modeHint}){
 const initialMemory=readTutorMemory(user?.id);
 const initialPrefill=readJSON('nova_ai_prefill',null);
 const initialContextKey=initialPrefill?.contextKey||initialMemory.contextKey||'';
 const usePrefillState=Boolean(initialPrefill?.message);
 const [topic,setTopic]=useState(usePrefillState?(initialPrefill.topic||''):(initialMemory.topic||''));
 const [message,setMessage]=useState(usePrefillState?(initialPrefill.message||''):(initialMemory.message||''));
 // Internal teaching context (lesson content + teaching directives). Held in a
 // ref so it can strengthen the AI request but can never appear in the visible
 // composer, tutor memory, or any rendered output.
 const internalContextRef=useRef(usePrefillState?(initialPrefill.contextPrompt||''):'');
 const [answer,setAnswer]=useState(usePrefillState?'':(initialMemory.contextKey===initialContextKey?(initialMemory.answer||''):''));
 const [contextKey,setContextKey]=useState(initialContextKey);
 const [learningContext,setLearningContext]=useState(null);
 const [studentAnswer,setStudentAnswer]=useState(usePrefillState?'':(initialMemory.contextKey===initialContextKey?(initialMemory.studentAnswer||''):''));
 const [feedback,setFeedback]=useState(usePrefillState?'':(initialMemory.contextKey===initialContextKey?(initialMemory.feedback||''):''));
 const [loading,setLoading]=useState(false);const [checking,setChecking]=useState(false);
 const [answerSubmitted,setAnswerSubmitted]=useState(usePrefillState?false:Boolean(initialMemory.contextKey===initialContextKey&&initialMemory.answerSubmitted));
 const [lessonContext,setLessonContext]=useState(()=>({lessonId:initialPrefill?.lessonId||null,courseId:initialPrefill?.courseId||null,topic:initialPrefill?.topic||''}));
 const [lessonDoubt,setLessonDoubt]=useState('');
 const [lessonDoubtHistory,setLessonDoubtHistory]=useState([]);
 const [lessonDoubtLoading,setLessonDoubtLoading]=useState(false);
 const [lessonDoubtError,setLessonDoubtError]=useState('');
 const responseRef=useRef(null);const requestSeqRef=useRef(0);const answerBoxRef=useRef(null);const lastAskRef=useRef(null);const streamAbortRef=useRef(null);const askRef=useRef(null);const prefillTimerRef=useRef(null);
 const [askError,setAskError]=useState('');
 useEffect(()=>{if(user?.id)api('/intelligence/'+user.id).then(setLearningContext).catch(()=>setLearningContext(null));},[user?.id]);
 useEffect(()=>()=>{if(prefillTimerRef.current){clearTimeout(prefillTimerRef.current);prefillTimerRef.current=null;}try{streamAbortRef.current?.abort()}catch{}},[]);
 useEffect(()=>{const apply=()=>{const m=readTutorMemory(user?.id);if(contextKey&&m.contextKey&&m.contextKey!==contextKey)return;setTopic(m.topic||'');setMessage(m.message||'');setAnswer(m.contextKey===contextKey?m.answer:'');setStudentAnswer(m.contextKey===contextKey?m.studentAnswer:'');setFeedback(m.contextKey===contextKey?m.feedback:'');setAnswerSubmitted(Boolean(m.contextKey===contextKey&&m.answerSubmitted));};window.addEventListener('nova:tutor-memory-updated',apply);return()=>window.removeEventListener('nova:tutor-memory-updated',apply)},[user?.id,contextKey]);
 useEffect(()=>{const apply=()=>{try{const x=readJSON('nova_ai_prefill',null);if(x){const nextContextKey=x.contextKey||'';setContextKey(nextContextKey);setTopic(x.topic||'');setMessage(x.message||'');internalContextRef.current=typeof x.contextPrompt==='string'?x.contextPrompt:'';if(x.lessonId&&x.courseId){setLessonContext({lessonId:x.lessonId,courseId:x.courseId,topic:x.topic||''});setLessonDoubtHistory([]);setLessonDoubtError('');}setAnswer('');setFeedback('');setStudentAnswer('');setAnswerSubmitted(false);localStorage.removeItem('nova_ai_prefill');if(x.autoAsk&&x.message){if(prefillTimerRef.current)clearTimeout(prefillTimerRef.current);prefillTimerRef.current=setTimeout(()=>{prefillTimerRef.current=null;askRef.current?.(x.message,x.topic,nextContextKey)},80)}}}catch{}};apply();window.addEventListener('nova-ai-prefill',apply);return()=>{window.removeEventListener('nova-ai-prefill',apply);if(prefillTimerRef.current){clearTimeout(prefillTimerRef.current);prefillTimerRef.current=null;}}},[]);
 /* Smart scroll: the reply box is brought into view once per NEW request.
    The old effect re-ran on every streamed chunk and pinned the reader to the
    top of long answers mid-stream; during streaming the user now scrolls
    freely, and the sticky reply header keeps context visible. */

 async function ask(messageOverride=null,topicOverride=null,contextKeyOverride=null){
  // onClick={ask} handlers pass the click event as the first argument; ignore
  // any non-string override so the composer text is always used.
  const msgArg=typeof messageOverride==='string'?messageOverride:null;
  const topArg=typeof topicOverride==='string'?topicOverride:null;
  const ctxArg=typeof contextKeyOverride==='string'?contextKeyOverride:null;
  const effectiveMessage=msgArg??message;const effectiveTopic=topArg??topic;const effectiveContextKey=ctxArg??contextKey;if(!effectiveMessage.trim())return;const requestId=++requestSeqRef.current;try{streamAbortRef.current?.abort()}catch{}const ac=new AbortController();streamAbortRef.current=ac;lastAskRef.current={message:effectiveMessage,topic:effectiveTopic,contextKey:effectiveContextKey};setLoading(true);setAskError('');setAnswer('');setFeedback('');setStudentAnswer('');setAnswerSubmitted(false);requestAnimationFrame(()=>{answerBoxRef.current?.scrollIntoView({behavior:'smooth',block:'start'})});try{const profile=user?.profileComplete?`\nStudent profile: goal=${user.learningGoal||'not specified'}, interests=${user.interests||'not specified'}, strengths=${user.strengths||'not specified'}, weaknesses=${user.weaknesses||'not specified'}, learning style=${user.learningStyle||'not specified'}. Teach in a way that matches this profile and prefer visual explanations, diagrams, flowcharts or concrete examples when they improve understanding.`:'';const intelligenceContext=learningContext?`\nLearning memory: streak=${learningContext.streak||0}, studyMinutes=${learningContext.studyMinutes||0}, quizAttempts=${learningContext.quizzes||0}, weakAreas=${(learningContext.weakAreas||[]).slice(0,3).map(x=>`${x.subject||x.topic} (${x.accuracy||0}% accuracy)`).join(', ')||'none detected'}, nextAction=${learningContext.recommendations?.[0]?.title||'keep learning'}. Use this context only when it helps; do not invent activity.`:'';// Internal lesson context (from a course launch) is appended ONLY to the
// outgoing AI request — never to the visible composer, tutor memory, or logs.
const lessonBg=internalContextRef.current?`\n\nLESSON CONTEXT (background for teaching; the student may not repeat it):\n${internalContextRef.current}`:'';const teacherRequest=task==='TUTOR'?effectiveMessage+profile+(modeHint?`\n\nTEACHING MODE: ${modeHint}. Adapt the explanation and examples to this mode.`:'')+lessonBg+'\n\nTEACHER RESPONSE REQUIREMENT: Answer the student request directly and thoroughly. Do not artificially shorten the explanation to save tokens. Preserve the full teaching depth requested by the student. Use clear headings, step-by-step reasoning, examples or analogies when useful, formulas/code/diagrams when relevant, common mistakes, and a concise recap. Finish with exactly one short **Mini Question:**. Avoid filler and repetition, but do not omit useful teaching detail merely to make the response shorter.':effectiveMessage+profile+lessonBg;const finalTeacherRequest=`CURRENT STUDENT REQUEST (answer this request directly; do not reuse or continue an older answer):\n${teacherRequest}${intelligenceContext}`; let nextAnswer='';
 if(task==='TUTOR'){
  try{
   await apiStream('/ai/ask/stream',{method:'POST',signal:ac.signal,body:JSON.stringify({task,topic:effectiveTopic,message:finalTeacherRequest,level:'beginner',language:getAiLanguage()})},chunk=>{if(requestId!==requestSeqRef.current)return;nextAnswer+=chunk;setAnswer(nextAnswer);});
  }catch(streamError){
   if(streamError?.name==='AbortError'||requestId!==requestSeqRef.current)return;
   // Keep any already streamed answer and surface a clear notice. If nothing arrived,
   // transparently fall back to the standard JSON endpoint.
   if(!nextAnswer.trim()){
    const r=await api('/ai/ask',{method:'POST',signal:ac.signal,body:JSON.stringify({task,topic:effectiveTopic,message:finalTeacherRequest,level:'beginner',language:getAiLanguage()})});
    nextAnswer=r.answer||'';
   }else{
    setAskError('Connection interrupted before the answer finished — the partial response is kept below.');
   }
  }
 }else{
  const r=await api('/ai/ask',{method:'POST',signal:ac.signal,body:JSON.stringify({task,topic:effectiveTopic,message:finalTeacherRequest,level:'beginner',language:getAiLanguage()})});
  nextAnswer=r.answer||'No response returned.';
 }
 if(requestId!==requestSeqRef.current)return;
 setAnswer(nextAnswer||'No response returned.');setStudentAnswer('');setFeedback('');setAnswerSubmitted(false);
 saveTutorMemory(user?.id,{topic:effectiveTopic,message:effectiveMessage,answer:nextAnswer,feedback:'',studentAnswer:'',answerSubmitted:false,contextKey:effectiveContextKey});
 appendTutorTurn(user?.id,'USER',effectiveMessage,{topic:effectiveTopic,source:'ai-teacher',contextKey:effectiveContextKey});
 appendTutorTurn(user?.id,'ASSISTANT',nextAnswer,{topic:effectiveTopic,source:'ai-teacher',contextKey:effectiveContextKey});}catch(e){if(e?.name==='AbortError')return;if(requestId===requestSeqRef.current)setAskError(e.message||'Nova could not be reached right now. Please try again.')}finally{if(requestId===requestSeqRef.current)setLoading(false)}}
 askRef.current=ask;
 const previousTeachingModeRef=useRef(modeHint||'');
 useEffect(()=>{
  const previous=previousTeachingModeRef.current;
  previousTeachingModeRef.current=modeHint||'';
  if(task!=='TUTOR'||!modeHint||previous===modeHint||!message.trim()||!answer.trim())return;
  // V70.39: changing teaching mode regenerates the current question in the new mode.
  // The original student request is reused; the previous answer is never used as the prompt.
  ask(message,topic,contextKey);
 },[modeHint]);

 async function submitStudentAnswer(){if(!studentAnswer.trim()||!answer.trim()||!teacherMiniQuestion)return;setChecking(true);try{const prompt=`You are an AI teacher evaluating a student's answer to the mini question at the end of your previous response.\n\nPrevious teacher response:\n${answer}\n\nMini question:\n${teacherMiniQuestion}\n\nStudent answer:\n${studentAnswer}\n\nEvaluate only this answer. State whether it is correct, partially correct, or incorrect; explain why; give the corrected concept briefly; award a score out of 10; and finish with one short follow-up question. Do not invent facts.`;const r=await api('/ai/ask',{method:'POST',body:JSON.stringify({task:'TUTOR',topic:topic||'Learning check',message:prompt,level:'beginner',language:getAiLanguage()})});const nextFeedback=r.answer||'No evaluation returned.';setFeedback(nextFeedback);setStudentAnswer('');setAnswerSubmitted(true);saveTutorMemory(user?.id,{answer,feedback:nextFeedback,studentAnswer:'',answerSubmitted:true,contextKey});appendTutorTurn(user?.id,'USER',studentAnswer,{source:'mini-question',contextKey});appendTutorTurn(user?.id,'ASSISTANT',nextFeedback,{source:'mini-feedback',contextKey});}catch(e){setFeedback('Could not evaluate the answer. '+e.message)}finally{setChecking(false)}}

 const rawTeacherMiniQuestion=task==='TUTOR'&&answer?(answer.match(/(?:^|\n)\s*(?:#{1,6}\s*)?(?:\*{0,2})Mini\s+Question(?:\*{0,2})\s*[:：-]\s*([\s\S]*?)(?=\n\s*(?:#{1,6}\s*)?(?:\*{0,2})(?:Recap|Summary|Answer|Follow[- ]?up|Key Takeaway)\b|$)/i)?.[1]?.trim()||''):'';
 const teacherMiniQuestion=rawTeacherMiniQuestion|| (task==='TUTOR'&&answer ? `In your own words, what is the main idea of **${topic||'this lesson'}** that you learned from the explanation?` : '');
 const teacherAnswerBody=rawTeacherMiniQuestion?answer.replace(/(?:^|\n)\s*(?:#{1,6}\s*)?(?:\*{0,2})Mini\s+Question(?:\*{0,2})\s*[:：-]\s*[\s\S]*?(?=\n\s*(?:#{1,6}\s*)?(?:\*{0,2})(?:Recap|Summary|Answer|Follow[- ]?up|Key Takeaway)\b|$)/i,'').trim():answer;
 async function askTeacherLessonDoubt(){
  const question=lessonDoubt.trim();
  if(!question||lessonDoubtLoading)return;
  if(!lessonContext.lessonId||!lessonContext.courseId){setLessonDoubtError('Open AI Teacher from a lesson to use lesson-specific doubts.');return;}
  setLessonDoubtLoading(true);setLessonDoubtError('');
  const payload={userId:user.id,courseId:Number(lessonContext.courseId),lessonId:Number(lessonContext.lessonId),mode:'TEACH',message:`STUDENT DOUBT: ${question}

Answer only this specific doubt using the current lesson as context. Explain the exact confusion clearly and directly, step by step. Use an example or analogy when useful. Do not repeat the whole lesson and do not answer an unrelated topic.`,level:'beginner',language:getAiLanguage()};
  try{
   // Dedicated long/silent request: a doubt answer must never trigger a global learning refresh
   // that can remount the AI Teacher and wipe its main answer. It also gets a longer ceiling.
   const r=await api('/mentor/ask',{method:'POST',body:JSON.stringify(payload),timeoutMs:180000,silentUpdate:true});
   const answerText=String(r?.answer||'').trim();
   if(!answerText)throw new Error('No response returned. Please try again.');
   setLessonDoubtHistory(items=>[...items,{question,answer:answerText}]);
   setLessonDoubt('');
   setLessonDoubtError('');
  }catch(e){
   // Never replace the main AI Teacher answer when a lesson-doubt request fails.
   setLessonDoubtError(e.message||'Could not clear this doubt.');
  }finally{setLessonDoubtLoading(false);}
 }
 return <div className="ai-workspace"><aside className="ai-composer"><label>TOPIC</label><input value={topic} onChange={e=>setTopic(e.target.value)} placeholder="e.g. Java inheritance"/><textarea value={message} onChange={e=>setMessage(e.target.value)} rows="9" aria-label="Message to Nova" placeholder="Ask Nova to teach you, explain a concept, or test you…"/><button className="primary full" onClick={ask} disabled={loading}>{loading?'Thinking…':'Ask Nova'} <Send size={14}/></button><small className="ai-composer-hint">Nova teaches at your level, then checks your understanding.</small></aside><section ref={answerBoxRef} className={"ai-transcript ai-teacher-answer-box "+(task==='TUTOR'?'is-teacher':'')} aria-live="polite"><div className="ai-transcript-head"><div className="ai-avatar">{icon}</div><div><b>{title}</b><small>Teaching → check → feedback</small></div><span className="ai-live-dot" aria-hidden="true"/></div>{askError&&<div className="error-banner ai-teacher-error" role="alert"><span><b>Nova couldn't finish this answer.</b> {askError} Your previous teaching content is safe.</span><button className="secondary compact" onClick={()=>{const r=lastAskRef.current;if(r)ask(r.message,r.topic,r.contextKey)}}>Try again</button></div>}{loading&&!answer&&<div className="ai-teacher-thinking"><span className="nova-thinking-dots" aria-hidden="true"><i/><i/><i/></span>Nova is thinking…</div>}{answer?<div className="ai-transcript-body"><div className="ai-turn ai-turn-teacher"><div ref={responseRef} className="answer ai-teacher-response"><AiMarkdown content={teacherAnswerBody}/></div></div>{teacherMiniQuestion&&<div className="teacher-mini-question"><span>Mini question for you</span><AiMarkdown content={teacherMiniQuestion}/></div>}{answerSubmitted&&teacherMiniQuestion&&<div className="teacher-feedback teacher-submitted"><b>✓ Answer submitted</b><div><AiMarkdown content={feedback||'Your teacher has already evaluated this response.'}/></div></div>}{teacherMiniQuestion&&<div className="teacher-check"><div className="teacher-check-head"><b>Your turn</b><small>Answer above to continue the lesson.</small></div><textarea value={studentAnswer} onChange={e=>setStudentAnswer(e.target.value)} rows="5" placeholder="Write your answer here…"/><button className="primary" onClick={submitStudentAnswer} disabled={checking||!studentAnswer.trim()}>{checking?'Checking your answer…':'Reply to teacher'} <CheckCircle2 size={15}/></button></div>}</div>:<div className="empty ai-empty-motion"><LottiePlayer src={lottieLogoUrl} className="ai-empty-lottie" ariaLabel="Nova thinking"/><b>Your lesson appears here</b><span>Ask a focused question and Nova will teach you, then check your understanding.</span></div>}</section>{task==='TUTOR'&&<section className="ai-lesson-doubt" aria-label="Ask a doubt about this lesson"><div className="lesson-doubt-head"><div><span className="eyebrow">LESSON DOUBT</span><h4>Still stuck on this lesson?</h4><p>Each answer stays in its own section below; ask another doubt anytime.</p></div></div>{lessonDoubtHistory.map((item,index)=><div className="lesson-doubt-answer" key={index}><div className="lesson-doubt-question"><span>YOUR DOUBT</span><b>{item.question}</b></div><div className="answer-head"><div className="ai-avatar">{icon}</div><div><b>Nova's explanation</b><small>Based on this lesson</small></div></div><AiMarkdown content={item.answer}/></div>)}<div className="lesson-doubt-composer"><textarea value={lessonDoubt} onChange={e=>setLessonDoubt(e.target.value)} rows="3" aria-label="Type your doubt about this lesson" placeholder="Type your doubt here — e.g. “Why does the loop stop at n-1 instead of n?”"/><button className="primary" onClick={askTeacherLessonDoubt} disabled={lessonDoubtLoading||!lessonDoubt.trim()}>{lessonDoubtLoading?'Clearing doubt…':'Ask'} <Send size={14}/></button></div><small className="lesson-doubt-context">{lessonContext.topic||'Current lesson'}</small>{lessonDoubtError&&<div className="error-banner">{lessonDoubtError}</div>}</section>}</div>}

function LearningStudio({user,initialTab=null,routeTab=null,onRouteTab}){
 const [tab,setTab]=useState(()=>{
  if(readJSON('nova_ai_prefill',null))return 'teacher';
  return routeTab||initialTab||localStorage.getItem('nova_learning_studio_tab')||'teacher';
 });
 const [teachingMode,setTeachingMode]=useState(()=>localStorage.getItem('nova_teaching_mode')||'Step-by-step');
 const prevRouteTabRef=useRef(routeTab);
 useEffect(()=>{
  const prev=prevRouteTabRef.current;
  prevRouteTabRef.current=routeTab;
  if(routeTab){
   if(routeTab!==tab)setTab(routeTab);
  }else if(prev){
   setTab('teacher');
  }
 },[routeTab]);
 useEffect(()=>{
  const onPrefill=()=>{setTab('teacher');localStorage.setItem('nova_learning_studio_tab','teacher');};
  window.addEventListener('nova-ai-prefill',onPrefill);
  return()=>window.removeEventListener('nova-ai-prefill',onPrefill);
 },[]);
 useModulePersistence(user?.id,'learning-studio',{tab,teachingMode},{
  tab:x=>{if(routeTab||initialTab||readJSON('nova_ai_prefill',null))return;setTab(x||'teacher');},
  teachingMode:x=>setTeachingMode(x||'Step-by-step')
 });
 const tabs=[
  {id:'teacher',label:'AI Teacher',eyebrow:'TEACH • PRACTICE',icon:<BrainCircuit size={17}/>,title:'Learn with Nova like a personal teacher.',desc:'Ask doubts, get step-by-step teaching, answer mini questions and receive feedback.'},
  {id:'voice',label:'Voice Tutor',eyebrow:'SPEAK • LISTEN',icon:<Mic size={17}/>,title:'Talk through concepts naturally.',desc:'Ask by voice, get a teaching response and listen to the explanation aloud.'}
 ];
 const active=tabs.find(x=>x.id===tab)||tabs[0];
 function changeTab(next){setTab(next);localStorage.setItem('nova_learning_studio_tab',next);onRouteTab?.(next);window.dispatchEvent(new Event('nova-learning-studio-tab'))}
 const TEACHING_MODES=['Step-by-step','Socratic','Visual','Exam Coach','Interview Coach','Simple analogy'];
 return <>
  <div className="studio-head">
   <div className="studio-head-copy"><span className="eyebrow">NOVA LEARNING STUDIO</span><h1>Learn with <span>Nova.</span></h1><p>{active.desc}</p></div>
   <div className="studio-tabs" role="tablist" aria-label="Nova Learning Studio modes">{tabs.map(x=><button key={x.id} role="tab" aria-selected={tab===x.id} className={tab===x.id?'active':''} onClick={()=>changeTab(x.id)}>{x.icon}<span>{x.label}</span></button>)}</div>
  </div>
  <div className="studio-mode-strip"><span className="eyebrow">TEACHING MODE</span><div className="mode-chips" role="radiogroup" aria-label="Teaching mode">{TEACHING_MODES.map(m=><button key={m} type="button" role="radio" aria-checked={teachingMode===m} className={teachingMode===m?'active':''} onClick={()=>{setTeachingMode(m);localStorage.setItem('nova_teaching_mode',m)}}>{m}</button>)}</div></div>
  <div className={"studio-panel "+(tab==='teacher'?"studio-teacher-fullpage":"")}>{tab==='teacher'&&<AiPanel user={user} modeHint={teachingMode} task="TUTOR" title="AI Teacher" subtitle="Learn with explanations, examples, memory tricks and visual teaching." icon={<BrainCircuit/>}/>} {tab==='voice'&&<VoiceTutor user={user}/>} {tab==='chat'&&<ChatWorkspace user={user}/>}</div>
 </>
}

function PracticeHub({courses,progress,refresh,user,go}){
 const [practiceSession,setPracticeSession]=useLiveRuntimeSession(user?.id,'practice.ui',{tab:'quiz'});
 const tab=practiceSession?.tab||'quiz';
 const setTab=React.useCallback(value=>setPracticeSession(s=>({...s,tab:value||'quiz'})),[setPracticeSession]);
 const tabs=[['quiz','Smart Quiz'],['dpp','DPP & IDE'],['code','Code Lab']];
 const change=t=>setTab(t);
 return <><div className="page-title"><span className="eyebrow">PRACTICE WORKSPACE</span><h1>Build skill through <span>practice.</span></h1><p>Test, solve and improve in one place. Your results feed Nova Brain, revision and exam readiness.</p></div><div className="practice-hub-tabs">{tabs.map(x=><button className={tab===x[0]?'active':''} onClick={()=>change(x[0])} key={x[0]}>{x[1]}</button>)}</div><div className="practice-panels">
   <div className={tab==='quiz'?'practice-panel-visible':'practice-panel-hidden'} aria-hidden={tab!=='quiz'}><Quiz courses={courses} progress={progress} refresh={refresh} user={user}/></div>
   <div className={tab==='dpp'?'practice-panel-visible':'practice-panel-hidden'} aria-hidden={tab!=='dpp'}><CourseDppIde user={user} courses={courses}/></div>
   <div className={tab==='code'?'practice-panel-visible':'practice-panel-hidden'} aria-hidden={tab!=='code'}><CodeLab user={user}/></div>
 </div></>;
}
function PrepareHub({user,go,gateTab,onGateTab,dsaSlug,onDsaSlug}){
 const [tab,setTab]=useState(()=>localStorage.getItem('nova_prepare_tab')||'exam');
 useModulePersistence(user?.id,'prepare',{tab},{tab:x=>setTab(x||'exam')});
 const tabs=[['exam','Exam Simulator'],['gatecse','GATE CSE'],['dsa','DSA Practice'],['interview','AI Interviewer'],['career','Career Hub']];
 const change=t=>{setTab(t);localStorage.setItem('nova_prepare_tab',t)};
 return <><div className="page-title"><span className="eyebrow">PREPARATION WORKSPACE</span><h1>Prepare with <span>Nova.</span></h1><p>Exam readiness, GATE preparation, interviews and career planning connected to your learning data.</p></div><div className="practice-hub-tabs">{tabs.map(x=><button className={tab===x[0]?'active':''} onClick={()=>change(x[0])} key={x[0]}>{x[1]}</button>)}</div><div>{tab==='exam'&&<ExamSimulator user={user}/>} {tab==='gatecse'&&<GateCse routeTab={gateTab} onRouteTab={onGateTab}/>} {tab==='dsa'&&<DsaPractice user={user} api={api} routeSlug={dsaSlug} onRouteSlug={onDsaSlug}/>} {tab==='interview'&&<Interviewer user={user}/>} {tab==='career'&&<CareerHub user={user} go={go}/>}</div></>;
}

function useLiveRuntimeSession(userId,module,initialState){
 const keyUser=String(userId||'guest');
 const subscribe=React.useCallback(listener=>subscribeRuntimeState(keyUser,module,listener),[keyUser,module]);
 const getSnapshot=React.useCallback(()=>getRuntimeModuleSnapshot(keyUser,module,initialState),[keyUser,module,initialState]);
 const state=useSyncExternalStore(subscribe,getSnapshot,getSnapshot);
 const setState=React.useCallback(update=>updateRuntimeState(keyUser,module,update,initialState),[keyUser,module,initialState]);
 return [state,setState];
}

function Quiz({courses,refresh,user}){
 const quizInitial=React.useMemo(()=>({courseId:courses[0]?.id||'',questions:[],answers:{},result:null}),[courses[0]?.id]);
 const [quiz,setQuiz]=useLiveRuntimeSession(user?.id,'practice.quiz',quizInitial);
 const courseId=quiz.courseId||courses[0]?.id||'';
 const questions=Array.isArray(quiz.questions)?quiz.questions:[];
 const answers=quiz.answers&&typeof quiz.answers==='object'?quiz.answers:{};
 const result=quiz.result||null;
 const setCourseId=React.useCallback(value=>setQuiz(s=>({...s,courseId:value,questions:[],answers:{},result:null})),[setQuiz]);
 const setQuestions=React.useCallback(value=>setQuiz(s=>({...s,questions:typeof value==='function'?value(s.questions):value})),[setQuiz]);
 const setAnswers=React.useCallback(value=>setQuiz(s=>({...s,answers:typeof value==='function'?value(s.answers):value})),[setQuiz]);
 const setResult=React.useCallback(value=>setQuiz(s=>({...s,result:typeof value==='function'?value(s.result):value})),[setQuiz]);
 const [loading,setLoading]=useState(false),[error,setError]=useState('');
 useEffect(()=>{if(!courseId&&courses.length)setCourseId(courses[0].id)},[courses,courseId]);
 const canonicalQuestion=value=>String(value||'').trim().replace(/\s+/g,' ').toLowerCase();
 const uniqueQuestions=list=>{const seen=new Set();return list.filter(q=>{const key=canonicalQuestion(q?.question)||String(q?.id);if(!key||seen.has(key))return false;seen.add(key);return true})};
 const start=async(mode='fresh')=>{if(!courseId)return;setLoading(true);setError('');setResult(null);setAnswers({});try{
 const seed=Date.now()+Math.floor(Math.random()*1000000);
 const q=await api('/quizzes/course/'+courseId+(mode==='revision'?'/revision':'')+'?seed='+seed);
 let safe=uniqueQuestions(Array.isArray(q)?q.filter(x=>x&&x.id!=null&&Array.isArray(x.options)):[]), selected;
 if(mode==='revision'){
  selected=safe.slice(0,20);
  if(!selected.length)setError('No unique previously incorrect questions are available for this course. Unanswered questions are not treated as wrong. Start a fresh quiz instead.');
 }else{
  const seenKey=`nova_quiz_seen_${user?.id||'guest'}_${courseId}`;
  let seen=(()=>{try{return JSON.parse(localStorage.getItem(seenKey)||'[]')}catch{return[]}})();
  let unseen=safe.filter(x=>!seen.includes(String(x.id)));
  if(unseen.length<Math.min(10,safe.length)){
    // If the available pool is nearly exhausted, start a fresh cycle rather than repeating a few questions.
    seen=[]; unseen=safe.slice();
  }
  unseen=unseen.sort(()=>Math.random()-.5);
  selected=unseen.slice(0,Math.min(10,unseen.length));
  localStorage.setItem(seenKey,JSON.stringify([...seen,...selected.map(x=>String(x.id))]));
  if(!selected.length)setError('No new quiz questions are available for this course yet.');
 }
 setQuestions(selected);}catch(e){setQuestions([]);setError(e.message||'Quiz could not load.')}finally{setLoading(false)}};
 const submit=async()=>{if(!questions.length)return;const unanswered=questions.filter(q=>answers[q.id]===undefined);if(unanswered.length){setError(`Please answer all ${unanswered.length} remaining question${unanswered.length===1?'':'s'} before submitting.`);return}setLoading(true);setError('');try{const r=await api('/quizzes/course/'+courseId+'/submit',{method:'POST',body:JSON.stringify({userId:user.id,answers:Object.entries(answers).map(([questionId,selectedOption])=>({questionId:Number(questionId),selectedOption:Number(selectedOption)}))})});setResult(r);refresh?.();window.dispatchEvent(new Event('nova:learning-updated'));}catch(e){setError(e.message||'Quiz submission failed.')}finally{setLoading(false)}};
 const reset=()=>{setQuestions([]);setAnswers({});setResult(null);setError('')};
 return <><div className="page-title"><span className="eyebrow">ASSESSMENT</span><h1>Smart <span>Quiz.</span></h1><p>Test your understanding, get a score and use mistakes as your revision map.</p></div>
  <div className="quiz-toolbar"><select aria-label="Course" value={courseId} onChange={e=>{setCourseId(e.target.value);reset()}} disabled={!courses.length||loading}><option value="">Select a course</option>{courses.map(c=><option key={c.id} value={c.id}>{c.title}</option>)}</select><button className="primary" onClick={()=>start('fresh')} disabled={!courseId||loading}>{loading?'Loading…':questions.length?'Reload quiz':'Start quiz'} <PlayCircle size={15}/></button><button className="secondary" onClick={()=>start('revision')} disabled={!courseId||loading}>Revise mistakes</button></div>
  {error&&<div className="error settings-error" role="alert">{error}</div>}
  {!questions.length&&!result&&!error&&<div className="empty quiz-empty"><Target size={55}/><b>Ready for a knowledge check?</b><span>Choose a course and start a quiz. Your answers stay on this page until you submit.</span></div>}
  {questions.length>0&&!result&&<div className="quiz-list">{questions.map((q,i)=><div className="quiz-q" key={q.id}><span>QUESTION {i+1} • {q.difficulty||'Mixed'}</span><h3>{q.question||'Question unavailable'}</h3>{(q.options||[]).map((o,j)=><label className={answers[q.id]===j?'chosen':''} key={j}><input type="radio" name={'q'+q.id} checked={answers[q.id]===j} onChange={()=>setAnswers(a=>({...a,[q.id]:j}))}/>{o}</label>)}</div>)}<button className="primary" onClick={submit} disabled={loading}>{loading?'Submitting…':'Submit quiz'} <CheckCircle2 size={15}/></button></div>}
  {result&&<div className="result-card"><div className="result-ring">{Number(result.score)||0}%</div><h2>{result.message||'Quiz complete!'}</h2><p>{result.correct??0} correct out of {result.total??questions.length}</p><div className="result-actions"><button className="primary" onClick={()=>start('revision')} disabled={loading}><Target size={14}/> Revise mistakes</button><button className="secondary" onClick={reset}><RotateCcw size={14}/> Fresh quiz</button></div></div>}
 </>;
}

function ChatWorkspace({user}){const [convos,setConvos]=useState([]),[active,setActive]=useState(null),[messages,setMessages]=useState([]),[text,setText]=useState(''),[loading,setLoading]=useState(false),[listening,setListening]=useState(false),[chatError,setChatError]=useState(''),[confirmDelete,setConfirmDelete]=useState(false);const recognitionRef=React.useRef(null);const listenRestartRef=React.useRef(false);const skipFetchIdRef=React.useRef(null);const supported=typeof window!=='undefined'&&(window.SpeechRecognition||window.webkitSpeechRecognition);const load=()=>api('/chat/conversations/'+user.id).then(x=>{const list=Array.isArray(x)?x:[];setConvos(list);if(!active&&list[0])setActive(list[0].id)}).catch(e=>setChatError(e.message||'Could not load conversations.'));useEffect(()=>{load();return()=>{listenRestartRef.current=false;try{recognitionRef.current?.stop()}catch{}}},[]);useEffect(()=>{if(!active)return;if(skipFetchIdRef.current===active){skipFetchIdRef.current=null;return;}let alive=true;api(`/chat/conversations/${user.id}/${active}`).then(m=>{if(alive)setMessages(Array.isArray(m)?m:[])}).catch(e=>{if(alive)setChatError(e.message||'Could not load messages.')});return()=>{alive=false}},[active,user.id]);async function create(){setChatError('');try{const c=await api('/chat/conversations/'+user.id,{method:'POST',body:JSON.stringify({title:'New learning session'})});skipFetchIdRef.current=c.id;setConvos(x=>[c,...x]);setActive(c.id);setMessages([])}catch(e){setChatError(e.message||'Could not create a new chat.')}} async function clearSession(){if(!active)return;setChatError('');try{await api(`/chat/conversations/${user.id}/${active}/messages`,{method:'DELETE'});setMessages([]);setConvos(x=>x.map(c=>c.id===active?{...c,title:'Cleared session'}:c))}catch(e){setChatError(e.message||'Could not clear this session. Your messages were kept.')}} async function deleteHistory(){if(!convos.length)return;setChatError('');try{await api(`/chat/conversations/${user.id}`,{method:'DELETE'});setConvos([]);setActive(null);setMessages([]);setConfirmDelete(false)}catch(e){setChatError(e.message||'Could not delete history. Please try again.')}}async function send(){if(!text.trim()||loading)return;const m=text;setText('');setChatError('');setLoading(true);setMessages(x=>[...x,{id:Date.now(),role:'USER',content:m}]);try{let conversationId=active;if(!conversationId){const c=await api('/chat/conversations/'+user.id,{method:'POST',body:JSON.stringify({title:m.slice(0,38)||'New learning session'})});skipFetchIdRef.current=c.id;setConvos(x=>[c,...x]);setActive(c.id);conversationId=c.id}const a=await api(`/chat/conversations/${user.id}/${conversationId}/messages`,{method:'POST',body:JSON.stringify({message:m,task:'TUTOR',level:'beginner',language:getAiLanguage()})});setMessages(x=>[...x,a])}catch(e){setMessages(x=>[...x,{id:Date.now()+1,role:'ASSISTANT',content:e.message||'AI request could not complete right now. Please try again.'}])}finally{setLoading(false)}}function stopListening(){listenRestartRef.current=false;try{recognitionRef.current?.stop()}catch{}recognitionRef.current=null;setListening(false)}function startListening(){if(listening){stopListening();return}if(!supported){setText('Voice recognition is not supported in this browser. Chrome works best.');return}listenRestartRef.current=true;const SR=window.SpeechRecognition||window.webkitSpeechRecognition;const start=()=>{if(!listenRestartRef.current)return;const r=new SR();recognitionRef.current=r;r.lang=getSpeechLanguage();r.interimResults=true;r.continuous=true;r.onstart=()=>setListening(true);r.onresult=e=>{let t='';for(let i=0;i<e.results.length;i++)t+=e.results[i][0].transcript+' ';setText(t.trim())};r.onend=()=>{recognitionRef.current=null;if(listenRestartRef.current){setTimeout(start,120)}else setListening(false)};r.onerror=e=>{if(e?.error==='not-allowed'||e?.error==='service-not-allowed'){listenRestartRef.current=false;setListening(false)}};try{r.start()}catch{if(listenRestartRef.current)setTimeout(start,250)}};start()}return <><div className="page-title"><span className="eyebrow">CONVERSATION MEMORY</span><h1>AI <span>Chat.</span></h1><p>Persistent learning conversations connected to your tutor. Ask your question by typing or using the microphone.</p></div>{chatError&&<div className="error-banner" role="alert">{chatError}</div>}<div className="chat-shell"><div className="chat-sidebar"><button className="primary full" onClick={create}><Plus size={14}/> New chat</button><div className="chat-history-actions"><button type="button" className="text-btn chat-action-btn" onClick={clearSession} disabled={!active||!messages.length} title="Clear messages in current chat"><RotateCcw size={14}/> Clear session</button>{!confirmDelete?<button type="button" className="text-btn chat-action-btn chat-delete-btn" onClick={()=>setConfirmDelete(true)} disabled={!convos.length} title="Delete all conversation history"><Trash2 size={14}/> Delete history</button>:<div className="chat-delete-confirm"><span>Delete all?</span><button type="button" className="danger-btn compact" onClick={deleteHistory}>Yes, delete</button><button type="button" className="secondary compact" onClick={()=>setConfirmDelete(false)}>Cancel</button></div>}</div>{convos.map(c=><button className={'chat-item '+(active===c.id?'selected':'')} key={c.id} onClick={()=>setActive(c.id)}><MessageCircle size={15}/><span>{c.title}</span></button>)}</div><div className="chat-main"><div className="messages">{!messages.length&&<div className="empty"><Sparkles size={40}/><b>Start a learning conversation</b><span>Ask by typing or use the microphone for a voice question.</span></div>}{messages.map(m=><div className={'bubble '+(m.role==='USER'?'user':'assistant')} key={m.id}><span>{m.role==='USER'?'You':'Nova AI'}</span>{m.role==='USER'?<div className="user-message-text">{m.content}</div>:<AiMarkdown content={m.content}/>}</div>)}{loading&&<div className="bubble assistant"><span>Nova AI</span><span className="nova-thinking-dots" aria-hidden="true"><i/><i/><i/></span></div>}</div><div className="chat-input"><textarea rows="2" value={text} onChange={e=>setText(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send()}}} placeholder={listening?'Listening… speak naturally':'Ask your AI teacher…'}/><button type="button" className={listening?'danger-btn':'secondary'} onClick={startListening} title={supported?(listening?'Stop voice input':'Ask Nova by voice'):'Voice input unavailable'} aria-label={supported?(listening?'Stop voice input':'Ask Nova by voice'):'Voice input unavailable'}>{listening?<MicOff size={16}/>:<Mic size={16}/>}</button><button className="primary" onClick={send} disabled={loading||!text.trim()} aria-label="Send message" title="Send message"><Send size={16}/></button></div></div></div></>}
const cleanKnowledgeAi=(value)=>String(value||'')
 .replace(/\uFFFD/g,'')
 .replace(/[\u200B-\u200D\uFEFF]/g,'')
 .replace(/^[ \t]*[•·▪▫◆◇★☆]{2,}[ \t]*$/gm,'')
 .replace(/^[ \t]*[-_=]{5,}[ \t]*$/gm,'')
 .replace(/\n{3,}/g,'\n\n')
 .trim();

function KnowledgeHub({user}){
 const [docs,setDocs]=useState([]),[chunks,setChunks]=useState([]),[file,setFile]=useState(null),[loading,setLoading]=useState(false),[uploading,setUploading]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[packBusy,setPackBusy]=useState(false);
 // Keep large PDF chunks strictly in React memory (never persisted to localStorage) to prevent quota exhaustion.
 const knowledgeInitial=React.useMemo(()=>({selected:null,selectedSnapshot:null,question:'',answer:'',pack:null,packType:'summary',activeSection:'library'}),[]);
 const [knowledge,setKnowledge]=useLiveRuntimeSession(user?.id,'knowledgeHub',knowledgeInitial);
 const selected=knowledge.selected||null, selectedSnapshot=knowledge.selectedSnapshot||null, question=knowledge.question||'', answer=knowledge.answer||'', pack=knowledge.pack||null, packType=knowledge.packType||'summary', activeSection=knowledge.activeSection||'library';
 const updateKnowledge=React.useCallback((patch)=>setKnowledge(s=>({...s,...(typeof patch==='function'?patch(s):patch)})),[setKnowledge]);
 const setSelected=x=>updateKnowledge(s=>({selected:typeof x==='function'?x(s.selected||null):x}));
 const setSelectedSnapshot=x=>updateKnowledge(s=>({selectedSnapshot:typeof x==='function'?x(s.selectedSnapshot||null):x}));
 const setQuestion=x=>updateKnowledge(s=>({question:typeof x==='function'?x(s.question||''):x}));
 const setAnswer=x=>updateKnowledge(s=>({answer:typeof x==='function'?x(s.answer||''):x}));
 const setPack=x=>updateKnowledge(s=>({pack:typeof x==='function'?x(s.pack||null):x}));
 const setPackType=x=>updateKnowledge(s=>({packType:typeof x==='function'?x(s.packType||'summary'):x}));
 const setActiveSection=x=>updateKnowledge(s=>({activeSection:typeof x==='function'?x(s.activeSection||'library'):x}));
 const [packLibrary,setPackLibrary]=useLiveRuntimeSession(user?.id,'knowledge-packs',{});
 const load=()=>api('/knowledge').then(next=>{setDocs(Array.isArray(next)?next:[]);return next}).catch(e=>{setError(e.message);return []}); useEffect(()=>{load()},[]);
 useEffect(()=>{
  if(!selected){setChunks([]);return;}
  let alive=true;
  api(`/knowledge/${selected}/chunks`).then(next=>{if(alive&&Array.isArray(next))setChunks(next)}).catch(e=>{if(alive)setError(e.message||'Could not load document notes.')});
  return()=>{alive=false};
 },[selected]);
 useEffect(()=>{if(!selected||!docs.length)return;const live=docs.find(d=>String(d.id)===String(selected));if(live)setSelectedSnapshot(live)},[docs,selected]);
 useEffect(()=>{if(!selected)return;const perDoc=packLibrary[String(selected)]||{};const restoredType=packType||'summary';const restored=perDoc[restoredType];if(restored){setPack(restored.content||restored);setPackType(restored.type||restoredType)}},[selected,packLibrary]);
 function selectDoc(id){const doc=docs.find(d=>String(d.id)===String(id))||null;const perDoc=packLibrary[String(id)]||{};const preferredType=Object.prototype.hasOwnProperty.call(perDoc,packType)?packType:(perDoc.summary?'summary':Object.keys(perDoc)[0]||'summary');const preferred=perDoc[preferredType];setSelected(id);setSelectedSnapshot(doc);setQuestion('');setAnswer('');setPack(preferred?.content||preferred||null);setPackType(preferred?.type||preferredType);setError('');setNotice('');}
 async function upload(){if(!file)return;setUploading(true);setError('');setNotice('');setAnswer('');setPack(null);try{if(file.type&&file.type!=='application/pdf'&&!file.name.toLowerCase().endsWith('.pdf'))throw new Error('Please select a PDF file.');const fd=new FormData();fd.append('file',file);const created=await api('/knowledge/upload',{method:'POST',body:fd});setFile(null);const input=document.getElementById('pdf-file');if(input)input.value='';const next=await load();const createdDoc=next.find(d=>String(d.id)===String(created.id))||created;setSelected(created.id);setSelectedSnapshot(createdDoc);setNotice(`Indexed ${createdDoc.fileName||'document'} successfully.`);}catch(e){setError('Upload failed: '+e.message)}finally{setUploading(false)}}
 async function ask(){if(!selected||!question.trim())return;setLoading(true);setError('');setNotice('');try{const r=await api('/knowledge/'+selected+'/ask',{method:'POST',body:JSON.stringify({question,level:'beginner',language:getAiLanguage()})});setAnswer(cleanKnowledgeAi(r.answer)||'The document did not return a readable answer. Try a more specific question.')}catch(e){setError('Could not query the document: '+e.message)}finally{setLoading(false)}}
 async function generatePack(type){if(!selected)return;setPackBusy(true);setPackType(type);setError('');setNotice('');try{const r=await api('/knowledge/'+selected+'/pack',{method:'POST',body:JSON.stringify({type,level:'exam-focused',language:getAiLanguage()})});const content=cleanKnowledgeAi(r.answer)||'The study pack could not be generated. Please try again.';const item={id:Date.now(),documentId:selected,document:selectedSnapshot?.fileName||selectedDoc?.fileName||'Knowledge document',type,content,createdAt:new Date().toISOString()};setPack(content);setPackLibrary(prev=>({...prev,[String(selected)]:{...(prev[String(selected)]||{}),[type]:item}}));}catch(e){setError('Could not generate the study pack: '+e.message)}finally{setPackBusy(false)}}
 function savePack(){if(!pack||!selectedDoc)return;const item={id:Date.now(),documentId:selectedDoc.id,document:selectedDoc.fileName,type:packType,content:pack,createdAt:new Date().toISOString()};setPackLibrary(prev=>({...prev,[String(selectedDoc.id)]:{...(prev[String(selectedDoc.id)]||{}),[packType]:item}}));setError('');setNotice('Study pack saved. It will remain available for this document.');}
 async function remove(id){try{await api('/knowledge/'+id,{method:'DELETE'});if(String(selected)===String(id)){setSelected(null);setSelectedSnapshot(null);setChunks([]);setQuestion('');setAnswer('');setPack(null);setPackType('summary')}await load()}catch(e){setError(e.message)}}
 const selectedDoc=docs.find(d=>String(d.id)===String(selected))||selectedSnapshot;
 return <><div className="page-title"><span className="eyebrow">V18 • AI KNOWLEDGE ENGINE</span><h1>Your <span>Knowledge Hub.</span></h1><p>Turn any study PDF into grounded answers, summaries, flashcards, quizzes and a focused study plan.</p></div>{notice&&<div className="success-banner" role="status">{notice}</div>}{error&&<div className="error settings-error" role="alert">{error}</div>}<div className="knowledge-grid"><div className="knowledge-left"><div className="upload-card"><div className="title-icon"><UploadCloud/></div><h3>Upload study material</h3><p>PDF only • up to 25 MB • extracted and indexed securely</p><input aria-label="Upload study material (PDF)" id="pdf-file" type="file" accept=".pdf,application/pdf" onChange={e=>setFile(e.target.files?.[0]||null)}/>{file&&<div className="file-picked"><FileText size={16}/><span>{file.name}</span><small>{Math.round(file.size/1024)} KB</small></div>}<button className="primary full" onClick={upload} disabled={!file||uploading}>{uploading?'Indexing PDF…':'Upload & index'} <UploadCloud size={15}/></button></div><div className="doc-list"><div className="section-head"><div><span className="eyebrow">LIBRARY</span><h3>My documents</h3></div><span className="doc-count">{docs.length} files</span></div>{docs.length===0?<div className="empty small"><FileSearch size={32}/><b>No PDFs yet</b><span>Upload your notes or textbook to start.</span></div>:docs.map(d=><div className={'doc-item '+(selected===d.id?'selected':'')} key={d.id} onClick={()=>selectDoc(d.id)}><div className="doc-icon"><FileText size={18}/></div><div><b>{d.fileName}</b><small>{Math.round(d.sizeBytes/1024)} KB • {new Date(d.uploadedAt).toLocaleString()}</small></div><button className="icon-btn" onClick={e=>{e.stopPropagation();remove(d.id)}}><Trash2 size={16}/></button></div>)}</div></div><div className="knowledge-main"><div className="rag-card"><div className="answer-head"><div className="ai-avatar"><Sparkles size={17}/></div><div><b>{selectedDoc?.fileName||'Knowledge Hub'}</b><small>{selected?`${chunks.length} extracted note sections`:'Select a document first'}</small></div></div>{selected?<><textarea value={question} onChange={e=>setQuestion(e.target.value)} rows="4" placeholder="Ask anything from this PDF…"/><button className="primary" onClick={ask} disabled={loading}>{loading?'Searching + thinking…':'Ask document'} <Send size={14}/></button></>:<div className="empty"><FileSearch size={44}/><b>Select a document</b><span>Choose a PDF to view its extracted notes and activate grounded Q&A.</span></div>}</div>{selected&&<><div className="knowledge-pack"><div className="panel-head"><div><span className="eyebrow">AI STUDY PACK</span><h3>One PDF → complete revision kit</h3><small>All generated content is grounded in the selected document and uses your chosen AI language.</small></div><Sparkles size={20}/></div><div className="knowledge-pack-actions"><button className="secondary" onClick={()=>generatePack('summary')} disabled={packBusy}>{packBusy&&packType==='summary'?'Generating…':'Summary'}</button><button className="secondary" onClick={()=>generatePack('flashcards')} disabled={packBusy}>{packBusy&&packType==='flashcards'?'Generating…':'12 Flashcards'}</button><button className="secondary" onClick={()=>generatePack('quiz')} disabled={packBusy}>{packBusy&&packType==='quiz'?'Generating…':'10-Question Quiz'}</button><button className="secondary" onClick={()=>generatePack('studyplan')} disabled={packBusy}>{packBusy&&packType==='studyplan'?'Generating…':'7-Day Plan'}</button></div>{pack&&<div className="knowledge-pack-result"><div className="pack-result-head"><b>{packType==='summary'?'Exam Summary':packType==='flashcards'?'Flashcards':packType==='quiz'?'Practice Quiz':'7-Day Study Plan'}</b><button className="text-btn" onClick={savePack}>Save pack</button></div><div className="pack-content"><AiMarkdown content={pack}/></div></div>}</div><div className="panel notes-reader"><div className="panel-head"><div><span className="eyebrow">EXTRACTED NOTES</span><h3>Document notes</h3></div><span>{chunks.length} sections</span></div>{chunks.length?chunks.map(c=><article className="knowledge-note" key={c.id}><span className="note-page">Page {c.page}</span><AiMarkdown content={c.content}/></article>):<div className="empty small"><FileText size={30}/><b>No readable notes</b><span>This PDF may be scanned/image-only. Use a text-based PDF.</span></div>}</div></>}{answer&&<div className="answer-box"><div className="answer-head"><div className="ai-avatar"><Sparkles size={17}/></div><div><b>Grounded answer</b><small>Retrieved from your uploaded document</small></div></div><div className="answer"><AiMarkdown content={answer}/></div></div>}</div></div></>}

function AdaptiveMentor({user,courses}){
 const [courseId,setCourseId]=useState(''); const [lessonId,setLessonId]=useState(''); const [lessons,setLessons]=useState([]); const [mode,setMode]=useState('TEACH'); const [message,setMessage]=useState(''); const [answer,setAnswer]=useState(''); const [loading,setLoading]=useState(false); const [state,setState]=useState(null); const [recommended,setRecommended]=useState(null);
 useModulePersistence(user?.id,'lesson',{courseId,lessonId,mode,message,answer,state,recommended},{courseId:x=>setCourseId(x||''),lessonId:x=>setLessonId(x||''),mode:x=>setMode(x||'TEACH'),message:x=>setMessage(x||''),answer:x=>setAnswer(x||''),state:x=>setState(x||null),recommended:x=>setRecommended(x||null)});
 useEffect(()=>{api('/mentor/state/'+user.id).then(r=>{if(r)setState(prev=>prev||r)}).catch(()=>{});api('/learning/next/'+user.id).then(r=>{setRecommended(prev=>prev||r);if(!courseId&&r?.course?.id)setCourseId(String(r.course.id));}).catch(()=>{});},[user.id]);
 useEffect(()=>{if(!courseId){setLessons([]);return;}api('/courses/'+courseId).then(r=>{const list=r.lessons||[];setLessons(list);const validCurrent=list.some(l=>String(l.id)===String(lessonId));if(!validCurrent){const preferred=recommended?.lesson?.id&&list.some(l=>String(l.id)===String(recommended.lesson.id))?recommended.lesson.id:null;if(preferred){setLessonId(String(preferred));}else if(list.length){setLessonId(String(list[0].id));}else{setLessonId('');}}}).catch(()=>{})},[courseId]);
 async function ask(){if(!lessonId||!message.trim())return;setLoading(true);try{const r=await api('/mentor/ask',{method:'POST',body:JSON.stringify({userId:user.id,courseId:Number(courseId),lessonId:Number(lessonId),mode,message,level:state?.recommendedLevel||'beginner',language:getAiLanguage()})});setAnswer(r.answer||'No response.')}catch(e){setAnswer(e.message||'Mentor request failed. Please try again in a moment.')}finally{setLoading(false)}}
 const lesson=lessons.find(x=>String(x.id)===String(lessonId));
 return <><div className="page-title"><span className="eyebrow">ADAPTIVE LEARNING ENGINE</span><h1>Meet your <span>AI Mentor.</span></h1><p>Nova adapts explanations, examples and hints to your progress instead of teaching everyone the same way.</p></div><div className="mentor-layout"><div className="mentor-control"><div className="mentor-badge"><div className="title-icon"><GraduationCap/></div><div><b>Adaptive mode</b><small>{state?`${state.recommendedLevel} • ${Math.round(state.averageProgress)}% average progress`:'Reading your learning state…'}</small></div></div><label>COURSE</label><select aria-label="Course" value={courseId} onChange={e=>{setCourseId(e.target.value);setLessonId('')}}><option value="">Choose a course</option>{courses.map(c=><option key={c.id} value={c.id}>{c.title}</option>)}</select><label>LESSON</label><select aria-label="Lesson" value={lessonId} onChange={e=>setLessonId(e.target.value)} disabled={!lessons.length}><option value="">Choose a lesson</option>{lessons.map(l=><option key={l.id} value={l.id}>{l.orderIndex}. {l.title}</option>)}</select><label>TUTOR MODE</label><div className="mode-grid">{[['TEACH','Teach','Step-by-step'],['SIMPLIFY','Simplify','Easy analogy'],['EXAMPLE','Example','Practical demo'],['HINT','Hint','Guided help'],['CHECK','Check','Test me']].map(([id,t,d])=><button key={id} className={mode===id?'mode active':'mode'} onClick={()=>setMode(id)}><Lightbulb size={15}/><b>{t}</b><small>{d}</small></button>)}</div><button className="text-btn" onClick={()=>{setAnswer('');setMessage('');setRecommended(null);api('/learning/next/'+user.id).then(setRecommended).catch(()=>{})}}><RefreshCw size={14}/> Refresh recommendation</button></div><div className="mentor-chat"><div className="mentor-context"><div className="ai-avatar"><Brain size={18}/></div><div><b>{lesson?.title||'Choose a lesson'}</b><small>{recommended?.reason||'Select a course and lesson to begin.'}</small></div></div>{recommended?.available&&<div className="recommend"><Sparkles size={15}/><span><b>Next best step:</b> {recommended.lesson?.title||'Continue learning'}</span></div>}<div className="mentor-recovery"><div><span className="eyebrow">WEAKNESS RECOVERY</span><b>{state?.weakestSubject||state?.weakArea||'Your next skill gap'}</b><small>Use a short loop: review → practice → explain → revisit. Nova keeps the session focused instead of sending you back to the full syllabus.</small></div><button className="secondary" onClick={()=>setMode('SIMPLIFY')}>Start recovery <ChevronRight size={13}/></button></div><div className="mentor-answer">{answer?<div className="answer"><AiMarkdown content={answer}/></div>:<div className="empty"><GraduationCap size={48}/><b>Your mentor is ready</b><span>Pick a lesson, choose a mode and ask for an explanation, example, hint or check.</span></div>}</div><div className="mentor-input"><textarea rows="4" value={message} onChange={e=>setMessage(e.target.value)} placeholder="e.g. Explain this like I'm completely new to it…" onKeyDown={e=>{if(e.key==='Enter'&&e.metaKey){e.preventDefault();ask()}}}/><div><small>⌘ + Enter to ask</small><button className="primary" onClick={ask} disabled={loading||!lessonId||!message.trim()}>{loading?'Thinking…':'Ask mentor'} <Send size={15}/></button></div></div></div></div></>
}

function StudyPlanner({user}){
 const [goal,setGoal]=useState(''); const [hours,setHours]=useState('2'); const [days,setDays]=useState('7'); const [level,setLevel]=useState('beginner'); const [plan,setPlan]=useState(''); const [loading,setLoading]=useState(false);
 useModulePersistence(user?.id,'study-planner',{goal,hours,days,level,plan},{goal:x=>setGoal(x||''),hours:x=>setHours(x||'2'),days:x=>setDays(x||'7'),level:x=>setLevel(x||'beginner'),plan:x=>setPlan(x||'')});
 const [saved,setSaved]=useState(null);
 useEffect(()=>{if(plan)setSaved({goal,hours,days,level,plan})},[plan,goal,hours,days,level]);
 async function generate(){
  if(!goal.trim())return;
  setLoading(true);
  try{
   const requestedDays=Number(days);
   const prompt=`Create an EXACTLY ${requestedDays}-day personalized study roadmap for ${goal}. Do NOT stop early and do NOT combine multiple days into one entry. I can study ${hours} hours per day and my level is ${level}. The roadmap MUST contain every day from Day 1 through Day ${requestedDays}, in order. For EACH day include: (1) focus/topic, (2) 2-4 concrete learning tasks, (3) active-recall task, (4) practice task with a realistic quantity, (5) short checkpoint, and (6) estimated minutes. Organize the ${requestedDays} days into sensible phases such as foundation, guided practice, consolidation, revision and final assessment where appropriate. Include a short weekly checkpoint after every 7 days, but do not replace any numbered day. Keep the workload realistic for ${hours} hours/day. Finish with a compact overall strategy and success criteria. This is a real execution roadmap, not a generic list.`;
   const r=await api('/ai/ask',{method:'POST',body:JSON.stringify({task:'STUDY_PLAN',topic:goal,message:prompt,level,language:getAiLanguage()})});
   let displayPlan=String(r?.answer||'').trim();
   const countDays=text=>((String(text||'').match(/(?:^|\n)\s*(?:#{1,4}\s*)?Day\s+(?:[1-9]|[12]\d|30)\b/gi))||[]).length;
   if(requestedDays>=21&&countDays(displayPlan)<requestedDays){
    const continuationPrompt=`The roadmap below is incomplete. Return a COMPLETE EXACTLY ${requestedDays}-day roadmap for ${goal}. Return ALL numbered entries Day 1 through Day ${requestedDays}; do not summarize, skip or combine days. Keep each day concise but include focus, concrete tasks, active recall, practice, checkpoint and minutes. Level: ${level}. Study time: ${hours} hours/day. Preserve useful ideas from the partial roadmap but fill every missing day. Partial roadmap:\n${displayPlan.slice(0,16000)}`;
    const continuation=await api('/ai/ask',{method:'POST',body:JSON.stringify({task:'STUDY_PLAN',topic:goal,message:continuationPrompt,level,language:getAiLanguage()})}).catch(()=>null);
    if(continuation?.answer)displayPlan=String(continuation.answer).trim();
   }
   setPlan(displayPlan||'No roadmap was generated. Please try again.');
   const next={goal,hours,days,level,plan:displayPlan,savedAt:new Date().toISOString()};
   setSaved(next);
  }catch(e){setPlan('AI plan failed: '+(e.message||'Unknown error')+'\n\nRetry once; Gemini may be temporarily busy.')}finally{setLoading(false)}
 }
 function clear(){setSaved(null);setPlan('')}
 return <><div className="page-title"><span className="eyebrow">PERSONAL LEARNING ENGINE</span><h1>AI Study <span>Planner.</span></h1><p>Turn a goal into a realistic daily roadmap with revision, practice and checkpoints.</p></div><div className="planner-grid"><div className="planner-form"><div className="title-icon"><CalendarDays/></div><h3>Build your roadmap</h3><p>Tell Nova AI what you want to master. Your latest plan is saved in this browser.</p><label>LEARNING GOAL</label><input value={goal} onChange={e=>setGoal(e.target.value)} placeholder="e.g. Java Spring Boot for placements"/><div className="planner-fields"><div><label>DAYS</label><select aria-label="Days" value={days} onChange={e=>setDays(e.target.value)}><option>7</option><option>14</option><option>21</option><option>30</option></select></div><div><label>HOURS / DAY</label><select aria-label="Hours per day" value={hours} onChange={e=>setHours(e.target.value)}><option>1</option><option>2</option><option>3</option><option>4</option><option>6</option></select></div></div><label>YOUR LEVEL</label><select aria-label="Level" value={level} onChange={e=>setLevel(e.target.value)}><option value="beginner">Beginner</option><option value="intermediate">Intermediate</option><option value="advanced">Advanced</option></select><button className="primary full" onClick={generate} disabled={loading||!goal.trim()}>{loading?'Designing your roadmap…':'Generate roadmap'} <WandSparkles size={15}/></button>{saved&&<button className="text-btn planner-clear" onClick={clear}>Clear saved plan</button>}</div><div className="planner-result"><div className="answer-head"><div className="ai-avatar"><Sparkles size={17}/></div><div><b>Nova Roadmap</b><small>{saved?'Saved locally • ready to revise':'AI-generated study strategy'}</small></div></div>{plan?<div className="answer planner-answer"><AiMarkdown content={plan}/></div>:<div className="empty"><CalendarDays size={44}/><b>Your roadmap will appear here</b><span>Choose a goal and let AI break it into focused daily actions.</span></div>}</div></div></>
}
function Flashcards({user}){
 const [topic,setTopic]=useState(''); const [count,setCount]=useState('8'); const [cards,setCards]=useState([]); const [index,setIndex]=useState(0); const [flipped,setFlipped]=useState(false); const [loading,setLoading]=useState(false);
 useModulePersistence(user?.id,'flashcards',{topic,count,cards,index,flipped},{topic:x=>setTopic(x||''),count:x=>setCount(x||'8'),cards:x=>setCards(Array.isArray(x)?x:[]),index:x=>setIndex(Number(x)||0),flipped:x=>setFlipped(Boolean(x))});
 async function generate(){if(!topic.trim())return;setLoading(true);setFlipped(false);try{const r=await api('/ai/ask',{method:'POST',body:JSON.stringify({task:'FLASHCARDS',topic,message:`Create exactly ${count} concise flashcards for ${topic}. Format each as: Q: ... A: ... . Put each card on a separate line. Focus on high-value exam/interview concepts. No intro or numbering.`,level:'intermediate',language:getAiLanguage()})});const parsed=(r.answer||'').split(/\n+/).map(x=>x.trim()).filter(Boolean).map(line=>{const m=line.match(/Q:\s*(.*?)\s+A:\s*(.*)/i);return m?{q:m[1].replace(/^[-•*]\s*/,''),a:m[2]}:null}).filter(Boolean);setCards(parsed);setIndex(0)}catch(e){}finally{setLoading(false)}}
 const card=cards[index]; function next(){setFlipped(false);setIndex((index+1)%cards.length)} function prev(){setFlipped(false);setIndex((index-1+cards.length)%cards.length)}
 return <><div className="page-title"><span className="eyebrow">ACTIVE RECALL</span><h1>AI <span>Flashcards.</span></h1><p>Generate a compact revision deck and test yourself before revealing the answer.</p></div><div className="flash-toolbar"><input value={topic} onChange={e=>setTopic(e.target.value)} placeholder="e.g. Java Collections"/><select aria-label="Number of flashcards" value={count} onChange={e=>setCount(e.target.value)}><option>5</option><option>8</option><option>10</option><option>15</option></select><button className="primary" onClick={generate} disabled={loading||!topic.trim()}>{loading?'Generating…':'Generate deck'} <WandSparkles size={15}/></button></div>{card?<div className="flash-stage"><div className="deck-meta"><span>Card {index+1} of {cards.length}</span><span><Clock3 size={13}/> Active recall</span></div><button className={'flash-card '+(flipped?'flipped':'')} onClick={()=>setFlipped(!flipped)}><span className="flash-label">{flipped?'ANSWER':'QUESTION'}</span><strong>{flipped?card.a:card.q}</strong><small>Click to reveal {flipped?'the question':'the answer'}</small></button><div className="flash-actions"><button className="secondary" onClick={prev}>← Previous</button><button className="primary" onClick={next}>Next card →</button></div></div>:<div className="empty flash-empty"><Layers3 size={52}/><b>Your revision deck is empty</b><span>Generate cards for any subject and use active recall to strengthen memory.</span></div>}</>
}

function SettingsPage({user,dark,setDark,logout,switchAccount,onUserUpdate,aiStatus}){
 const aiStatusDot=aiStatus?.configured?(aiStatus.model||'connected'):null;
  const [name,setName]=useState(user.name||''); const [email]=useState(user.email||''); const [oldPass,setOldPass]=useState(''); const [newPass,setNewPass]=useState(''); const [msg,setMsg]=useState(''); const [err,setErr]=useState(''); const [saving,setSaving]=useState(false); const [aiLanguage,setAiLanguage]=useState(()=>getAiLanguage());
 async function saveProfile(){setSaving(true);setMsg('');setErr('');try{const r=await api(`/users/${user.id}`,{method:'PUT',body:JSON.stringify({name})});const next={...user,...r,name:r.name||name};onUserUpdate(next);setMsg('Profile updated successfully ✨')}catch(e){setErr(e.message||'Could not update profile')}finally{setSaving(false)}}
 async function saveAiLanguage(value){
  const previous=getAiLanguage();
  setAiLanguage(value);setSaving(true);setMsg('');setErr('');
  try{
   const r=await api(`/users/${user.id}`,{method:'PUT',body:JSON.stringify({name:user.name||name,preferredAiLanguage:value})});
   localStorage.setItem(AI_LANGUAGE_KEY,value);
   onUserUpdate({...user,...r,preferredAiLanguage:value});
   setMsg(`AI language set to ${value} ✨ All new AI responses will use this language.`);
  }catch(e){setAiLanguage(previous);setErr(e.message||'Could not save AI language preference')}finally{setSaving(false)}
 }
 async function changePassword(){if(newPass.length<6){setErr('New password must be at least 6 characters.');return}setSaving(true);setMsg('');setErr('');try{await api(`/users/${user.id}/password`,{method:'POST',body:JSON.stringify({currentPassword:oldPass,newPassword:newPass})});setOldPass('');setNewPass('');setMsg('Password changed successfully 🔐')}catch(e){setErr(e.message||'Could not change password')}finally{setSaving(false)}}
 function clearLocal(){['nova_planner','nova_bookmarks','daily_goal','nova_courses_cache',AI_LANGUAGE_KEY].forEach(k=>localStorage.removeItem(k));setMsg('Local learning preferences cleared. Your server progress is safe.')}
 return <><div className="page-title"><span className="eyebrow">ACCOUNT & PREFERENCES</span><h1>Settings <span>& control.</span></h1><p>Manage your profile, appearance, security and local learning preferences.</p></div>{msg&&<div className="success-banner">{msg}</div>}{err&&<div className="error settings-error">{err}</div>}<div className="settings-grid"><section className="panel settings-card"><div className="panel-head"><div><span className="eyebrow">PROFILE</span><h3>Your account</h3></div><UserRound size={20}/></div><label>NAME</label><input value={name} onChange={e=>setName(e.target.value)} placeholder="Your name"/><label>EMAIL</label><input aria-label="Email address" value={email} disabled/><button className="primary" onClick={saveProfile} disabled={saving||!name.trim()}>Save profile</button></section><section className="panel settings-card"><div className="panel-head"><div><span className="eyebrow">APPEARANCE</span><h3>Choose your experience</h3></div><Lightbulb size={20}/></div><div className="theme-choice"><button className={!dark?'theme-option active':''} onClick={()=>setDark(false)}>☀️ <b>Bright</b><small>Clean light interface</small></button><button className={dark?'theme-option active':''} onClick={()=>setDark(true)}>🌙 <b>Dark</b><small>Comfortable low-light interface</small></button></div></section><section className="panel settings-card"><div className="panel-head"><div><span className="eyebrow">AI PREFERENCES</span><h3>AI response language</h3></div><Sparkles size={20}/></div><p className="settings-copy">Choose the language Nova AI should use for teaching, explanations, doubts, feedback, study plans, flashcards and interview responses.</p><label>SELECT LANGUAGE</label><select aria-label="AI response language" className="ai-language-select" value={aiLanguage} onChange={e=>saveAiLanguage(e.target.value)} disabled={saving}>{AI_LANGUAGES.map(lang=><option key={lang} value={lang}>{lang==='English/Hinglish'?'English + Hinglish (Default)':lang}</option>)}</select><small className="settings-copy">Technical terms and code syntax may remain in their standard form when needed for accuracy.</small></section><section className="panel settings-card settings-ai-status"><div className="panel-head"><div><span className="eyebrow">AI PROVIDER</span><h3>Connection status</h3></div><BrainCircuit size={20}/></div><p className="settings-copy">Nova runs on a Gemini-backed teaching service configured on the server. The API key is stored only in the backend environment (<code>GEMINI_API_KEY</code>) and is never sent to this browser.</p><div className="ai-status-row"><span className={'ai-status-dot '+(aiStatusDot?'on':'off')}/><div><b>{aiStatusDot?'Connected':'Not configured'}</b><small>{aiStatusDot?`Provider: Gemini · model ${aiStatusDot}`:'Ask your administrator to set GEMINI_API_KEY in backend/.env.properties and restart Spring Boot.'}</small></div></div></section><section className="panel settings-card"><div className="panel-head"><div><span className="eyebrow">SECURITY</span><h3>Change password</h3></div><span>🔐</span></div><input type="password" value={oldPass} onChange={e=>setOldPass(e.target.value)} placeholder="Current password"/><input type="password" value={newPass} onChange={e=>setNewPass(e.target.value)} placeholder="New password (6+ characters)"/><button className="primary" onClick={changePassword} disabled={saving||!oldPass||!newPass}>Update password</button></section><section className="panel settings-card"><div className="panel-head"><div><span className="eyebrow">SESSION</span><h3>Account controls</h3></div><LogOut size={20}/></div><p className="settings-copy">Logout removes your active session from this browser. Your courses and progress remain in MySQL.</p><button className="secondary full" onClick={logout}>Logout</button><button className="secondary full switch-account-btn" onClick={switchAccount}>Switch account</button><button className="text-btn settings-clear" onClick={clearLocal}>Clear local preferences</button></section></div></>}

window.addEventListener('error',(event)=>{console.error('NovaTutor global error',event.error||event.message)});
window.addEventListener('unhandledrejection',(event)=>{console.error('NovaTutor unhandled rejection',event.reason);event.preventDefault()});
createRoot(document.getElementById('root')).render(<ErrorBoundary><App/></ErrorBoundary>);

/* =====================================================================
   TOPNAV — premium horizontal navbar (replaces the vertical sidebar).
   Desktop: brand · four dropdown menus · search · appearance · account.
   Mobile (≤960px): brand · hamburger opening a full navigation sheet.
   Accessibility: menus are buttons with aria-expanded, panels are labelled
   nav regions, Escape closes, click-outside closes, focus ring on all
   interactive elements. No AI status, no refresh, no technical controls.
   ===================================================================== */
function TopNav({user,role,page,go,dark,setDark,navModel,activeGroup,mobile,setMobile,vp,logout,aiConfigured}){
 // Dropdowns start closed and render as floating overlays (zero layout shift).
 const [openMenu,setOpenMenu]=useState(null);
 const [accountOpen,setAccountOpen]=useState(false);
 const rootRef=useRef(null);
 const firstPage=useRef(page);
 useEffect(()=>{
  const close=e=>{if(rootRef.current&&!rootRef.current.contains(e.target)){setOpenMenu(null);setAccountOpen(false)}};
  const esc=e=>{if(e.key==='Escape'){setOpenMenu(null);setAccountOpen(false);setMobile(false)}};
  document.addEventListener('pointerdown',close);
  document.addEventListener('keydown',esc);
  return()=>{document.removeEventListener('pointerdown',close);document.removeEventListener('keydown',esc)};
 },[]);
 useEffect(()=>{if(firstPage.current===page)return;firstPage.current=page;setOpenMenu(null);setAccountOpen(false);setMobile(false)},[page]);
 const navigate=id=>{setOpenMenu(null);setAccountOpen(false);setMobile(false);go(id)};
 const initial=user.name?.[0]?.toUpperCase()||'U';
 return <header className={'topnav'+(openMenu&&!vp?' subnav-open':'')} ref={rootRef}>
  <div className="topnav-inner">
   <button className="topnav-brand" onClick={()=>navigate('dashboard')} aria-label="NovaTutor home">
    <BrandMark size={26}/><span>NovaTutor</span>
   </button>
   {!vp&&<nav className="topnav-menus" aria-label="Primary">
    {navModel.map(g=>{
     const isOpen=openMenu===g.id;
     const groupActive=activeGroup===g.id;
     return <div className="topnav-menu" key={g.id}>
      <button
       className={'topnav-menu-btn'+(isOpen?' open':'')+(groupActive?' current':'')}
       aria-expanded={isOpen} aria-haspopup="true"
       onClick={()=>setOpenMenu(isOpen?null:g.id)}>
       {g.label}<ChevronRight size={13}/>
      </button>
      {isOpen&&<div className="topnav-panel" role="menu">
       {g.items.map(([id,label,I])=>
        <button role="menuitem" key={id} className={'topnav-item'+(page===id?' active':'')} onClick={()=>navigate(id)}>
         <span className="topnav-item-icon"><I size={16}/></span>{label}{page===id&&<span className="topnav-here">•</span>}
        </button>)}
      </div>}
     </div>;
    })}
   </nav>}
   {vp&&<div className="topnav-mobile-center">
    <button className="topnav-icon-btn topnav-menu-toggle" aria-label={mobile?'Close navigation':'Open navigation'} aria-expanded={mobile} onClick={()=>setMobile(x=>!x)}>{mobile?'✕':<Menu size={18}/>}</button>
   </div>}
   <div className="topnav-right">
    {!vp&&<GlobalSearch courses={coursesSafe()} go={go}/>}
    {!vp&&<button className={'topnav-icon-btn'+(page==='notifications'?' has-badge':'')} aria-label="Today's plan" title="Today's plan" onClick={()=>go('notifications')}><Bell size={17}/></button>}
    <div className="topnav-account">
     <button className={'topnav-avatar'+(accountOpen?' open':'')} aria-expanded={accountOpen} aria-haspopup="true" aria-label="Account menu" onClick={()=>setAccountOpen(x=>!x)}>{initial}</button>
     {accountOpen&&<div className="topnav-panel account-panel" role="menu">
      <div className="topnav-account-head"><b>{user.name}</b><small>{role==='ADMIN'?'Administrator':role==='GUEST'?'Guest session':'Student'}</small></div>
      <button role="menuitem" className="topnav-item" onClick={()=>navigate('settings')}><span className="topnav-item-icon"><UserRound size={16}/></span>Settings</button>
      <button role="menuitem" className="topnav-item danger" onClick={logout}><span className="topnav-item-icon"><LogOut size={16}/></span>Log out</button>
     </div>}
    </div>
   </div>
  </div>
  {vp&&mobile&&<div className="topnav-sheet" role="dialog" aria-label="Navigation">
   {navModel.map(g=><div className="sheet-group" key={g.id}>
    <div className="sheet-group-label">{g.label}</div>
    {g.items.map(([id,label,I])=>
     <button key={id} className={'sheet-item'+(page===id?' active':'')} onClick={()=>navigate(id)}>
      <span className="topnav-item-icon"><I size={17}/></span>{label}
     </button>)}
   </div>)}
   <div className="sheet-group">
    <div className="sheet-group-label">Account</div>
    <button className={'sheet-item'+(page==='settings'?' active':'')} onClick={()=>navigate('settings')}><span className="topnav-item-icon"><UserRound size={17}/></span>Settings</button>
    <button className="sheet-item" onClick={logout}><span className="topnav-item-icon"><LogOut size={17}/></span>Log out</button>
   </div>
   <div className="sheet-foot">NovaTutor · Learning workspace</div>
  </div>}
 </header>;
}
/* Minimal course list for the navbar search on pages where the App-level
   courses array is not needed by TopNav's light footprint. */
function coursesSafe(){try{return JSON.parse(localStorage.getItem('nova_courses_cache')||'[]')}catch{return []}}

/* BrandMark — vector product logo. Geometric "N" built from two strokes +
   a corner node: precise, editorial, scales 16–64px, no raster. */
function BrandMark({size=26}){
 return <svg className="brand-mark" width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
  <rect x="1" y="1" width="30" height="30" rx="9.5" fill="var(--ink)"/>
  <path d="M9.4 23.2V10.6a1 1 0 0 1 1.72-.7L21.3 21.6" stroke="var(--on-ink)" strokeWidth="2.55" strokeLinecap="round" strokeLinejoin="round"/>
  <path d="M22.6 8.8v12.7" stroke="var(--on-ink)" strokeWidth="2.55" strokeLinecap="round"/>
  <circle cx="24.7" cy="6.9" r="2.1" fill="var(--live)"/>
 </svg>;
}



function AILearningProfile({user,courses,go}){
 const [state,setState]=useState(null),[adaptive,setAdaptive]=useState(null),[loading,setLoading]=useState(true),[goal,setGoal]=useState(user.learningGoal||''),[interests,setInterests]=useState(user.interests||''),[strengths,setStrengths]=useState(user.strengths||''),[weaknesses,setWeaknesses]=useState(user.weaknesses||''),[style,setStyle]=useState(user.learningStyle||'Visual + practical'),[saved,setSaved]=useState('');
 useEffect(()=>{
  let alive=true;
  const activeId=String(user.id);
  Promise.all([
    api(`/users/${user.id}`).catch(()=>null),
    api('/mentor/state/'+user.id).catch(()=>null),
    api('/adaptive/'+user.id).catch(()=>null)
  ]).then(([profile,a,b])=>{
    if(!alive)return;
    if(profile){
      setGoal(profile.learningGoal||'');setInterests(profile.interests||'');setStrengths(profile.strengths||'');setWeaknesses(profile.weaknesses||'');setStyle(profile.learningStyle||'Visual + practical');
      const current=readUser(); if(current&&String(current.id)===activeId){localStorage.setItem('ai_user',JSON.stringify({...current,...profile,token:current.token}))}
    }
    setState(a);setAdaptive(b)
  }).finally(()=>alive&&setLoading(false));
  return()=>{alive=false};
 },[user.id]);
 async function save(){
 setSaved('');
 const activeId=String(user.id);
 try{
  const payload={name:user.name,learningGoal:goal,interests,strengths,weaknesses,learningStyle:style,dailyStudyMinutes:Number(user.dailyStudyMinutes||60),preferredAiLanguage:getAiLanguage()};
  const updated=await api(`/users/${user.id}`,{method:'PUT',body:JSON.stringify(payload)});
  const current=readUser(); if(current&&updated&&String(current.id)===activeId) localStorage.setItem('ai_user',JSON.stringify({...current,...updated,token:current.token}));
  // Refresh all memory/intelligence layers immediately so the new profile affects recommendations without logout/reload.
  const [fresh,mentorFresh,adaptiveFresh,intelligenceFresh]=await Promise.all([
    api(`/users/${user.id}`).catch(()=>updated||null),
    api('/mentor/state/'+user.id).catch(()=>null),
    api('/adaptive/'+user.id).catch(()=>null),
    api('/intelligence/'+user.id).catch(()=>null)
  ]);
  const curAfter=readUser();
  if(!curAfter||String(curAfter.id)!==activeId)return;
  if(fresh){setGoal(fresh.learningGoal||goal);setInterests(fresh.interests||interests);setStrengths(fresh.strengths||strengths);setWeaknesses(fresh.weaknesses||weaknesses);setStyle(fresh.learningStyle||style);localStorage.setItem('ai_user',JSON.stringify({...curAfter,...fresh,token:curAfter.token}))}
  setState(mentorFresh);setAdaptive(adaptiveFresh);
  setSaved('Profile saved. Nova memory, adaptive data and recommendations were refreshed.');
 }catch(e){setSaved('Could not update profile: '+e.message)}
}
 const top=(adaptive?.revisions||[]).slice(0,3);const readiness=adaptive?.readiness?.readiness||0;
 return <><div className="page-title"><span className="eyebrow">V23 • PERSONAL AI TEACHER</span><h1>Your AI <span>learning profile.</span></h1><p>Nova uses this profile plus your real practice history to decide what to teach, how to explain it and what to revise next.</p></div>
 <div className="profile-ai-grid"><section className="panel profile-hero-card"><div className="profile-ai-avatar"><Brain size={30}/></div><div><span className="eyebrow">PERSONALIZED ENGINE</span><h2>{user.name||'Student'} • Nova remembers your learning context</h2><p>{state?.recommendedLevel?`Current level: ${state.recommendedLevel}.`: 'Complete more practice and Nova will calibrate your level automatically.'} {readiness?`Readiness: ${readiness}/100.`:''}</p></div><div className="profile-memory-badges"><span>Goal-aware</span><span>Weakness-aware</span><span>Style-aware</span></div></section>
 <section className="panel profile-form"><div className="panel-head"><div><span className="eyebrow">STUDENT MEMORY</span><h3>What should Nova remember?</h3></div><Sparkles size={19}/></div><label>LEARNING GOAL</label><textarea value={goal} onChange={e=>setGoal(e.target.value)} placeholder="e.g. GATE CSE + backend job"/><label>INTERESTS</label><textarea value={interests} onChange={e=>setInterests(e.target.value)} placeholder="e.g. Java, DSA, AI"/><label>STRENGTHS</label><textarea value={strengths} onChange={e=>setStrengths(e.target.value)} placeholder="What comes naturally to you?"/><label>WEAKNESSES</label><textarea value={weaknesses} onChange={e=>setWeaknesses(e.target.value)} placeholder="Where do you make repeated mistakes?"/><label>LEARNING STYLE</label><select aria-label="Learning style" value={style} onChange={e=>setStyle(e.target.value)}><option>Visual + practical</option><option>Step-by-step</option><option>Example-first</option><option>Practice-first</option><option>Fast revision</option></select><button className="primary" onClick={save}>Save AI memory <CheckCircle2 size={15}/></button>{saved&&<div className="success-banner">{saved}</div>}</section>
 <section className="panel profile-insights"><div className="panel-head"><div><span className="eyebrow">HOW NOVA ADAPTS</span><h3>Your teaching recipe</h3></div><Lightbulb size={19}/></div><div className="recipe"><div><b>1</b><span><strong>Choose the next topic</strong><small>Uses weak areas, due revisions and course progress.</small></span></div><div><b>2</b><span><strong>Choose the explanation style</strong><small>{style} explanations with examples and visual structure when useful.</small></span></div><div><b>3</b><span><strong>Choose the practice</strong><small>Adaptive questions and DPPs target concepts you actually need.</small></span></div><div><b>4</b><span><strong>Update memory</strong><small>New quiz results and mistakes change your future recommendations.</small></span></div></div><button className="secondary" onClick={()=>go('mentor')}>Open Adaptive Mentor <ChevronRight size={14}/></button></section>
 <section className="panel profile-revision"><div className="panel-head"><div><span className="eyebrow">MEMORY → ACTION</span><h3>Current priorities</h3></div><Target size={19}/></div>{loading?<div className="empty small"><RefreshCw/><b>Reading your learning history…</b></div>:top.length?top.map((x,i)=><div className="priority-row" key={i}><span>{i+1}</span><div><b>{x.subject}</b><small>{x.topic} • {x.reason}</small></div><strong>{x.dueLabel||'Review soon'}</strong></div>):<div className="empty small"><Target/><b>No priorities yet</b><span>Complete quizzes or DPPs to give Nova more learning signals.</span></div>}</section></div></>
}


const GATE_EXAM_BANK=[
 ['Discrete Mathematics','Which statement is always true for a simple undirected graph?',['Every vertex has even degree','Sum of vertex degrees is twice the number of edges','It must be connected','It must contain a cycle'],1,1],
 ['Data Structures','Which traversal of a binary search tree visits keys in nondecreasing order?',['Preorder','Postorder','Inorder','Level order'],2,1],
 ['Algorithms','For a comparison-based sorting algorithm, the worst-case lower bound is:',['Ω(n)','Ω(log n)','Ω(n log n)','Ω(n²)'],2,1],
 ['Operating Systems','Which scheduling algorithm can cause starvation of low-priority processes?',['FCFS','Round Robin','Priority scheduling','FIFO page replacement'],2,1],
 ['DBMS','Which normal form removes transitive functional dependencies of non-key attributes?',['1NF','2NF','3NF','BCNF'],2,1],
 ['Computer Networks','Which protocol provides reliable byte-stream delivery?',['UDP','IP','TCP','ARP'],2,1],
 ['TOC','A language accepted by a DFA is always:',['Context-sensitive only','Regular','Context-free but not regular','Undecidable'],1,1],
 ['Compiler Design','The lexical analyzer primarily converts:',['Tokens to parse trees','Characters to tokens','Parse trees to code','IR to machine code'],1,1],
 ['Computer Organization','Which memory is closest to the CPU and typically fastest?',['Hard disk','Main memory','Cache','Optical disk'],2,1],
 ['Digital Logic','A 4-variable Karnaugh map contains how many cells?',['4','8','16','32'],2,1],
 ['Discrete Mathematics','A tree with n vertices has how many edges?',['n-1','n','n+1','2n'],0,1],
 ['Data Structures','Average-case search time in a well-designed hash table is closest to:',['O(1)','O(log n)','O(n)','O(n log n)'],0,1],
 ['Algorithms','Dijkstra’s algorithm is not directly applicable when an edge has:',['Positive weight','Zero weight','Negative weight','Integer weight'],2,1],
 ['Operating Systems','A page fault occurs when:',['CPU cache misses','A referenced page is not in main memory','Disk is full','Process exits'],1,1],
 ['DBMS','Which property of a transaction means all-or-nothing execution?',['Consistency','Isolation','Atomicity','Durability'],2,1],
 ['Computer Networks','A /24 IPv4 network contains how many usable host addresses?',['254','256','255','252'],0,1],
 ['TOC','Which machine recognizes exactly the context-free languages?',['DFA','PDA','Turing machine only','Finite automaton'],1,1],
 ['Compiler Design','Which phase typically checks grammatical structure?',['Lexical analysis','Syntax analysis','Code generation','Linking'],1,1],
 ['Computer Organization','In two’s complement, an n-bit signed integer range is:',['0 to 2^n-1','-2^(n-1) to 2^(n-1)-1','-2^n to 2^n','-2^(n-1)+1 to 2^(n-1)'],1,1],
 ['Digital Logic','Which gate is functionally complete by itself?',['XOR','AND','NAND','XNOR'],2,1]
];
function ExamSimulator({user}){
 const TOTAL=20;const bestKey=`nova_exam_best_${user?.id||'guest'}`;
 const [started,setStarted]=useState(false),[finished,setFinished]=useState(false),[index,setIndex]=useState(0),[answers,setAnswers]=useState({}),[time,setTime]=useState(30*60),[review,setReview]=useState({}),[score,setScore]=useState(null),[best,setBest]=useState(()=>Number(localStorage.getItem(bestKey)||localStorage.getItem('nova_exam_best')||0)),[strategy,setStrategy]=useState(''),[strategyBusy,setStrategyBusy]=useState(false);
 const [questions,setQuestions]=useState(()=>[...GATE_EXAM_BANK].sort(()=>Math.random()-.5));
 useModulePersistence(user?.id,'exam',{started,finished,index,answers,time,review,score,questions,strategy},{started:x=>setStarted(Boolean(x)),finished:x=>setFinished(Boolean(x)),index:x=>setIndex(Number(x)||0),answers:x=>setAnswers(x||{}),time:x=>setTime(Number(x)||0),review:x=>setReview(x||{}),score:x=>setScore(x??null),questions:x=>setQuestions(Array.isArray(x)&&x.length?x:GATE_EXAM_BANK),strategy:x=>setStrategy(x||'')});
 function finish(){let marks=0;questions.forEach((q,i)=>{if(answers[i]===q[3])marks+=q[4]});setScore(marks);setFinished(true);setStarted(false);if(marks>best){setBest(marks);localStorage.setItem(bestKey,String(marks))}}
 const finishRef=useRef(finish);finishRef.current=finish;
 useEffect(()=>{if(!started||finished)return;const id=setInterval(()=>setTime(t=>{if(t<=1){clearInterval(id);setTimeout(()=>finishRef.current(),0);return 0}return t-1}),1000);return()=>clearInterval(id)},[started,finished]);
 function start(){setQuestions([...GATE_EXAM_BANK].sort(()=>Math.random()-.5));setAnswers({});setReview({});setIndex(0);setTime(30*60);setFinished(false);setScore(null);setStrategy('');setStarted(true)}
 async function generateStrategy(){if(score===null)return;setStrategyBusy(true);try{const subjectLines=[...new Set(questions.map(q=>q[0]))].map(sub=>{const qs=questions.map((q,i)=>({q,i})).filter(x=>x.q[0]===sub);const got=qs.filter(x=>answers[x.i]===x.q[3]).length;return `${sub}: ${got}/${qs.length}`}).join('; ');const r=await api('/ai/ask',{method:'POST',body:JSON.stringify({task:'EXAM_STRATEGY',topic:'GATE CSE mock analysis',message:`Student completed a 20-question GATE CSE mock. Score: ${score}/20. Subject results: ${subjectLines}. Give a concise exam strategy: 3 strengths, 3 weak areas, what to revise first, and a 3-day recovery plan. Do not invent data beyond these results.`,level:'exam-focused',language:getAiLanguage()})});setStrategy(r.answer||'No strategy returned.')}catch(e){setStrategy('AI strategy unavailable right now. Review the subject breakdown and try again later.')}finally{setStrategyBusy(false)}}
 const answered=Object.keys(answers).length;const mins=String(Math.floor(time/60)).padStart(2,'0'),secs=String(time%60).padStart(2,'0');
 if(!started&&!finished)return <><div className="page-title"><span className="eyebrow">V24 • EXAM INTELLIGENCE</span><h1>Exam <span>Simulator.</span></h1><p>Practice in a focused exam environment with a timer, question palette, review marks and a detailed result.</p></div><div className="exam-start-grid"><section className="panel exam-hero"><div className="exam-hero-icon"><Trophy size={34}/></div><span className="eyebrow">GATE CSE • MOCK TEST</span><h2>20 questions • 30 minutes</h2><p>Mixed CSE subjects, one mark each. Navigate freely, mark questions for review and submit when ready. Your best score is saved on this device.</p><div className="exam-rules"><span><Clock3 size={15}/> 30 min timer</span><span><Target size={15}/> 20 marks</span><span><RotateCcw size={15}/> Mark for review</span><span><BarChart3 size={15}/> Instant analysis</span></div><button className="primary" onClick={start}>Start mock test <ChevronRight size={15}/></button></section><section className="panel exam-blueprint"><div className="panel-head"><div><span className="eyebrow">BLUEPRINT</span><h3>What you'll practice</h3></div><Brain size={19}/></div>{['Algorithms & Data Structures','DBMS & Operating Systems','Networks & TOC','Compiler & COA','Discrete Mathematics & Digital Logic'].map((x,i)=><div className="blueprint-row" key={x}><span>{i+1}</span><b>{x}</b><small>4 questions</small></div>)}<div className="best-score"><span>Best score</span><strong>{best}/20</strong></div></section></div></>;
 if(finished){const pct=Math.round((score/TOTAL)*100);return <><div className="page-title"><span className="eyebrow">MOCK TEST COMPLETE</span><h1>Your exam <span>report.</span></h1><p>Use the result to decide what to revise next.</p></div><section className="panel exam-result-hero"><div className="exam-score-ring"><b>{score}</b><span>/20</span></div><div><span className="eyebrow">TOTAL MARKS</span><h2>{pct}% score</h2><p>{score>=16?'Strong performance — move to harder PYQs.':score>=11?'Good base — revise the weak subjects before another mock.':'Use the subject breakdown below and start a focused recovery session.'}</p></div><button className="primary" onClick={start}>Retake test <RotateCcw size={14}/></button></section><section className="panel exam-breakdown"><div className="panel-head"><div><span className="eyebrow">SUBJECT BREAKDOWN</span><h3>Where you lost marks</h3></div><BarChart3 size={19}/></div>{[...new Set(questions.map(q=>q[0]))].map(sub=>{const qs=questions.map((q,i)=>({q,i})).filter(x=>x.q[0]===sub);const got=qs.filter(x=>answers[x.i]===x.q[3]).length;return <div className="exam-subject-row" key={sub}><div><b>{sub}</b><small>{got}/{qs.length} correct</small></div><div className="exam-mini-bar"><i style={{width:(got/qs.length*100)+'%'}}/></div><strong>{Math.round(got/qs.length*100)}%</strong></div>})}</section><section className="panel exam-strategy"><div className="panel-head"><div><span className="eyebrow">AI EXAM COACH</span><h3>Turn this test into a plan</h3></div><Sparkles size={19}/></div><button className="secondary" onClick={generateStrategy} disabled={strategyBusy}>{strategyBusy?'Analyzing your result…':'Generate AI strategy'} <Sparkles size={14}/></button>{strategy&&<div className="exam-strategy-text"><AiMarkdown content={strategy}/></div>}</section><section className="panel exam-review"><div className="panel-head"><div><span className="eyebrow">QUESTION REVIEW</span><h3>Learn from every mistake</h3></div><Target size={19}/></div>{questions.map((q,i)=><div className={'exam-review-row '+(answers[i]===q[3]?'good':'bad')} key={i}><span>Q{i+1}</span><div><b>{q[0]}</b><p>{answers[i]===undefined?'Not answered':answers[i]===q[3]?'Correct':'Wrong'}</p><small>{q[1]}</small></div><strong>{answers[i]===q[3]?'+1':'0'}</strong></div>)}</section></>}
 const q=questions[index];return <><div className="exam-topbar"><div><span className="eyebrow">GATE CSE MOCK • {answered}/{TOTAL} ANSWERED</span><h2>Question {index+1} of {TOTAL}</h2></div><div className="exam-timer"><Clock3 size={17}/><b>{mins}:{secs}</b></div></div><div className="exam-layout"><section className="panel exam-question"><div className="exam-question-meta"><span>{q[0]}</span><span>1 mark</span>{review[index]&&<span className="review-pill">Marked for review</span>}</div><h2>Question {index+1}</h2><p className="exam-question-text">{q[1]}</p><div className="exam-options">{q[2].map((o,i)=><button key={i} className={answers[index]===i?'selected':''} onClick={()=>{setAnswers(a=>({...a,[index]:i}));if(index<TOTAL-1)setTimeout(()=>setIndex(x=>Math.min(TOTAL-1,x+1)),350)}}><span>{String.fromCharCode(65+i)}</span>{o}</button>)}</div><div className="exam-actions"><button className="secondary" onClick={()=>setReview(r=>({...r,[index]:!r[index]}))}><RotateCcw size={14}/>{review[index]?'Unmark review':'Mark for review'}</button><div><button className="secondary" onClick={()=>setIndex(i=>Math.max(0,i-1))} disabled={index===0}>Previous</button><button className="primary" onClick={()=>index===TOTAL-1?finish():setIndex(i=>Math.min(TOTAL-1,i+1))}>{index===TOTAL-1?'Submit test':'Save & next'} <ChevronRight size={14}/></button></div></div></section><aside className="panel exam-palette"><div className="panel-head"><div><span className="eyebrow">QUESTION PALETTE</span><h3>Navigate</h3></div><Target size={18}/></div><div className="palette-grid">{questions.map((_,i)=><button key={i} className={(i===index?'current ':'')+(answers[i]!==undefined?'answered ':'')+(review[i]?'review':'')} onClick={()=>setIndex(i)}>{i+1}</button>)}</div><div className="palette-legend"><span><i className="current"/> Current</span><span><i className="answered"/> Answered</span><span><i className="review"/> Review</span></div><button className="danger-btn full" onClick={finish}>Submit test</button></aside></div></>;
}

function Interviewer({user}){
 const [subject,setSubject]=useState('Java'),[mode,setMode]=useState('Standard'),[type,setType]=useState('Technical'),[role,setRole]=useState('Java Developer'),[difficulty,setDifficulty]=useState('Intermediate'),[qno,setQno]=useState(0),[question,setQuestion]=useState(''),[answer,setAnswer]=useState(''),[feedback,setFeedback]=useState(''),[loading,setLoading]=useState(false),[started,setStarted]=useState(false),[speaking,setSpeaking]=useState(false),[listening,setListening]=useState(false),[scores,setScores]=useState([]),[finished,setFinished]=useState(false),[coachReview,setCoachReview]=useState(''),[coachLoading,setCoachLoading]=useState(false);
 useModulePersistence(user?.id,'interview',{subject,mode,type,role,difficulty,qno,question,answer,feedback,started,scores,finished,coachReview},{subject:x=>setSubject(x||'Java'),mode:x=>setMode(x||'Standard'),type:x=>setType(x||'Technical'),role:x=>setRole(x||'Java Developer'),difficulty:x=>setDifficulty(x||'Intermediate'),qno:x=>setQno(Number(x)||0),question:x=>setQuestion(x||''),answer:x=>setAnswer(x||''),feedback:x=>setFeedback(x||''),started:x=>setStarted(Boolean(x)),scores:x=>setScores(Array.isArray(x)?x:[]),finished:x=>setFinished(Boolean(x)),coachReview:x=>setCoachReview(x||'')});const recognitionRef=React.useRef(null);const supported=typeof window!=='undefined'&&(window.SpeechRecognition||window.webkitSpeechRecognition);const TOTAL=10;
 const speechSessionRef=React.useRef(0);
 function stopSpeech(){speechSessionRef.current+=1;try{if(window.speechSynthesis){window.speechSynthesis.cancel();if(window.speechSynthesis.paused){window.speechSynthesis.resume();window.speechSynthesis.cancel();}}}catch{}setSpeaking(false);}
 function speak(text=question){if(!text||!window.speechSynthesis)return;stopSpeech();const thisSession=++speechSessionRef.current;setSpeaking(true);const u=new SpeechSynthesisUtterance(text);u.rate=0.98;u.pitch=1.0;u.volume=1;const lang=getSpeechLanguage();u.lang=lang;const voice=getBestNaturalVoice(lang);if(voice)u.voice=voice;u.onstart=()=>{if(thisSession===speechSessionRef.current)setSpeaking(true);else{try{window.speechSynthesis.cancel()}catch{}}};u.onend=()=>{if(thisSession===speechSessionRef.current)setSpeaking(false)};u.onerror=()=>{if(thisSession===speechSessionRef.current)setSpeaking(false)};try{window.speechSynthesis.speak(u)}catch{if(thisSession===speechSessionRef.current)setSpeaking(false);}}
 const listenRestartRef=React.useRef(false);
 function stopListen(){listenRestartRef.current=false;try{recognitionRef.current?.stop()}catch{}recognitionRef.current=null;setListening(false)}
 function listen(){if(listening){stopListen();return}if(!supported)return;stopSpeech();listenRestartRef.current=true;const SR=window.SpeechRecognition||window.webkitSpeechRecognition;const startRecognition=()=>{if(!listenRestartRef.current)return;const r=new SR();recognitionRef.current=r;r.lang=getSpeechLanguage();r.interimResults=true;r.continuous=true;r.onstart=()=>setListening(true);r.onend=()=>{recognitionRef.current=null;if(listenRestartRef.current){setTimeout(startRecognition,120);return}setListening(false)};r.onresult=e=>{let t='';for(let i=0;i<e.results.length;i++)t+=e.results[i][0].transcript+' ';setAnswer(t.trim())};r.onerror=e=>{if(e?.error==='not-allowed'||e?.error==='service-not-allowed'){listenRestartRef.current=false;setListening(false);recognitionRef.current=null}};try{r.start()}catch{if(listenRestartRef.current)setTimeout(startRecognition,250)}};startRecognition()}
 function extractScore(text){const m=String(text||'').match(/(?:score|rating)\s*(?:is|of)?\s*[:\-]?\s*(\d{1,2})(?:\s*\/\s*10)?/i);return m?Math.min(10,Number(m[1])):null}
 async function askNext(questionNumber,candidateAnswer=''){setLoading(true);try{const r=await api('/interview/ask',{method:'POST',body:JSON.stringify({type,role,difficulty,questionNumber,answer:candidateAnswer,subject,mode,language:getAiLanguage()})});const text=r.answer||'';setQuestion(text);setFeedback(candidateAnswer?text:'');const score=extractScore(text);if(candidateAnswer&&score!==null)setScores(prev=>[...prev,score]);setStarted(true);setQno(questionNumber);setAnswer('');}catch(e){setFeedback('Interview AI unavailable. '+e.message)}finally{setLoading(false)}}
 function start(){stopSpeech();stopListen();setScores([]);setFinished(false);setCoachReview('');setQuestion('');setFeedback('');setAnswer('');askNext(1,'')}
 async function submit(){if(!answer.trim()||loading)return;if(qno>=TOTAL){setLoading(true);try{const r=await api('/interview/ask',{method:'POST',body:JSON.stringify({type,role,difficulty,questionNumber:TOTAL,answer,subject,mode,language:getAiLanguage()})});const text=r.answer||'';setFeedback(text);const score=extractScore(text);const finalScores=score===null?scores:[...scores,score];setScores(finalScores);setAnswer('');setFinished(true);setQno(TOTAL)}catch(e){setFeedback('Interview AI unavailable. '+e.message)}finally{setLoading(false)}return}await askNext(qno+1,answer)}
 const avg=scores.length?Math.round(scores.reduce((a,b)=>a+b,0)/scores.length*10)/10:0;const progress=Math.round((Math.min(qno,TOTAL)/TOTAL)*100);
 useEffect(()=>()=>{stopSpeech();stopListen()},[]);
 return <><div className="page-title"><span className="eyebrow">SMART INTERVIEW • {TOTAL} ROUNDS</span><h1>AI <span>Interview.</span></h1><p>Select your subject and interview mode. Nova asks realistic questions, accepts voice or text answers, and tracks your progress.</p></div><div className="interview-grid"><div className="interview-control"><div className="interview-icon"><UserRound/></div><h3>Interview setup</h3><label>SUBJECT</label><select aria-label="Subject" value={subject} onChange={e=>setSubject(e.target.value)}><option>Java</option><option>DSA</option><option>Spring Boot</option><option>DBMS</option><option>Computer Networks</option><option>Operating Systems</option><option>JavaScript / React</option><option>HR & Behavioral</option></select><label>INTERVIEW MODE</label><select aria-label="Interview mode" value={mode} onChange={e=>setMode(e.target.value)}><option>Standard</option><option>Rapid Fire</option><option>Deep Dive</option><option>Concept + Coding</option></select><label>TYPE</label><select aria-label="Question type" value={type} onChange={e=>setType(e.target.value)}><option>Technical</option><option>HR</option><option>Mixed</option></select><label>ROLE</label><input value={role} onChange={e=>setRole(e.target.value)} placeholder="Java Developer"/><label>DIFFICULTY</label><select aria-label="Difficulty" value={difficulty} onChange={e=>setDifficulty(e.target.value)}><option>Beginner</option><option>Intermediate</option><option>Advanced</option></select><div className="interview-meter"><span>Progress {Math.min(qno,TOTAL)} / {TOTAL}</span><div><i style={{width:progress+'%'}}/></div><small>{scores.length?`Average score: ${avg}/10`:'Your score will appear after answers.'}</small></div><button className="primary full" onClick={start} disabled={loading}>{loading?'Starting…':'Start AI interview'} <Trophy size={15}/></button></div><div className="interview-room"><div className="room-top"><div><span className="eyebrow">{finished?'INTERVIEW COMPLETE':`QUESTION ${Math.min(Math.max(qno,1),TOTAL)} / ${TOTAL}`}</span><h3>{finished?'Performance review':'Candidate round'}</h3></div><div className="voice-actions"><button className={speaking?'danger-btn':'secondary'} onClick={()=>speaking?stopSpeech():speak()} disabled={!question}>{speaking?<><StopCircle size={15}/> Stop voice</>:<><Volume2 size={15}/> Read aloud</>}</button><button className={listening?'danger-btn':'secondary'} onClick={listen} disabled={!started||finished}>{listening?<><MicOff size={15}/> Stop mic</>:<><Mic size={15}/> Voice answer</>}</button></div></div>{question&&!finished?<div className="question-card"><span>AI INTERVIEWER • {subject} • {mode}</span><div><AiMarkdown content={question}/></div></div>:finished?<div className="interview-result"><Trophy size={40}/><span className="eyebrow">FINAL RESULT</span><h2>{avg}/10 average</h2><p>{avg>=8?'Excellent interview readiness.':avg>=6?'Good progress — revise weak areas and retry.':'Keep practicing — focus on fundamentals and explanation quality.'}</p><div className="result-progress"><span style={{width:(avg/10*100)+'%'}}/></div><small>{scores.length} scored answers across {TOTAL} rounds.</small><button className="secondary" disabled={coachLoading||!scores.length} onClick={async()=>{setCoachLoading(true);try{const r=await api('/ai/ask',{method:'POST',body:JSON.stringify({task:'INTERVIEW',topic:`${role} interview coaching`,message:`Create a concise post-interview coaching report. Subject: ${subject}. Mode: ${mode}. Difficulty: ${difficulty}. Scores: ${scores.join(', ')}. Average: ${avg}/10. Give 3 strengths, 3 areas to improve, and a 7-day practice plan. Be specific and practical.`,level:difficulty.toLowerCase(),language:getAiLanguage()})});setCoachReview(r.answer||'No coaching report returned.')}catch(e){setCoachReview('Could not generate the coaching report. Please retry.')}finally{setCoachLoading(false)}}}>{coachLoading?'Generating coach report…':'Generate AI coach report'} <Sparkles size={14}/></button>{coachReview&&<div className="interview-coach-report"><b>AI Coach Report</b><div><AiMarkdown content={coachReview}/></div></div>}</div>:<div className="empty interview-empty"><UserRound size={44}/><b>Your interviewer is ready</b><span>Choose a subject, mode and difficulty, then start.</span></div>}{!finished&&<textarea value={answer} onChange={e=>setAnswer(e.target.value)} rows="6" placeholder="Type your answer or use Voice answer…" disabled={!started}/>} {!finished&&<div className="interview-actions"><button className="primary" onClick={submit} disabled={!started||loading||!answer.trim()}>{loading?'Evaluating…':qno>=TOTAL?'Finish interview':'Submit answer & next'} <Send size={14}/></button><button className="secondary" onClick={()=>setAnswer('')}>Clear</button></div>}{feedback&&!finished&&<div className="interview-feedback"><b>AI feedback</b><div><AiMarkdown content={feedback}/></div></div>}{!finished&&scores.length>0&&<div className="interview-progress-card"><b>Live progress</b><span>{scores.length} answers scored • average {avg}/10</span><div className="result-progress"><span style={{width:(avg/10*100)+'%'}}/></div></div>}</div></div></>}

function VoiceTutor({user}){
 const memory=readVoiceTutorMemory(user?.id);
 const [heard,setHeard]=useState(memory.message||''),[answer,setAnswer]=useState(memory.answer||''),[loading,setLoading]=useState(false),[listening,setListening]=useState(false),[speaking,setSpeaking]=useState(false);
 const recognitionRef=React.useRef(null);
 const playbackSessionRef=React.useRef(0);
 const isSpeakingRef=React.useRef(false);
 const abortControllerRef=React.useRef(null);
 const supported=typeof window!=='undefined'&&(window.SpeechRecognition||window.webkitSpeechRecognition);

 useEffect(()=>{
  const apply=()=>{const m=readVoiceTutorMemory(user?.id);setHeard(m.message||'');setAnswer(m.answer||'');};
  window.addEventListener('nova:voice-tutor-memory-updated',apply);
  return()=>window.removeEventListener('nova:voice-tutor-memory-updated',apply);
 },[user?.id]);

 function stopSpeaking(){
  playbackSessionRef.current+=1;
  if(abortControllerRef.current){
   try{abortControllerRef.current.abort()}catch{}
   abortControllerRef.current=null;
  }
  try{
   if(window.speechSynthesis){
    window.speechSynthesis.cancel();
    if(window.speechSynthesis.paused){
     window.speechSynthesis.resume();
     window.speechSynthesis.cancel();
    }
   }
  }catch{}
  isSpeakingRef.current=false;
  setSpeaking(false);
 }

 function stopListening(){
  try{recognitionRef.current?.abort()}catch{}
  recognitionRef.current=null;
  setListening(false);
 }

 function clearSession(){
  stopSpeaking();
  stopListening();
  setHeard('');
  setAnswer('');
  setLoading(false);
  saveVoiceTutorMemory(user?.id,{topic:'Voice learning',message:'',answer:'',feedback:'',studentAnswer:'',answerSubmitted:false,history:[]});
 }

 function speak(){
  const raw=String(answer||'').trim();
  if(!raw||!window.speechSynthesis)return;

  stopSpeaking();
  const thisSession=++playbackSessionRef.current;
  isSpeakingRef.current=true;
  setSpeaking(true);

  const cleanText=raw
   .replace(/[*_#`~>]/g,'')
   .replace(/\[([^\]]+)\]\([^\)]+\)/g,'$1')
   .replace(/\s+/g,' ')
   .trim();

  const rawChunks=cleanText.match(/[^.!?\n]+[.!?\n]+|[^.!?\n]+$/g)||[cleanText];
  const chunks=[];
  for(const c of rawChunks){
   const trimmed=c.trim();
   if(!trimmed)continue;
   if(trimmed.length>180){
    const sub=trimmed.match(/[^,;]+[,;]+|[^,;]+$/g)||[trimmed];
    for(const s of sub){if(s.trim())chunks.push(s.trim());}
   }else{
    chunks.push(trimmed);
   }
  }

  if(!chunks.length){
   isSpeakingRef.current=false;
   setSpeaking(false);
   return;
  }

  let chunkIndex=0;
  const targetLang=getVoiceTutorLanguage();
  const voice=getBestNaturalVoice(targetLang);

  const playNext=()=>{
   if(thisSession!==playbackSessionRef.current)return;
   if(chunkIndex>=chunks.length){
    isSpeakingRef.current=false;
    setSpeaking(false);
    return;
   }
   const textChunk=chunks[chunkIndex++];
   const u=new SpeechSynthesisUtterance(textChunk);
   u.lang=targetLang;
   u.rate=0.98;
   u.pitch=1.0;
   u.volume=1;
   if(voice)u.voice=voice;

   u.onstart=()=>{
    if(thisSession!==playbackSessionRef.current){
     try{window.speechSynthesis.cancel()}catch{}
     return;
    }
    isSpeakingRef.current=true;
    setSpeaking(true);
   };
   u.onend=()=>{
    if(thisSession!==playbackSessionRef.current)return;
    playNext();
   };
   u.onerror=(e)=>{
    if(thisSession!==playbackSessionRef.current)return;
    if(e?.error==='interrupted'||e?.error==='canceled')return;
    isSpeakingRef.current=false;
    setSpeaking(false);
   };

   try{
    window.speechSynthesis.speak(u);
   }catch{
    if(thisSession===playbackSessionRef.current){
     isSpeakingRef.current=false;
     setSpeaking(false);
    }
   }
  };

  playNext();
 }

 function handleVoiceToggle(){
  if(isSpeakingRef.current||speaking){
   stopSpeaking();
  }else{
   speak();
  }
 }

 function listen(){
  if(listening){stopListening();return}
  if(!supported){setHeard('Voice recognition is not supported in this browser. Chrome works best.');return}
  stopSpeaking();
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  const r=new SR();
  recognitionRef.current=r;
  r.lang=getVoiceTutorLanguage();
  r.interimResults=true;
  r.continuous=false;
  r.onstart=()=>setListening(true);
  r.onend=()=>{setListening(false);recognitionRef.current=null};
  r.onresult=e=>{let t='';for(let i=0;i<e.results.length;i++)t+=e.results[i][0].transcript+' ';setHeard(t.trim())};
  r.onerror=e=>{setListening(false);recognitionRef.current=null;if(e?.error!=='aborted')setHeard('Microphone/voice recognition failed. Please allow microphone access.')};
  try{r.start()}catch{stopListening()}
 }

 async function ask(){
  if(!heard.trim())return;
  stopSpeaking();
  stopListening();
  setLoading(true);

  if(abortControllerRef.current){
   try{abortControllerRef.current.abort()}catch{}
  }
  const ac=new AbortController();
  abortControllerRef.current=ac;

  try{
   const voiceContextKey='voice';
   const spokenQuestion=heard.trim();
   const spokenRequest=`CURRENT SPOKEN FOLLOW-UP QUESTION\nThis is a NEW question spoken by the student after they may have just studied a lesson with the AI Teacher. Answer ONLY this current spoken question.\n\nIMPORTANT CONTEXT ISOLATION RULES:\n- Do NOT continue, repeat, summarize, or complete the previous lesson explanation.\n- Do NOT assume the previous lesson topic is the topic of this question.\n- Treat the spoken question below as the highest-priority topic.\n- Use the previous lesson only if the student explicitly refers to it with words such as "that", "it", "the previous concept", or "what you just explained".\n- If the question is self-contained, answer it as a completely fresh question.\n- Never answer the previous lesson merely because the current question is short.\n\nAnswer this spoken student question in the configured AI response language with a warm conversational tutor style. Explain the current question step-by-step, include examples when useful, and finish with one short check question. Do not repeat the student's question.\n\nCURRENT SPOKEN QUESTION ONLY:\n${spokenQuestion}`;
   const r=await api('/ai/ask',{signal:ac.signal,method:'POST',body:JSON.stringify({task:'TUTOR',topic:'Current spoken question (ignore previous lesson topic unless explicitly referenced)',message:spokenRequest,level:'beginner',language:getAiLanguage()})});
   if(ac.signal.aborted)return;
   const nextAnswer=r.answer||'';
   setAnswer(nextAnswer);
   saveVoiceTutorMemory(user?.id,{topic:'Voice learning',message:spokenQuestion,answer:nextAnswer,feedback:'',studentAnswer:'',answerSubmitted:false,contextKey:voiceContextKey});
   appendVoiceTutorTurn(user?.id,'USER',spokenQuestion,{topic:'Voice learning',source:'voice-tutor',contextKey:voiceContextKey});
   appendVoiceTutorTurn(user?.id,'ASSISTANT',nextAnswer,{topic:'Voice learning',source:'voice-tutor',contextKey:voiceContextKey});
  }catch(e){
   if(ac.signal.aborted)return;
   setAnswer('Voice tutor unavailable. '+e.message);
  }finally{
   if(!ac.signal.aborted)setLoading(false);
  }
 }

 useEffect(()=>{
  const refresh=()=>{try{window.speechSynthesis?.getVoices()}catch{}};
  refresh();
  window.speechSynthesis?.addEventListener?.('voiceschanged',refresh);
  return()=>window.speechSynthesis?.removeEventListener?.('voiceschanged',refresh);
 },[]);

 useEffect(()=>()=>{
  stopSpeaking();
  stopListening();
 },[]);

 return <><div className="page-title"><span className="eyebrow">VOICE LEARNING • NATURAL SPEECH</span><h1>Voice <span>Tutor.</span></h1><p>Type or speak naturally. Nova answers, and you can listen to the explanation.</p></div><div className="voice-grid"><div className="voice-card voice-main"><div className={'mic-orb '+(listening?'listening':'')}><Mic size={48}/></div><h2>{listening?'Listening…':'Talk to your tutor'}</h2><p>Use the composer below to type a question or speak it with your microphone.</p><div className="voice-composer"><textarea value={heard} onChange={e=>setHeard(e.target.value)} rows="3" placeholder={listening?'Listening… speak naturally':'Type your question or tap the microphone to speak…'} disabled={loading}/><div className="voice-composer-actions"><button type="button" className={listening?'danger-btn':'secondary'} onClick={listen}>{listening?<><MicOff size={15}/> Stop listening</>:<><Mic size={15}/> Speak</>}</button><button type="button" className="primary" onClick={ask} disabled={!heard.trim()||loading}>{loading?'Thinking…':'Ask Nova AI'} <Send size={14}/></button></div></div><button className="secondary" onClick={clearSession} disabled={listening||speaking||loading}><Trash2 size={15}/> Clear conversation</button>{!supported&&<small className="voice-note">Your browser does not expose SpeechRecognition. Chrome generally works best.</small>}</div><div className="voice-card voice-answer"><div className="answer-head"><div className="ai-avatar"><Volume2 size={17}/></div><div><b>Nova AI</b><small>Teaching response</small></div></div><div className="voice-text answer voice-answer-scroll">{answer?<AiMarkdown content={answer}/>:<span className="muted">Your AI explanation will appear here.</span>}</div><div className="voice-audio-actions"><button type="button" className={speaking?'danger-btn':'secondary'} onClick={handleVoiceToggle} disabled={!answer}>{speaking?<><StopCircle size={15}/> Stop voice</>:<><Volume2 size={15}/> Read answer aloud</>}</button>{speaking&&<button type="button" className="secondary" onClick={stopSpeaking}><VolumeX size={15}/> Force stop</button>}</div></div></div></>;
}

