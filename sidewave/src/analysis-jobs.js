/** Durable submissions for explicitly archived tracks. Listening never schedules a download. */
export function createAnalysisJobs({store,scan,enqueue,enabled=false,canAnalyze=()=>true}) {
 let running=false,timer
 async function tick(force=false) {
  if(!enabled || running)return {state:enabled?'busy':'unsupported'}
  if(!canAnalyze())return {state:'waiting',message:"Analysis is waiting while music plays."}
  const completed=new Set(store.setting('sonicSubmittedJobs')||[])
  const pending=store.jobs().filter(j=>j.durum==='hazir' && j.localTrack?.id && !completed.has(j.id))
  if(!force && !pending.length)return {state:'idle'}
  running=true
  try {
   await scan()
   const result=await enqueue()
   for(const j of pending)completed.add(j.id)
   store.setting('sonicSubmittedJobs',[...completed].slice(-2000))
   const state={state:'submitted',taskId:result.task_id||null,submittedAt:Date.now(),trackCount:pending.length}
   store.setting('sonicAnalysisJob',state)
   return state
  }catch {const state={state:'waiting',message:"Audio analysis is busy or unavailable. Your music is safe.",updatedAt:Date.now()};store.setting('sonicAnalysisJob',state);return state}
  finally{running=false}
 }
 function start(){if(enabled&&!timer){timer=setInterval(()=>void (store.forAccounts?store.forAccounts(tick):tick()),60000);timer.unref()}}
 return {tick,start,stop:()=>clearInterval(timer)}
}
