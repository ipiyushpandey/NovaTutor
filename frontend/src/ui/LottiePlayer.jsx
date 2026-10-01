import React,{useEffect,useRef,useState} from 'react';

/* LottiePlayer — lazy, reduced-motion-aware Lottie host.
   - The animation JSON is fetched only when the host scrolls near the
     viewport (IntersectionObserver, rootMargin 200px).
   - lottie-web is imported dynamically on first use, so pages that never
     show a Lottie never pay for it.
   - With prefers-reduced-motion the animation renders its first frame and
     stays static. It also pauses when the tab is hidden. */
export default function LottiePlayer({src,loop=true,autoplay=true,className='',style,ariaLabel}){
  const hostRef=useRef(null);
  const animRef=useRef(null);
  const [visible,setVisible]=useState(false);
  const [failed,setFailed]=useState(false);

  useEffect(()=>{
    const el=hostRef.current;
    if(!el||typeof IntersectionObserver==='undefined'){setVisible(true);return}
    const io=new IntersectionObserver(entries=>{
      if(entries.some(e=>e.isIntersecting)){setVisible(true);io.disconnect()}
    },{rootMargin:'200px'});
    io.observe(el);
    return()=>io.disconnect();
  },[]);

  useEffect(()=>{
    if(!visible||failed)return;
    let dead=false;
    (async()=>{
      try{
        const lottie=(await import('lottie-web')).default;
        const res=await fetch(src);
        if(!res.ok)throw new Error('lottie asset '+res.status);
        const data=await res.json();
        if(dead)return;
        const reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        animRef.current=lottie.loadAnimation({
          container:hostRef.current,
          renderer:'svg',
          loop:reduce?false:loop,
          autoplay:reduce?false:autoplay,
          animationData:data,
        });
        if(reduce)animRef.current.goToAndStop(0,true);
        const onVis=()=>{
          if(!animRef.current)return;
          if(document.hidden)animRef.current.pause();
          else if(!reduce)animRef.current.play();
        };
        document.addEventListener('visibilitychange',onVis);
        animRef.current.addEventListener('destroy',()=>document.removeEventListener('visibilitychange',onVis));
      }catch(e){
        if(!dead)setFailed(true);
      }
    })();
    return()=>{dead=true;try{animRef.current?.destroy()}catch{}animRef.current=null};
  },[visible,failed,src,loop,autoplay]);

  if(failed)return null; /* graceful fallback: host collapses, layout unaffected */
  return <div ref={hostRef} className={'lottie-host '+className} style={style} role={ariaLabel?'img':undefined} aria-label={ariaLabel}/>;
}
