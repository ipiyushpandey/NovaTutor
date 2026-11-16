/*
 * NovaTutor frontend API layer.
 *
 * Extracted byte-for-byte from main.jsx (V70.x) during the redesign
 * foundation phase so that every page shares one transport implementation.
 * Pages import { api, apiStream } — they never call fetch() directly.
 *
 * Backend contract (backend/ is FROZEN during the redesign):
 *  - JSON responses, JWT carried in the Authorization header from the
 *    localStorage session ('ai_user').
 *  - A 401 refreshes the session once via /auth/me and retries before
 *    giving up; a final 401 clears the session and notifies the app.
 *  - apiStream() consumes Spring SseEmitter TEXT_EVENT_STREAM with an
 *    idle-based timeout (long answers stay alive while data arrives).
 */

// In local development Vite proxies /api to Spring Boot, so login works on any Vite port (5173, 5180, etc.).
// For a deployed build, set VITE_API_URL to the public backend URL.
const API=(()=>{const raw=(import.meta.env.VITE_API_URL||'').trim().replace(/\/$/,''); if(!raw)return '/api'; const pointsToLocalBackend=/^https?:\/\/(localhost|127\.0\.0\.1)(?::\d+)?\//i.test(raw+'/'); if(pointsToLocalBackend)return '/api'; return raw.endsWith('/api')?raw:raw+'/api' })();

const readJSON=(key,fallback=null)=>{try{const raw=localStorage.getItem(key);return raw?JSON.parse(raw):fallback}catch{return fallback}};

const readUser=()=>{const u=readJSON('ai_user',null);if(!u||typeof u!=='object'||!u.id||!u.token)return null;return {...u,role:String(u.role||'STUDENT').toUpperCase()}};

let sessionRefreshPromise=null;
async function refreshSessionToken(){
 const current=readUser();
 if(!current?.token)return false;
 if(sessionRefreshPromise)return sessionRefreshPromise;
 sessionRefreshPromise=(async()=>{
  try{
   const r=await fetch(API+'/auth/me',{headers:{Authorization:`Bearer ${current.token}`}});
   if(!r.ok)return false;
   const fresh=await r.json();
   const next={...current,...fresh,token:fresh.token||current.token,role:String(fresh.role||current.role||'STUDENT').toUpperCase()};
   localStorage.setItem('ai_user',JSON.stringify(next));
   window.dispatchEvent(new Event('nova:session-refreshed'));
   return true;
  }catch{return false}
  finally{sessionRefreshPromise=null}
 })();
 return sessionRefreshPromise;
}
async function api(path,opt={},_retry=false){
 const controller=new AbortController();
 const timeoutMs=Number(opt.timeoutMs)||125000;
 const silentUpdate=Boolean(opt.silentUpdate);
 const fetchOptions={...opt};
 delete fetchOptions.timeoutMs;
 delete fetchOptions.silentUpdate;
 const timeout=setTimeout(()=>controller.abort(),timeoutMs);
 try{
  const session=readUser();
  const headers={...(opt.body instanceof FormData?{}:{'Content-Type':'application/json'}),...(session?.token?{'Authorization':`Bearer ${session.token}`} : {}),...(opt.headers||{})};
  const r=await fetch(API+path,{...fetchOptions,headers,signal:controller.signal});
  const raw=await r.text();
  if(!r.ok){
   let message=raw||`Request failed (${r.status})`;
   let code='';
   try{const parsed=JSON.parse(raw);message=parsed.message||parsed.error||message;code=parsed.error||''}catch{}
   // A short-lived/stale JWT can happen while an admin page is open. Refresh once
   // through /auth/me and retry the original request before declaring the session dead.
   if(r.status===401&&!_retry&&session?.token&&path!=='/auth/me'){
    const refreshed=await refreshSessionToken();
    if(refreshed){clearTimeout(timeout);return api(path,opt,true);}
   }
   const err=new Error(message); err.status=r.status; err.code=code;
   // 403 means authenticated but not permitted; do not destroy a valid session.
   if(r.status===401){
    localStorage.removeItem('ai_user');
    localStorage.removeItem('nova_page');
    window.dispatchEvent(new Event('nova-session-expired'));
   }
   throw err;
  }
  if(r.status===204||!raw){if(!silentUpdate&&opt.method&&/^(POST|PUT|PATCH)$/i.test(opt.method))window.dispatchEvent(new Event('nova:learning-updated'));return null;}
  const parsedResult=(()=>{try{return JSON.parse(raw)}catch{return raw}})();
  if(opt.method&&/^(POST|PUT|PATCH)$/i.test(opt.method))window.dispatchEvent(new Event('nova:learning-updated'));
  return parsedResult
 }catch(e){
  if(e.name==='AbortError') throw new Error('The request timed out. Check your connection and try again.');
  if(e instanceof TypeError && /fetch/i.test(e.message||'')) throw new Error('Cannot reach NovaTutor right now. Check your connection and try again.');
  throw e;
 }finally{clearTimeout(timeout)}
}
async function apiStream(path,opt={},onChunk){
 const session=readUser();
 const headers={
  'Content-Type':'application/json',
  Accept:'text/event-stream',
  ...(session?.token?{'Authorization':`Bearer ${session.token}`} : {}),
  ...(opt.headers||{})
 };
 const controller=new AbortController();
 const fetchOptions={...opt};
 delete fetchOptions.timeoutMs;
 delete fetchOptions.silentUpdate;
 // V70.47.2: this is an IDLE timeout, not a total response timeout.
 // A long answer may continue beyond this window as long as new data keeps arriving.
 const STREAM_IDLE_TIMEOUT_MS=45000;
 let idleTimer=setTimeout(()=>controller.abort(),STREAM_IDLE_TIMEOUT_MS);
 const resetIdleTimer=()=>{clearTimeout(idleTimer);idleTimer=setTimeout(()=>controller.abort(),STREAM_IDLE_TIMEOUT_MS);};
 try{
  const r=await fetch(API+path,{...fetchOptions,headers,signal:controller.signal});
  resetIdleTimer();
  if(!r.ok){
   const raw=await r.text();
   let message=raw||`Request failed (${r.status})`;
   try{const parsed=JSON.parse(raw);message=parsed.message||parsed.error||message}catch{}
   const err=new Error(message);err.status=r.status;throw err;
  }
  if(!r.body)throw new Error('Streaming is not supported by this browser.');
  const reader=r.body.getReader();
  const decoder=new TextDecoder();
  let buffer='';
  while(true){
   const {value,done}=await reader.read();
   if(done)break;
   resetIdleTimer();
   buffer+=decoder.decode(value,{stream:true});
   const events=buffer.split(/\r?\n\r?\n/);
   buffer=events.pop()||'';
   for(const event of events){
    const lines=event.split(/\r?\n/);
    // SSE "data:" payload: strip ONLY the field prefix. Spring's SseEmitter
    // writes "data:" with NO separator space, so any leading space in the
    // chunk is real content (Gemini chunks often begin with one: " HTML",
    // " the"). trimStart() here ate those spaces and concatenated words like
    // "toHTML"/"arediving".
    const data=lines.filter(x=>x.startsWith('data:')).map(x=>x.slice(5)).join('\n');
    if(!data)continue;
    if(data==='done')continue;
    if(data==='AI request failed. Please try again.')throw new Error(data);
    onChunk(data);
   }
  }
 }catch(e){
  if(e.name==='AbortError')throw new Error('AI request timed out. Please try again.');
  throw e;
 }finally{clearTimeout(idleTimer)}
}

export {api,apiStream,readUser,refreshSessionToken,API};
