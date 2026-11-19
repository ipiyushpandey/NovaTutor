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
const API=(()=>{const raw=(import.meta.env?.VITE_API_URL||'').trim().replace(/\/$/,''); if(!raw)return '/api'; const pointsToLocalBackend=/^https?:\/\/(localhost|127\.0\.0\.1)(?::\d+)?\//i.test(raw+'/'); if(pointsToLocalBackend)return '/api'; return raw.endsWith('/api')?raw:raw+'/api' })();

const readJSON=(key,fallback=null)=>{try{const raw=localStorage.getItem(key);return raw?JSON.parse(raw):fallback}catch{return fallback}};

const readUser=()=>{const u=readJSON('ai_user',null);if(!u||typeof u!=='object'||!u.id||!u.token)return null;return {...u,role:String(u.role||'STUDENT').toUpperCase()}};

let sessionRefreshPromise=null;
let sessionRefreshController=null;
let sessionGeneration=0;

const isSameSession=(originating)=>{
 if(!originating?.id||!originating?.token)return false;
 const latest=readUser();
 return Boolean(latest&&String(latest.id)===String(originating.id)&&latest.token===originating.token);
};

// Invalidates any in-flight /auth/me refresh when logging out or switching accounts so a
// delayed response can never resurrect a logged-out user or overwrite the next session.
function invalidatePendingSessionRefresh(){
 sessionGeneration+=1;
 try{sessionRefreshController?.abort()}catch{}
 sessionRefreshController=null;
 sessionRefreshPromise=null;
}

// Returns 'ok' | 'unauthorized' | 'network_error' | 'stale' so transient network/timeout
// errors never destroy a valid local session and stale refreshes never overwrite a newer session.
async function refreshSessionTokenWithStatus(){
 const current=readUser();
 if(!current?.token)return 'unauthorized';
 if(sessionRefreshPromise)return sessionRefreshPromise;
 const gen=sessionGeneration;
 const controller=new AbortController();
 sessionRefreshController=controller;
 const pending=(async()=>{
  const timeout=setTimeout(()=>controller.abort(),15000);
  try{
   const r=await fetch(API+'/auth/me',{headers:{Authorization:`Bearer ${current.token}`},signal:controller.signal});
   if(gen!==sessionGeneration||!isSameSession(current))return 'stale';
   if(r.status===401||r.status===403)return 'unauthorized';
   if(!r.ok)return 'network_error';
   const fresh=await r.json();
   if(gen!==sessionGeneration||!isSameSession(current))return 'stale';
   const next={...current,...fresh,token:fresh.token||current.token,role:String(fresh.role||current.role||'STUDENT').toUpperCase()};
   localStorage.setItem('ai_user',JSON.stringify(next));
   window.dispatchEvent(new Event('nova:session-refreshed'));
   return 'ok';
  }catch{
   return gen!==sessionGeneration||!isSameSession(current)?'stale':'network_error';
  }
  finally{
   clearTimeout(timeout);
   if(sessionRefreshPromise===pending){
    sessionRefreshPromise=null;
    sessionRefreshController=null;
   }
  }
 })();
 sessionRefreshPromise=pending;
 return pending;
}
async function refreshSessionToken(){
 return (await refreshSessionTokenWithStatus())==='ok';
}
const isTransientStatus=(s)=>s===502||s===503||s===504||s===408;
const isCredentialCheckPath=(p)=>/^\/auth\/(login|register|google|reset-password|verify-email)$|^\/users\/\d+\/password$/i.test(String(p||''));
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));

async function api(path,opt={},_retry=false){
 const method=String(opt.method||'GET').toUpperCase();
 const isIdempotent=method==='GET'||method==='HEAD';
 const maxRetries=typeof opt.retries==='number'?Math.max(0,Math.min(3,opt.retries)):(isIdempotent?2:0);
 const explicitTimeout=Number(opt.timeoutMs);
 const baseTimeoutMs=explicitTimeout||125000;
 const silentUpdate=Boolean(opt.silentUpdate);
 const externalSignal=opt.signal;
 const fetchOptions={...opt};
 delete fetchOptions.timeoutMs;
 delete fetchOptions.silentUpdate;
 delete fetchOptions.retries;
 delete fetchOptions.signal;

 for(let attempt=0;attempt<=maxRetries;attempt++){
  const attemptTimeoutMs=(!explicitTimeout&&isIdempotent&&attempt<maxRetries)?Math.min(baseTimeoutMs,45000):baseTimeoutMs;
  const controller=new AbortController();
  let timedOut=false;
  const onExternalAbort=()=>controller.abort();
  if(externalSignal){
   if(externalSignal.aborted){const err=new Error('Request cancelled.');err.name='AbortError';throw err;}
   externalSignal.addEventListener('abort',onExternalAbort,{once:true});
  }
  const timeout=setTimeout(()=>{timedOut=true;controller.abort();},attemptTimeoutMs);
  try{
   const session=readUser();
   const headers={...(opt.body instanceof FormData?{}:{'Content-Type':'application/json'}),...(session?.token?{'Authorization':`Bearer ${session.token}`} : {}),...(opt.headers||{})};
   const r=await fetch(API+path,{...fetchOptions,headers,signal:controller.signal});
   const raw=await r.text();
   if(!r.ok){
    if(isIdempotent&&isTransientStatus(r.status)&&attempt<maxRetries){
     clearTimeout(timeout);
     if(externalSignal)externalSignal.removeEventListener('abort',onExternalAbort);
     const delay=Math.round(700*Math.pow(2,attempt)+Math.random()*350);
     await sleep(delay);
     continue;
    }
    let message=raw||`Request failed (${r.status})`;
    let code='';
    try{const parsed=JSON.parse(raw);message=parsed.message||parsed.error||message;code=parsed.error||''}catch{}
    // A short-lived/stale JWT can happen while a workspace is open. Refresh once
    // through /auth/me and retry the original request before declaring the session dead.
    let refreshStatus='unauthorized';
    if(r.status===401&&!_retry&&session?.token&&isSameSession(session)&&path!=='/auth/me'&&!isCredentialCheckPath(path)){
     refreshStatus=await refreshSessionTokenWithStatus();
     if(refreshStatus==='ok'){clearTimeout(timeout);if(externalSignal)externalSignal.removeEventListener('abort',onExternalAbort);return api(path,opt,true);}
    }
    const err=new Error(message); err.status=r.status; err.code=code;
    if(r.status===502||r.status===504||(r.status===503&&/waking up|starting/i.test(message))||/waking up/i.test(message)){
     err.isWakeUp=true;
     err.code=err.code||'SERVER_WAKING_UP';
    }
    // 403 means authenticated but not permitted; credential checks (e.g. wrong current password),
    // transient /auth/me network errors, and stale responses after logout/switch must not destroy a valid session.
    if(r.status===401&&!isCredentialCheckPath(path)&&refreshStatus==='unauthorized'&&isSameSession(session)){
     invalidatePendingSessionRefresh();
     localStorage.removeItem('ai_user');
     localStorage.removeItem('nova_page');
     window.dispatchEvent(new Event('nova-session-expired'));
    }
    throw err;
   }
   if(r.status===204||!raw){if(!silentUpdate&&opt.method&&/^(POST|PUT|PATCH)$/i.test(opt.method))window.dispatchEvent(new Event('nova:learning-updated'));return null;}
   const parsedResult=(()=>{try{return JSON.parse(raw)}catch{return raw}})();
   if(!silentUpdate&&opt.method&&/^(POST|PUT|PATCH)$/i.test(opt.method))window.dispatchEvent(new Event('nova:learning-updated'));
   return parsedResult;
  }catch(e){
   const isNetErr=e instanceof TypeError && /fetch|network|load failed/i.test(e.message||'');
   if(isIdempotent&&(isNetErr||timedOut)&&attempt<maxRetries&&!externalSignal?.aborted){
    clearTimeout(timeout);
    if(externalSignal)externalSignal.removeEventListener('abort',onExternalAbort);
    const delay=Math.round(700*Math.pow(2,attempt)+Math.random()*350);
    await sleep(delay);
    continue;
   }
   if(e.name==='AbortError'){
    if(externalSignal?.aborted) throw e;
    const timeoutErr=new Error('The request timed out. The server may still be waking up — please try again.');
    timeoutErr.code='SERVER_WAKING_UP';
    timeoutErr.isWakeUp=true;
    timeoutErr.timedOut=true;
    throw timeoutErr;
   }
   if(isNetErr) throw new Error('Cannot reach NovaTutor right now. Check your connection and try again.');
   throw e;
  }finally{
   clearTimeout(timeout);
   if(externalSignal)externalSignal.removeEventListener('abort',onExternalAbort);
  }
 }
}

async function apiStream(path,opt={},onChunk,_retry=false){
 const session=readUser();
 const headers={
  'Content-Type':'application/json',
  Accept:'text/event-stream, application/json;q=0.9',
  ...(session?.token?{'Authorization':`Bearer ${session.token}`} : {}),
  ...(opt.headers||{})
 };
 const externalSignal=opt.signal;
 const controller=new AbortController();
 let timedOut=false;
 const onExternalAbort=()=>controller.abort();
 if(externalSignal){
  if(externalSignal.aborted){const err=new Error('Stream cancelled.');err.name='AbortError';throw err;}
  externalSignal.addEventListener('abort',onExternalAbort,{once:true});
 }
 const fetchOptions={...opt};
 delete fetchOptions.timeoutMs;
 delete fetchOptions.silentUpdate;
 delete fetchOptions.retries;
 delete fetchOptions.signal;
 // Idle timeout (not total timeout): long answers stay alive while chunks arrive.
 const STREAM_IDLE_TIMEOUT_MS=45000;
 let idleTimer=setTimeout(()=>{timedOut=true;controller.abort();},STREAM_IDLE_TIMEOUT_MS);
 const resetIdleTimer=()=>{clearTimeout(idleTimer);idleTimer=setTimeout(()=>{timedOut=true;controller.abort();},STREAM_IDLE_TIMEOUT_MS);};
 try{
  const r=await fetch(API+path,{...fetchOptions,headers,signal:controller.signal});
  resetIdleTimer();
  if(!r.ok){
   let refreshStatus='unauthorized';
   if(r.status===401&&!_retry&&session?.token&&isSameSession(session)){
    refreshStatus=await refreshSessionTokenWithStatus();
    if(refreshStatus==='ok'){
     clearTimeout(idleTimer);
     if(externalSignal)externalSignal.removeEventListener('abort',onExternalAbort);
     return apiStream(path,opt,onChunk,true);
    }
   }
   const raw=await r.text();
   let message=raw||`Request failed (${r.status})`;
   try{const parsed=JSON.parse(raw);message=parsed.message||parsed.error||message}catch{}
   if(r.status===401&&refreshStatus==='unauthorized'&&isSameSession(session)){
    invalidatePendingSessionRefresh();
    localStorage.removeItem('ai_user');
    localStorage.removeItem('nova_page');
    window.dispatchEvent(new Event('nova-session-expired'));
   }
   const err=new Error(message);err.status=r.status;throw err;
  }
  if(!r.body)throw new Error('Streaming is not supported by this browser.');
  const reader=r.body.getReader();
  const decoder=new TextDecoder();
  let buffer='';
  let sawDone=false;
  const consume=(event)=>{
    const lines=event.split(/\r?\n/);
    let eventName='message';
    const dataLines=[];
    for(const line of lines){
      if(line.startsWith('event:')){
        eventName=line.slice(6).replace(/^ /,'').trim()||'message';
      }else if(line.startsWith('data:')){
        // WHATWG SSE spec: strip a single optional leading space after `data:`.
        dataLines.push(line.slice(5).replace(/^ /,''));
      }
    }
    const data=dataLines.join('\n');
    if(eventName==='done'){sawDone=true;return}
    if(!data)return;
    if(eventName==='error'||data==='AI request failed. Please try again.')throw new Error(data);
    onChunk(data);
  };
  try{
   while(true){
    const {value,done}=await reader.read();
    if(done)break;
    resetIdleTimer();
    buffer+=decoder.decode(value,{stream:true});
    const events=buffer.split(/\r?\n\r?\n/);
    buffer=events.pop()||'';
    for(const event of events)consume(event);
   }
   buffer+=decoder.decode();
   if(buffer.trim())consume(buffer);
  }finally{
   try{await reader.cancel();}catch{}
  }
  if(!sawDone)throw new Error('The AI stream ended before completion. You can retry to continue.');
 }catch(e){
  if(e.name==='AbortError'){
   if(externalSignal?.aborted&&!timedOut)throw e;
   throw new Error('AI request timed out. Please try again.');
  }
  throw e;
 }finally{
  clearTimeout(idleTimer);
  if(externalSignal)externalSignal.removeEventListener('abort',onExternalAbort);
 }
}

export {api,apiStream,readUser,refreshSessionToken,invalidatePendingSessionRefresh,API};
