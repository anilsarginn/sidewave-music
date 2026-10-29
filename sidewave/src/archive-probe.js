// Subsonic's path may be virtual. Probe the actual ID-addressed audio instead.
export async function verifyArchiveStream(url,signal,fetcher=fetch){
  const response=await fetcher(url,{headers:{Range:'bytes=0-1023'},signal})
  let reader
  try{
    if(![200,206].includes(response.status)||!response.body||! /^(audio\/|video\/(webm|mp4)|application\/octet-stream)/i.test(response.headers.get('content-type')||''))return false
    reader=response.body.getReader();const first=await reader.read()
    if(first.done||!first.value?.length)return false
    // Providers sometimes serve a structured error with an audio content type.
    const prefix=new TextDecoder().decode(first.value.slice(0,80)).trimStart()
    return !/^(<|\{|\[)/.test(prefix)
  }finally{if(reader)await reader.cancel().catch(()=>{});else await response.body?.cancel().catch(()=>{})}
}
