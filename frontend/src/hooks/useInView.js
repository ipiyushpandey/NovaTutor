import {useEffect,useRef,useState} from 'react';

/*
 * Single-fire IntersectionObserver hook for scroll reveals.
 * Returns [ref, inView]; add the `reveal` class and toggle `in-view`.
 * Under prefers-reduced-motion the observer still fires but motion.css
 * neutralizes the transition, so content is simply visible immediately.
 */
export function useInView({threshold=0.15,rootMargin='0px 0px -8% 0px',once=true}={}){
  const ref=useRef(null);
  const [inView,setInView]=useState(false);
  useEffect(()=>{
    const el=ref.current;
    if(!el)return;
    if(typeof IntersectionObserver==='undefined'){setInView(true);return}
    const io=new IntersectionObserver(entries=>{
      for(const e of entries){
        if(e.isIntersecting){
          setInView(true);
          if(once)io.unobserve(e.target);
        }else if(!once){
          setInView(false);
        }
      }
    },{threshold,rootMargin});
    io.observe(el);
    return()=>io.disconnect();
  },[threshold,rootMargin,once]);
  return [ref,inView];
}
