import React,{useEffect,useRef} from 'react';
import {Icon as NovaIcon} from '../icons.jsx';

/* Icon helpers: the legacy glyph Icon system is reused as the inner icon so
   no new dependency is introduced. Pages may pass any node as `icon`. */
const I=({name,size=16,...p})=><NovaIcon name={name} size={size} {...p}/>;

/* ---------- Button ---------- */
export function Button({variant='secondary',size,block,loading,icon,iconRight,children,className='',...rest}){
  return (
    <button
      className={'nv-btn press nv-btn--'+variant+(size==='sm'?' nv-btn--sm':'')+(block?' nv-btn--block':'')+(className?' '+className:'')}
      disabled={loading||rest.disabled}
      {...rest}
    >
      {loading?<span className="nv-spinner" aria-hidden="true"/>:icon?I({name:icon,size:15}):null}
      {children}
      {iconRight?I({name:iconRight,size:14}):null}
    </button>
  );
}

/* ---------- Icon button ---------- */
export function IconButton({icon,label,className='',...rest}){
  return (
    <button className={'nv-icon-btn press'+(className?' '+className:'')} aria-label={label} title={label} {...rest}>
      {I({name:icon,size:16})}
    </button>
  );
}

/* ---------- Card ---------- */
export function Card({interactive,className='',children,...rest}){
  return <div className={'nv-card'+(interactive?' nv-card--interactive':'')+(className?' '+className:'')} {...rest}>{children}</div>;
}

/* ---------- Section header ---------- */
export function SectionHead({eyebrow,title,sub,action}){
  return (
    <div className="nv-section-head">
      <div>
        {eyebrow?<div className="nv-eyebrow">{eyebrow}</div>:null}
        <h2>{title}</h2>
        {sub?<p>{sub}</p>:null}
      </div>
      {action}
    </div>
  );
}

/* ---------- Badge ---------- */
export function Badge({tone='neutral',children,className=''}){
  return <span className={'nv-badge nv-badge--'+tone+(className?' '+className:'')}>{children}</span>;
}

/* ---------- Field (label + input/textarea/select + error) ---------- */
export function Field({label,error,hint,children}){
  return (
    <div className="nv-field">
      {label?<label>{label}</label>:null}
      {children}
      {hint&&!error?<span className="nv-muted" style={{fontSize:'var(--fs-xs)'}}>{hint}</span>:null}
      {error?<p className="nv-field-error">{error}</p>:null}
    </div>
  );
}
export function Input(props){return <input className="nv-input" {...props}/>}
export function Textarea(props){return <textarea className="nv-textarea" {...props}/>}
export function Select(props){return <select className="nv-select" {...props}/>}
export function PasswordInput(props){
  const [show,setShow]=React.useState(false);
  return (
    <div className="nv-pass">
      <input type={show?'text':'password'} className="nv-input" {...props}/>
      <button type="button" className="nv-pass-toggle" onClick={()=>setShow(s=>!s)}
        aria-label={show?'Hide password':'Show password'} aria-pressed={show}>
        {show?I({name:'Lightbulb',size:15}):I({name:'Sparkles',size:15})}
      </button>
    </div>
  );
}

/* ---------- Segmented control (labels may be strings or {value,label}) ---------- */
export function Segmented({options,value,onChange,ariaLabel}){
  const norm=options.map(o=>typeof o==='string'?{value:o,label:o}:o);
  return (
    <div className="nv-seg" role="group" aria-label={ariaLabel}>
      {norm.map(o=>(
        <button key={o.value} type="button" aria-pressed={value===o.value}
          onClick={()=>onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

/* ---------- Scrollable tab row ---------- */
export function Tabs({options,value,onChange,ariaLabel}){
  const norm=options.map(o=>typeof o==='string'?{value:o,label:o}:o);
  return (
    <div className="nv-tabs" role="tablist" aria-label={ariaLabel}>
      {norm.map(o=>(
        <button key={o.value} role="tab" aria-selected={value===o.value}
          className={value===o.value?'is-active':''}
          onClick={()=>onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

/* ---------- Progress ---------- */
export function Progress({value,max=100,tone,ariaLabel}){
  const pct=Math.max(0,Math.min(100,Math.round((value/max)*100)));
  return (
    <div className={'nv-progress'+(tone==='energy'?' nv-progress--energy':'')} role="progressbar"
      aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={ariaLabel||'Progress'}>
      <i style={{width:pct+'%'}}/>
    </div>
  );
}

/* ---------- States ---------- */
export function Empty({icon,title,children}){
  return (
    <div className="nv-empty">
      <span className="nv-empty-icon">{icon?I({name:icon,size:34}):<NovaIcon name="Sparkles" size={34}/>}</span>
      {title?<b>{title}</b>:null}
      <span>{children}</span>
    </div>
  );
}
export function ErrorBanner({title,children}){
  return (
    <div className="nv-error-banner" role="alert">
      <div><b>{title?title+' — ':''}</b>{children}</div>
    </div>
  );
}
export function Skeleton({h=12,w}){
  return <span className={'skeleton skeleton-text'+(w?' w'+w:'')} style={h!==12?{height:h}:null}/>;
}
export function SkeletonCard({lines=3}){
  return (
    <div className="nv-card nv-card--pad nv-skeleton-card">
      {Array.from({length:lines}).map((_,i)=><div key={i}><Skeleton w={i===0?60:80}/></div>)}
    </div>
  );
}

/* ---------- Modal / Sheet ---------- */
export function Modal({open,onClose,title,children,footer,variant='modal'}){
  const ref=useRef(null);
  const lastActive=useRef(null);
  useEffect(()=>{
    if(!open)return;
    lastActive.current=document.activeElement;
    const el=ref.current;
    // Minimal focus management: focus the dialog, return focus on close,
    // trap Tab inside while open.
    const focusables=()=>[...el.querySelectorAll('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])')].filter(x=>!x.disabled);
    const first=focusables()[0];if(first)first.focus();
    const onKey=e=>{
      if(e.key==='Escape')onClose();
      if(e.key==='Tab'){
        const list=focusables();if(!list.length)return;
        const idx=list.indexOf(document.activeElement);
        if(e.shiftKey&&(idx<=0)){e.preventDefault();list[list.length-1].focus()}
        else if(!e.shiftKey&&idx===list.length-1){e.preventDefault();list[0].focus()}
      }
    };
    document.addEventListener('keydown',onKey);
    return()=>{document.removeEventListener('keydown',onKey);lastActive.current?.focus?.()};
  },[open,onClose]);
  if(!open)return null;
  const cls=variant==='sheet'?'nv-sheet':'nv-modal';
  return (
    <div className={'nv-overlay'+(variant==='sheet'?' nv-overlay--sheet':'')}
      onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}>
      <div className={cls} ref={ref} role="dialog" aria-modal="true" aria-label={title}>
        <div className={variant==='sheet'?'nv-sheet-head':'nv-modal-head'}>
          <h3>{title}</h3>
          <IconButton icon="StopCircle" label="Close" onClick={onClose}/>
        </div>
        <div className={variant==='sheet'?'nv-sheet-body':'nv-modal-body'}>{children}</div>
        {footer?<div style={{padding:'12px 20px 20px',display:'flex',gap:10,justifyContent:'flex-end'}}>{footer}</div>:null}
      </div>
    </div>
  );
}
