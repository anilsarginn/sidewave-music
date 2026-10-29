import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { bodyLimit } from 'hono/body-limit'
import { ApiError } from './telemetry.js'

export function installAppearanceApi(app, { store, root }) {
  const settingName = 'global-appearance-v1'
  const current = () => ({ wallpaperUrl: null, dim: 35, transparency: 70, ...store.setting(settingName), configured: !!store.setting(settingName) })
  const settings = value => {
    const result = {}
    for (const [name, min, max] of [['dim', 0, 80], ['transparency', 20, 90]]) {
      if (value[name] === undefined) continue
      if (typeof value[name] !== 'number' || !Number.isFinite(value[name]) || value[name] < min || value[name] > max)
        throw new ApiError('INVALID_APPEARANCE', "Appearance setting is outside the allowed range.", 400)
      result[name] = value[name]
    }
    return result
  }
  const save = values => {
    const result = { ...current(), ...values, configured: true, revision: randomUUID() }
    store.setting(settingName, result)
    return result
  }
  app.get('/api/v1/appearance', c => { c.header('Cache-Control', 'no-store'); return c.json(current()) })
  app.patch('/api/v1/appearance', async c => {
    const body = await c.req.json().catch(() => null)
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ApiError('INVALID_APPEARANCE', "Invalid appearance settings.", 400)
    return c.json(save(settings(body)))
  })
  app.put('/api/v1/appearance/wallpaper', bodyLimit({ maxSize: 8 * 1024 * 1024, onError: c => c.json({code:'IMAGE_TOO_LARGE',message:"The prepared image must be smaller than 8 MB."},413) }), async c => {
    if (c.req.header('Content-Type')?.split(';')[0] !== 'image/jpeg') throw new ApiError('INVALID_IMAGE', "The image must be prepared as JPG.", 415)
    const options = settings(Object.fromEntries(['dim', 'transparency'].filter(name => c.req.query(name) !== undefined).map(name => [name, Number(c.req.query(name))])))
    const bytes = Buffer.from(await c.req.arrayBuffer())
    if (bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216 || bytes[2] !== 255 || bytes.at(-2) !== 255 || bytes.at(-1) !== 217)
      throw new ApiError('INVALID_IMAGE', "This image could not be read. Choose another file.", 400)
    const name = createHash('sha256').update(bytes).digest('hex') + '.jpg'
    await mkdir(root, {recursive: true})
    const temporary = join(root, '.' + randomUUID() + '.tmp')
    try { await writeFile(temporary, bytes); await rename(temporary, join(root, name)) }
    finally { await unlink(temporary).catch(() => {}) }
    return c.json(save({wallpaperUrl: '/api/v1/appearance/wallpaper/' + name, ...options}))
  })
  app.delete('/api/v1/appearance/wallpaper', c => c.json(save({wallpaperUrl: null})))
  app.get('/api/v1/appearance/wallpaper/:name', async c => {
    const name = c.req.param('name')
    if (!/^[a-f0-9]{64}\.jpg$/.test(name)) return c.body(null, 404)
    const bytes = await readFile(join(root, name)).catch(() => null)
    if (!bytes) return c.body(null, 404)
    return c.body(bytes, 200, {'Content-Type':'image/jpeg','Cache-Control':'public, max-age=31536000, immutable','X-Content-Type-Options':'nosniff'})
  })
}
