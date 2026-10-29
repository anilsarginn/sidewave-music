import { ApiError, count, observe, log, streamStarted } from './telemetry.js'

export function parseRange(header,size){
  if(!header)return null
  const m=/^bytes=(\d*)-(\d*)$/.exec(header)
  if(!m||(!m[1]&&!m[2])||size===0)throw new ApiError('INVALID_RANGE',"Invalid audio range.",416)
  let start=m[1]?Number(m[1]):Math.max(0,size-Number(m[2])),end=m[1]?(m[2]?Number(m[2]):size-1):size-1
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>=size||end<start||(!m[1]&&Number(m[2])===0))throw new ApiError('INVALID_RANGE',"Invalid audio range.",416)
  return{start,end:Math.min(end,size-1)}
}

// Providers must receive the signal, but racing it also bounds dependencies that
// ignore cancellation. Both promise branches stay observed after cancellation.
function untilAbort(promise,signal){
  if(signal.aborted){Promise.resolve(promise).catch(()=>{});return Promise.reject(signal.reason)}
  return new Promise((resolve,reject)=>{
    const aborted=()=>{cleanup();reject(signal.reason)}
    const cleanup=()=>signal.removeEventListener('abort',aborted)
    signal.addEventListener('abort',aborted,{once:true})
    Promise.resolve(promise).then(value=>{cleanup();resolve(value)},error=>{cleanup();reject(error)})
  })
}

export async function proxyAudio(c,getSource,{source='unknown',requestId='',fetcher=fetch,budgetMs=14000,idleMs=30000}={}){
  const began=Date.now(),ctrl=new AbortController(),incoming=c.req.raw.signal
  const abort=()=>ctrl.abort(new ApiError('PLAYBACK_CANCELLED',"Playback cancelled.",499,false))
  const timeout=()=>ctrl.abort(new ApiError('START_TIMEOUT',"The song took too long to start.",504,true))
  incoming.addEventListener('abort',abort,{once:true})
  if(incoming.aborted)abort()
  let timer=setTimeout(timeout,Math.max(0,budgetMs)),upstream,reader
  if(budgetMs<=0)timeout()
  const cleanup=()=>{clearTimeout(timer);incoming.removeEventListener('abort',abort)}
  const cancelBody=()=>{
    try{const cancelled=reader?reader.cancel():upstream?.body?.cancel();cancelled?.catch(()=>{})}catch{}
  }
  try{
    for(let attempt=0;attempt<2;attempt++){
      if(ctrl.signal.aborted)throw ctrl.signal.reason
      const s=await untilAbort(getSource(attempt>0,ctrl.signal),ctrl.signal)
      const headers={...s.headers};const range=c.req.header('range');if(range)headers.Range=range
      upstream=await untilAbort(fetcher(s.url,{headers,signal:ctrl.signal,redirect:'follow'}),ctrl.signal)
      if(attempt===0&&source==='youtube'&&[401,403,410,429,500,502,503,504].includes(upstream.status)){
        cancelBody();count('sidewave_stream_retry_total',source,String(upstream.status));continue
      }
      break
    }
    const h=new Headers({'Cache-Control':'no-store','X-Request-Id':requestId})
    for(const k of ['content-type','content-length','content-range','accept-ranges','etag','last-modified']){const v=upstream.headers.get(k);if(v)h.set(k,v)}
    if(upstream.status===416){cancelBody();cleanup();return new Response(null,{status:416,headers:h})}
    if(![200,206].includes(upstream.status))throw new ApiError(upstream.status===429?'RATE_LIMITED':'SOURCE_UNAVAILABLE',"This source cannot play right now.",upstream.status===429?429:502,upstream.status!==403)
    const ct=upstream.headers.get('content-type')||''
    if(!/^(audio\/|video\/(webm|mp4)|application\/octet-stream)/i.test(ct))throw new ApiError('INVALID_MEDIA',"The source did not return a valid audio file.",502,false)
    if(!upstream.body)throw new ApiError('EMPTY_MEDIA',"The source did not return audio data.",502,true)
    observe('sidewave_stream_headers_seconds',source,Date.now()-began)
    reader=upstream.body.getReader()
    // Do not commit a successful response or reset the deadline until real audio
    // bytes arrive. An empty or stalled body must produce a normal typed API error.
    let first
    do{first=await untilAbort(reader.read(),ctrl.signal)}while(!first.done&&!first.value?.byteLength)
    if(first.done)throw new ApiError('EMPTY_MEDIA',"The source did not return audio data.",502,true)
    clearTimeout(timer);streamStarted(requestId)
    observe('sidewave_stream_first_byte_seconds',source,Date.now()-began);count('sidewave_stream_total',source,'ok')
    const body=new ReadableStream({
      start(controller){controller.enqueue(first.value)},
      async pull(controller){
        timer=setTimeout(()=>ctrl.abort(new ApiError('STREAM_TIMEOUT',"Audio delivery timed out.",504,true)),idleMs)
        try{
          const r=await untilAbort(reader.read(),ctrl.signal);clearTimeout(timer)
          if(r.done){cleanup();controller.close()}else controller.enqueue(r.value)
        }catch(e){cleanup();cancelBody();count('sidewave_stream_total',source,'interrupted');controller.error(ctrl.signal.aborted?ctrl.signal.reason:e)}
      },
      cancel(){cleanup();ctrl.abort(new ApiError('PLAYBACK_CANCELLED',"Playback cancelled.",499,false));cancelBody()},
    })
    return new Response(body,{status:upstream.status,headers:h})
  }catch(e){
    const error=ctrl.signal.aborted?ctrl.signal.reason:e
    cleanup();ctrl.abort();cancelBody()
    count('sidewave_stream_total',source,error.code||'error');log('stream_failed',{requestId,source,code:error.code||'STREAM_ERROR',elapsedMs:Date.now()-began})
    if(error.name==='AbortError'||error.name==='TimeoutError')throw new ApiError('START_TIMEOUT',"The song took too long to start.",504,true)
    throw error
  }
}
