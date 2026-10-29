import { normalize } from './store.js'
import { ApiError } from './telemetry.js'

function csv(text){const rows=[];let row=[],cell='',quoted=false;for(let i=0;i<text.length;i++){const ch=text[i];if(ch==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++}else quoted=!quoted}else if(ch===','&&!quoted){row.push(cell);cell=''}else if((ch==='\n'||ch==='\r')&&!quoted){if(ch==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(Boolean))rows.push(row);row=[];cell=''}else cell+=ch}row.push(cell);if(row.some(Boolean))rows.push(row);if(quoted)throw new ApiError('INVALID_IMPORT',"The CSV contains an unclosed quote.",400);return rows}
export function parseImport(text,format){
  if(typeof text!=='string'||text.length>200000)throw new ApiError('INVALID_IMPORT',"Playlist text must be smaller than 200 KB.",400)
  text=text.replace(/^\uFEFF/,'');let items=[]
  if(format==='csv'||/^.*(?:track|şarkı|baslik|title).*[,].*(?:artist|sanat)/im.test(text)){
    const rows=csv(text),headers=(rows.shift()||[]).map(normalize)
    const ti=headers.findIndex(h=>['track name','track','title','sarki','sarki adi','baslik','name'].includes(h));const ai=headers.findIndex(h=>['artist name s','artist name','artist','artists','sanatci'].includes(h))
    if(ti<0)throw new ApiError('INVALID_IMPORT',"The CSV header has no title or Track Name column.",400)
    items=rows.map(r=>({baslik:r[ti]?.trim()||'',sanatci:ai>=0?r[ai]?.trim()||'':''}))
  }else{
    const lines=text.split(/\r?\n/);const isM3U=format==='m3u'||lines.some(l=>l.startsWith('#EXTM3U'));let hasMetadata=false;for(const line of lines){let value=line.trim();if(isM3U){if(value.startsWith('#EXTINF:')){value=value.slice(value.indexOf(',')+1);hasMetadata=true}else{if(!value||value.startsWith('#'))continue;if(hasMetadata){hasMetadata=false;continue}value=value.split(/[\\/]/).pop().split(/[?#]/)[0];try{value=decodeURIComponent(value)}catch{}value=value.replace(/\.(mp3|flac|m4a|ogg|opus|wav|aac|wma)$/i,'')}}else if(!value||value.startsWith('#'))continue
      const parts=value.split(/\s+[-–—]\s+/);items.push(parts.length>1?{sanatci:parts.shift(),baslik:parts.join(' - ')}:{sanatci:'',baslik:value})}
  }
  if(items.length>500)throw new ApiError('IMPORT_TOO_LARGE',"Import up to 500 tracks at a time.",400)
  const seen=new Set();let duplicates=0;const rows=[];for(const p of items){if(!p.baslik)continue;const key=normalize(p.baslik)+'|'+normalize(p.sanatci);if(seen.has(key)){duplicates++;continue}seen.add(key);rows.push({...p,index:rows.length})}return {rows,duplicates}
}
