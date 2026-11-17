// Drive the real upgrade path on a live instance and print exactly what happens.
import http from 'node:http'

const BASE = 'http://127.0.0.1:39120'
const TOKEN = process.argv[2]
const API = '/api/claude-code-parity'
let COOKIE = ''

function req(method, path, body, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body)
    const u = new URL(BASE + path)
    const r = http.request({
      hostname: u.hostname, port: u.port, path: u.pathname + u.search, method,
      headers: {
        ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}),
        ...(COOKIE ? { cookie: COOKIE } : {}),
      },
      timeout,
    }, (res) => {
      let buf = ''
      res.setEncoding('utf-8')
      res.on('data', (c) => { buf += c })
      res.on('end', () => {
        let j = null
        try { j = JSON.parse(buf) } catch (e) { /* not json */ }
        resolve({ status: res.statusCode, headers: res.headers, json: j, body: buf })
      })
    })
    r.on('error', reject)
    r.on('timeout', () => r.destroy(new Error('timeout')))
    if (data) r.write(data)
    r.end()
  })
}

const auth = await req('GET', '/?token=' + encodeURIComponent(TOKEN))
COOKIE = (auth.headers['set-cookie'] || [''])[0].split(';')[0]
console.log('cookie:', COOKIE ? 'ok' : 'MISSING')

const check = await req('GET', `${API}/upgrade/check`, undefined, 40000)
console.log('\n--- /upgrade/check ---')
console.log('status', check.status)
console.log(JSON.stringify(check.json, null, 1))

const started = Date.now()
const up = await req('POST', `${API}/upgrade`, {}, 40000)
console.log('\n--- POST /upgrade ---')
console.log('status', up.status, 'after', Date.now() - started, 'ms')
console.log(JSON.stringify(up.json, null, 1))

if (up.status !== 200) {
  console.log('\nUPGRADE REJECTED — nothing was started.')
  process.exit(0)
}

let lastLog = ''
for (let i = 0; i < 120; i++) {
  await new Promise((r) => setTimeout(r, 5000))
  const s = await req('GET', `${API}/upgrade/status`, undefined, 20000)
  const j = s.json || {}
  const log = String(j.log || '')
  if (log.length > lastLog.length) {
    const delta = log.slice(lastLog.length).trim()
    if (delta) console.log(`[${Math.round((Date.now() - started) / 1000)}s] ` + delta.split('\n').slice(-3).join(' | ').slice(0, 300))
    lastLog = log
  }
  if (!j.running) {
    console.log('\n--- finished ---')
    const { log: _l, ...rest } = j
    console.log(JSON.stringify(rest, null, 1))
    console.log('log tail:\n' + log.slice(-1200))
    break
  }
  if (i % 12 === 11) console.log(`[${Math.round((Date.now() - started) / 1000)}s] still running…`)
}
