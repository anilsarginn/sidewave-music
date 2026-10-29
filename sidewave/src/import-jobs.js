import { randomUUID } from 'node:crypto'
import { normalize } from './store.js'
import { parseImport } from './import.js'
import { ApiError } from './telemetry.js'

export function createImportJobs(store,search){
  store.db.exec(`CREATE TABLE IF NOT EXISTS import_jobs(id TEXT PRIMARY KEY,json TEXT NOT NULL,updated INTEGER NOT NULL);
    INSERT OR IGNORE INTO migrations VALUES(2,datetime('now'));`)
  const controllers=new Map()
  const save=job=>{store.db.prepare('INSERT INTO import_jobs VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json,updated=excluded.updated').run(job.jobId,JSON.stringify(job),Date.now());return job}
  function get(id){const r=store.db.prepare('SELECT json FROM import_jobs WHERE id=?').get(id);if(!r)throw new ApiError('NOT_FOUND',"Import preview not found.",404);return JSON.parse(r.json)}
  async function process(id){if(controllers.has(id))return;const ctrl=new AbortController();controllers.set(id,ctrl)
    try{const job=get(id);let cursor=0
      async function worker(){while(cursor<job.rows.length&&!ctrl.signal.aborted){const row=job.rows[cursor++];if(row.status!=='pending')continue
        try{const r=await search([row.sanatci,row.baslik].filter(Boolean).join(' '),{tracksOnly:true,signal:ctrl.signal});if(ctrl.signal.aborted)return;row.candidates=r.parcalar.slice(0,5)
          const exact=row.candidates.filter(p=>normalize(p.baslik)===normalize(row.baslik)&&(!row.sanatci||normalize(p.sanatci)===normalize(row.sanatci)))
          row.selected=exact.length===1?exact[0]:null;row.status=row.selected?'matched':row.candidates.length?'ambiguous':Object.values(r.hata||{}).some(Boolean)?'error':'unmatched'
        }catch{if(ctrl.signal.aborted)return;row.status='error';row.message="Search failed. You can retry this row later."}
        job.completed=job.rows.filter(r=>r.status!=='pending').length;save(job)
      }}
      await Promise.all([worker(),worker()]);if(!ctrl.signal.aborted){job.pending=false;save(job)}
    }finally{controllers.delete(id)}
  }
  function start(text,format){const active=store.db.prepare("SELECT COUNT(*) AS n FROM import_jobs WHERE json_extract(json,'$.pending')=1").get();if(active.n>=2)throw new ApiError('IMPORT_BUSY',"Finish or cancel your current imports first.",429,true)
    const parsed=parseImport(text,format),job={jobId:randomUUID(),rows:parsed.rows.map(r=>({...r,status:'pending',candidates:[],selected:null})),duplicates:parsed.duplicates,pending:parsed.rows.length>0,completed:0,total:parsed.rows.length}
    save(job);if(job.pending)void process(job.jobId);return job
  }
  function cancel(id){const job=get(id);controllers.get(id)?.abort();job.pending=false;job.cancelled=true;return save(job)}
  function resume(){for(const row of store.db.prepare("SELECT json FROM import_jobs WHERE json_extract(json,'$.pending')=1 ORDER BY updated ASC LIMIT 2").all()){const job=JSON.parse(row.json);void process(job.jobId)}}
  return {start,get,cancel,resume,stop:()=>{for(const c of controllers.values())c.abort()}}
}
