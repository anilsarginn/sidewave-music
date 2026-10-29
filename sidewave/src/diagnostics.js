import {randomUUID,createHash} from 'node:crypto'
import {count} from './telemetry.js'

const escape=value=>String(value).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))

/** Android crash reports: stack frames only (the app strips messages, URLs and song data). */
export function installDiagnostics(app,{db,requireOwner,notify=async()=>{},now=Date.now}){
  db.exec('CREATE TABLE IF NOT EXISTS diagnostics(id TEXT PRIMARY KEY,member_id TEXT,signature TEXT NOT NULL,created INTEGER NOT NULL,json TEXT NOT NULL)')
  app.post('/api/v1/diagnostics',async c=>{
    const b=await c.req.json().catch(()=>({}))
    const frames=typeof b.frames==='string'?b.frames.slice(0,24000):''
    if(!frames)return c.json({code:'INVALID_REPORT',message:"The report is empty."},400)
    const report={version:String(b.version||'unknown').slice(0,40),time:Number(b.time)||now(),mainThread:!!b.mainThread,device:String(b.device||'').slice(0,80),sdk:Number(b.sdk)||null,frames}
    // Same app version and top frames = same crash; notify once per day per signature.
    const signature=createHash('sha256').update(report.version+'\n'+frames.split('\n').slice(0,4).join('\n')).digest('hex').slice(0,16)
    const seen=db.prepare('SELECT 1 FROM diagnostics WHERE signature=? AND created>?').get(signature,now()-86400000)
    db.prepare('INSERT INTO diagnostics VALUES(?,?,?,?,?)').run(randomUUID(),c.get('member')?.id||null,signature,now(),JSON.stringify(report))
    db.prepare('DELETE FROM diagnostics WHERE id NOT IN (SELECT id FROM diagnostics ORDER BY created DESC LIMIT 200)').run()
    count('sidewave_client_crashes_total','android',report.version)
    if(!seen)void notify(`<b>📱 Sidewave · Android çökmesi</b>\n\n<b>Sürüm:</b> ${escape(report.version)} · Android ${escape(report.sdk||'?')}\n<b>Cihaz:</b> ${escape(report.device||'?')}\n<b>Kullanıcı:</b> ${escape(c.get('member')?.username||'?')}\n<pre>${escape(frames.split('\n').slice(0,6).join('\n'))}</pre>`).catch(()=>{})
    return c.json({ok:true},201)
  })
  app.get('/api/v1/diagnostics',requireOwner,c=>c.json({reports:db.prepare('SELECT id,member_id,signature,created,json FROM diagnostics ORDER BY created DESC LIMIT 50').all().map(r=>({id:r.id,memberId:r.member_id,signature:r.signature,created:r.created,...JSON.parse(r.json)}))}))
}

export function telegramNotifier({token=process.env.MUSIC_TELEGRAM_BOT_TOKEN,chatId=process.env.MUSIC_TELEGRAM_CHAT_ID,fetch=globalThis.fetch}={}){
  return async text=>{
    if(!token||!chatId)return
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:chatId,text,parse_mode:'HTML'}),signal:AbortSignal.timeout(10000)})
  }
}
