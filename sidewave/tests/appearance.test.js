import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Hono } from 'hono'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStore } from '../src/store.js'
import { installAppearanceApi } from '../src/appearance.js'

test('global appearance persists across clients/restarts; updates preserve wallpaper and deletion cannot resurrect it', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sidewave-appearance-')); let store = createStore(join(root, 'db.sqlite'))
  const make = () => { const app = new Hono(); app.onError((e,c) => c.json({code:e.code},e.status||500)); installAppearanceApi(app,{store,root}); return app }
  let app = make()
  try {
    assert.equal((await (await app.request('/api/v1/appearance')).json()).configured,false)
    const image = Buffer.from([255,216,255,224,0,16,255,217])
    const uploaded = await (await app.request('/api/v1/appearance/wallpaper?dim=45&transparency=80',{method:'PUT',headers:{'Content-Type':'image/jpeg'},body:image})).json()
    assert.equal(uploaded.dim,45); assert.equal(uploaded.transparency,80)
    assert.deepEqual(Buffer.from(await (await app.request(uploaded.wallpaperUrl)).arrayBuffer()),image)
    await app.request('/api/v1/appearance',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({dim:60})})
    store.close(); store=createStore(join(root,'db.sqlite')); app=make()
    const restored=await (await app.request('/api/v1/appearance')).json()
    assert.equal(restored.wallpaperUrl,uploaded.wallpaperUrl);assert.equal(restored.dim,60);assert.equal(restored.transparency,80)
    await app.request('/api/v1/appearance/wallpaper',{method:'DELETE'})
    const removed=await (await app.request('/api/v1/appearance')).json();assert.equal(removed.wallpaperUrl,null);assert.equal(removed.configured,true)
    for(const invalid of [{dim:81},{transparency:19},{dim:'50'}])assert.equal((await app.request('/api/v1/appearance',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(invalid)})).status,400)
    assert.equal((await app.request('/api/v1/appearance/wallpaper',{method:'PUT',headers:{'Content-Type':'image/jpeg'},body:'broken'})).status,400)
    assert.equal((await app.request('/api/v1/appearance/wallpaper',{method:'PUT',headers:{'Content-Type':'image/jpeg'},body:Buffer.alloc(8*1024*1024+1)})).status,413)
    assert.equal((await app.request('/api/v1/appearance/wallpaper/wrong.jpg')).status,404)
  } finally { store.close(); rmSync(root,{recursive:true,force:true}) }
})
