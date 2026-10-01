import React,{useEffect,useRef,useState} from 'react';

/* AmbientVideo — purposeful background motion for calm, editorial pages.
   Contract: muted, playsInline, loop, poster-backed, lazy (video element is
   only mounted when scrolled near), pauses when the tab is hidden, and
   collapses to a static ink gradient under prefers-reduced-motion or on
   save-data connections. The gradient overlay guarantees text contrast on
   top of any frame. */
export default function AmbientVideo({src,poster,overlay='ink',children,className='',minHeight=320}){
  const wrapRef=useRef(null);
  const videoRef=useRef(null);
  const [near,setNear]=useState(false);

  /* Only mount the <video> when close to viewport. State (not a DOM
     dataset) so the mount actually re-renders. */
  useEffect(()=>{
    const el=wrapRef.current;
    if(!el||typeof IntersectionObserver==='undefined'){setNear(true);return}
    const io=new IntersectionObserver(entries=>{
      if(entries.some(e=>e.isIntersecting)){setNear(true);io.disconnect()}
    },{rootMargin:'300px'});
    io.observe(el);
    return()=>io.disconnect();
  },[]);

  /* Pause off-tab; respect reduced motion + save-data. Re-runs when `near`
     flips so the freshly mounted <video> starts playing. */
  useEffect(()=>{
    const v=videoRef.current;
    if(!v)return;
    const reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const saveData=navigator.connection?.saveData===true;
    if(reduce||saveData){v.pause();v.removeAttribute('src');return}
    const onVis=()=>{if(document.hidden)v.pause();else v.play().catch(()=>{})};
    document.addEventListener('visibilitychange',onVis);
    v.play().catch(()=>{}); /* autoplay may be blocked; poster shows instead */
    return()=>document.removeEventListener('visibilitychange',onVis);
  },[src,near]);

  return (
    <div ref={wrapRef} className={'ambient-video '+className} style={{minHeight}}>
      {near&&<video
        ref={videoRef}
        className="ambient-video-el"
        src={src}
        poster={poster}
        muted
        loop
        playsInline
        autoPlay
        preload="metadata"
        aria-hidden="true"
        tabIndex={-1}
      />}
      <div className={'ambient-video-overlay overlay-'+overlay}/>
      {children&&<div className="ambient-video-content">{children}</div>}
    </div>
  );
}
