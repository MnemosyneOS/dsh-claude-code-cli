/**
 * Attachment regression suite.
 *
 * Reproduces the failure that made "send a task" look like a no-op:
 *   a video attachment was base64'd into a JSON body, the 32 MB body cap
 *   tripped mid-stream, and the following /chat request on the same keep-alive
 *   socket never delivered a body — the UI sat on "working…" forever.
 *
 * Asserts:
 *   1. /upload/raw streams a 40 MB file to disk intact
 *   2. /upload answers 413 (not a hang) when the JSON body exceeds the cap
 *   3. a /chat issued right after that 413 still completes
 */
import http from 'node:http'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const BASE = process.env.CCP_BASE || 'http://127.0.0.1:39120'
const TOKEN = process.argv[2]
const API = '/api/claude-code-parity'
const DATA = path.join(os.homedir(), '.dsh', 'ccp-data')
if (!TOKEN) { console.error('usage: node _verify_attach.mjs <launchToken>'); process.exit(2) }

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
      headers: { ...(COOKIE ? { cookie: COOKIE } : {}), ...headers },
      timeout,
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
check('auth cookie minted', Boolean(COOKIE), COOKIE ? COOKIE.slice(0, 20) + '…' : 'none')

const SID = 'verify-attach'
const uploadDir = path.join(DATA, 'uploads', SID)
await fsp.rm(uploadDir, { recursive: true, force: true }).catch(() => {})

/* ---- 1. raw stream upload, 40 MB ------------------------------------- */
const SIZE = 40 * 1024 * 1024
const tmp = path.join(os.tmpdir(), 'ccp-verify-40mb.mp4')
{
  const buf = Buffer.alloc(SIZE, 0x41)
  // Make it look like an mp4 so nothing downstream guesses wrong.
  Buffer.from([0, 0, 0, 0x18]).copy(buf, 0)
  buf.write('ftypisom', 4, 'latin1')
  await fsp.writeFile(tmp, buf)
}
const rawBody = await fsp.readFile(tmp)
const raw = await req('POST', `${API}/upload/raw?name=clip.mp4&session_key=${SID}&kind=file`, {
  body: rawBody,
  headers: { 'content-type': 'application/octet-stream', 'content-length': String(rawBody.length) },
  timeout: 180000,
})
check('raw upload returns 200', raw.status === 200, `HTTP ${raw.status} ${raw.json?.error || raw.error || ''}`)
const landed = raw.json?.path || ''
let landedSize = 0
try { landedSize = (await fsp.stat(landed)).size } catch (e) { landedSize = -1 }
check('raw upload writes the full 40 MB to disk', landedSize === SIZE, `${landedSize} vs ${SIZE} bytes`)
check('raw upload reports the byte count', raw.json?.size === SIZE, String(raw.json?.size))

/* ---- 2. JSON upload over the cap must answer 413, not hang ---------- */
const overCap = Buffer.alloc(30 * 1024 * 1024, 0x42).toString('base64') // ~40 MB of JSON
const jsonBody = JSON.stringify({ name: 'big.bin', session_key: SID, base64: true, data: overCap })
const t413 = Date.now()
const over = await req('POST', `${API}/upload`, {
  body: jsonBody,
  headers: { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(jsonBody)) },
  timeout: 60000,
})
const ms413 = Date.now() - t413
check('oversized JSON upload answers 413', over.status === 413,
  `HTTP ${over.status} in ${ms413}ms ${over.json?.error || over.error || ''}`)
check('oversized JSON upload answers fast (does not hang)', ms413 < 15000, ms413 + 'ms')

/* ---- 3. the next request on a fresh socket must still work ---------- */
// Node's default agent pools keep-alive sockets; that is exactly the path that
// used to break, so do not disable it here.
const after = await req('GET', `${API}/health`, { timeout: 30000 })
check('health still answers after the 413', after.status === 200 && after.json?.ok === true,
  `HTTP ${after.status} in ${Date.now() - t413}ms`)

const chat = await req('POST', `${API}/chat`, {
  body: JSON.stringify({ text: '只回答两个字：好的', session_key: SID, provider: 'qwen3-8-flash-next-exl3', model: 'Qwen3.8-Flash-Next-EXL3-4.05bpw' }),
  headers: { 'content-type': 'application/json' },
  timeout: 90000,
})
check('chat still starts after the 413', chat.status === 200 && Boolean(chat.json?.job_id),
  `HTTP ${chat.status} job=${chat.json?.job_id || chat.error || ''}`)

/* ---- 4. drain the job so no stray process is left behind ------------ */
if (chat.json?.job_id) {
  const jobId = chat.json.job_id
  const deadline = Date.now() + 120000
  let done = false
  while (Date.now() < deadline) {
    const p = await req('GET', `${API}/poll?job_id=${encodeURIComponent(jobId)}&cursor=0`, { timeout: 30000 })
    if (p.json?.done) { done = true; check('job started after the 413 completes', true, `exit=${p.json.exit_code}`); break }
    await new Promise((r) => setTimeout(r, 700))
  }
  if (!done) check('job started after the 413 completes', false, 'timed out')
}

await fsp.unlink(tmp).catch(() => {})
await fsp.rm(uploadDir, { recursive: true, force: true }).catch(() => {})

const failed = results.filter((r) => !r.ok)
console.log('\n' + (failed.length ? `FAIL ${failed.length}/${results.length}` : `PASS all ${results.length}`))
process.exit(failed.length ? 1 : 0)
