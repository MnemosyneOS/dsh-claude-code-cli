/**
 * Image-attachment regression suite.
 *
 * Before the fix, an uploaded image made the bridge hand Anthropic's
 * `{ type:'image', source:{...} }` block straight to DSH, whose content blocks
 * require `{ type:'image', attachment: ImageAttachmentRef }`. The adapter then
 * crashed with "Cannot read properties of undefined (reading 'attachmentId')"
 * and the UI showed "本轮未返回内容…". This suite sends a real image through
 * /upload/raw -> /chat -> the local model and asserts the turn succeeds.
 */
import http from 'node:http'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const BASE = process.env.CCP_BASE || 'http://127.0.0.1:39120'
const API = '/api/claude-code-parity'
const TOKEN = process.argv[2]
if (!TOKEN) { console.error('usage: node _verify_image.mjs <launchToken>'); process.exit(2) }

let COOKIE = ''
const results = []
function check(name, ok, detail) {
  results.push({ name, ok, detail })
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  — ' + detail : ''))
}
function req(method, p, { body, headers = {}, timeout = 120000 } = {}) {
  return new Promise((resolve) => {
    const u = new URL(BASE + p)
    const r = http.request({
      hostname: u.hostname, port: u.port, path: u.pathname + u.search, method,
      headers: { ...(COOKIE ? { cookie: COOKIE } : {}), ...headers }, timeout,
    }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        let json = null
        try { json = JSON.parse(text) } catch (e) { /* not json */ }
        resolve({ status: res.statusCode, headers: res.headers, json, text })
      })
    })
    r.on('error', (e) => resolve({ status: 0, error: e.code || e.message }))
    r.on('timeout', () => { r.destroy(new Error('client-timeout')); resolve({ status: 0, error: 'client-timeout' }) })
    if (body) r.write(body)
    r.end()
  })
}

const auth = await req('GET', '/?token=' + encodeURIComponent(TOKEN))
COOKIE = (auth.headers['set-cookie'] || [''])[0].split(';')[0]
check('auth cookie minted', Boolean(COOKIE))

const SID = 'verify-image-' + Date.now()
// Minimal valid 1x1 PNG.
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const tmp = path.join(os.tmpdir(), SID + '.png')
await fs.writeFile(tmp, png)
const up = await req('POST', `${API}/upload/raw?name=image.png&session_key=${SID}&kind=image`, {
  body: png, headers: { 'content-type': 'image/png', 'content-length': String(png.length) },
})
check('image upload returns 200', up.status === 200 && Boolean(up.json?.path),
  `HTTP ${up.status} ${up.json?.error || up.error || ''}`)
const uploaded = up.json?.path || tmp

const chat = await req('POST', `${API}/chat`, {
  body: JSON.stringify({
    text: `@${uploaded}\n\n这张图是什么颜色？只回答两个字。`,
    session_key: SID,
  }),
  headers: { 'content-type': 'application/json' }, timeout: 90000,
})
check('chat with an image attachment starts', chat.status === 200 && Boolean(chat.json?.job_id),
  `HTTP ${chat.status} ${chat.text.slice(0, 200)}`)

const job = chat.json?.job_id
const events = []
if (job) {
  const deadline = Date.now() + 150000
  let cursor = 0
  let done = false
  while (Date.now() < deadline) {
    const p = await req('GET', `${API}/poll?job_id=${encodeURIComponent(job)}&cursor=${cursor}`, { timeout: 30000 })
    for (const e of (p.json?.events || [])) {
      cursor = Math.max(cursor, Number(e.seq || 0) + 1)
      events.push(e)
    }
    if (p.json?.done) { done = true; break }
    await new Promise((r) => setTimeout(r, 600))
  }
  check('job completes', done)
  const failedStats = events.filter((e) => e.kind === 'stats' && e.stopReason === 'error')
  check('no provider failure on an image turn', failedStats.length === 0,
    failedStats.map((e) => e.failure).slice(0, 2).join(' | ') || 'no error stats')
  const placeholders = events.filter((e) => e.kind === 'delta' && /本轮未返回内容/.test(e.text || ''))
  check('no "本轮未返回内容" placeholder', placeholders.length === 0,
    placeholders.map((e) => e.text).slice(0, 2).join(' | ') || 'none')
  const result = events.find((e) => e.kind === 'result')
  check('turn result is ok', Boolean(result && result.ok === true),
    result ? `ok=${result.ok} error=${result.error || '-'} text=${String(result.text).slice(0, 80)}` : 'no result')
  const deltaText = events.filter((e) => e.kind === 'delta' && e.text).map((e) => e.text).join('')
  check('model produced a visible answer', deltaText.trim().length > 0, deltaText.slice(0, 100))
}

await fs.unlink(tmp).catch(() => {})
await fs.rm(path.join(os.homedir(), '.dsh', 'ccp-data', 'uploads', SID), { recursive: true, force: true }).catch(() => {})

const failed = results.filter((r) => !r.ok)
console.log('\n' + (failed.length ? `FAIL ${failed.length}/${results.length}` : `PASS all ${results.length}`))
process.exit(failed.length ? 1 : 0)
