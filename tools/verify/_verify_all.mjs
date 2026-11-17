// Full-surface verification of the settings / upgrade / mobile endpoints.
// Runs against the isolated ccp-verify instance and restores settings afterwards.
import http from 'node:http'

const BASE = 'http://127.0.0.1:39120'
const TOKEN = process.argv[2]

let COOKIE = ''

function req(method, path, body, opts = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body)
    const u = new URL(BASE + path)
    const r = http.request({
      hostname: u.hostname, port: u.port, path: u.pathname + u.search, method,
      headers: {
        ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}),
        ...(COOKIE ? { cookie: COOKIE } : {}),
      },
      timeout: opts.timeout || 180000,
    }, (res) => {
      let buf = ''
      res.setEncoding('utf-8')
      res.on('data', (c) => { buf += c })
      res.on('end', () => {
        let json = null
        try { json = JSON.parse(buf) } catch (e) { /* not json */ }
        resolve({ status: res.statusCode, headers: res.headers, body: buf, json })
      })
    })
    r.on('error', reject)
    r.on('timeout', () => r.destroy(new Error('timeout')))
    if (data) r.write(data)
    r.end()
  })
}

const results = []
function check(name, ok, detail) {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
}

// --- auth
const tokenRes = await req('GET', '/?token=' + encodeURIComponent(TOKEN))
const sc = tokenRes.headers['set-cookie']
if (sc && sc[0]) COOKIE = sc[0].split(';')[0]
check('auth cookie minted', Boolean(COOKIE), COOKIE ? COOKIE.slice(0, 22) + '…' : 'none')

const API = '/api/claude-code-parity'

// --- health must be able to tell the user whether the process runs stale code
{
  const h = (await req('GET', `${API}/health`)).json || {}
  const b = h.build || {}
  check('health reports build provenance', Boolean(b.loadedAt && b.file),
    `loadedAt=${b.loadedAt ? new Date(b.loadedAt).toISOString() : '-'} stale=${b.stale}`)
}

// --- snapshot
const before = (await req('GET', `${API}/settings`)).json
check('settings GET returns groups+items', before.groups.length === 6 && before.items.length >= 30,
  `${before.groups.length} groups, ${before.items.length} items`)
const snapshot = { ...before.values }

// --- every item round-trips through POST with its own type
const probes = {
  boolean: (cur) => !cur,
  number: (cur, it) => (Number(it.default) || 0) + 1,
  enum: (cur, it) => (it.options || []).find((o) => o !== it.default) || it.default,
  string: (cur, it) => `probe-${it.key}`,
  path: () => '',
  textarea: () => 'probe textarea',
}
let roundTripFails = []
for (const it of before.items) {
  const value = probes[it.type] ? probes[it.type](snapshot[it.key], it) : snapshot[it.key]
  const r = await req('POST', `${API}/settings`, { [it.key]: value })
  const got = r.json?.values?.[it.key]
  const expected = it.type === 'number'
    ? Math.min(it.max ?? Infinity, Math.max(it.min ?? -Infinity, Number(value)))
    : it.type === 'boolean' ? Boolean(value) : String(value)
  const ok = r.status === 200 && (typeof expected === 'number' ? Number(got) === expected : got === expected)
  if (!ok) roundTripFails.push(`${it.key}: sent ${JSON.stringify(value)} got ${JSON.stringify(got)}`)
}
check('every settings item persists and coerces correctly',
  roundTripFails.length === 0, roundTripFails.slice(0, 4).join(' | ') || `${before.items.length} items OK`)

// --- invalid values fall back to defaults instead of corrupting the file
const bad = await req('POST', `${API}/settings`, {
  timeout: 'not-a-number', permission_mode: 'nonsense', allow_read: 'maybe', theme: 'neon',
})
check('invalid values are coerced, not stored raw',
  bad.json.values.timeout === 900 && bad.json.values.permission_mode === 'acceptEdits'
  && bad.json.values.allow_read === false && bad.json.values.theme === 'claude',
  JSON.stringify({ timeout: bad.json.values.timeout, mode: bad.json.values.permission_mode }))

// --- reset then restore the user's real values
const reset = await req('POST', `${API}/settings/reset`, {})
check('settings/reset returns defaults', reset.json?.ok === true && reset.json.values.timeout === 900)
const restored = await req('POST', `${API}/settings`, snapshot)
const drift = Object.keys(snapshot).filter((k) => restored.json.values[k] !== snapshot[k])
check('original settings restored exactly', drift.length === 0, drift.join(', ') || 'no drift')

// --- upgrade check
const up = (await req('GET', `${API}/upgrade/check`)).json
check('upgrade/check hits the real registry',
  Boolean(up.latest) && /^\d+\.\d+/.test(up.latest) && up.ok === true,
  `current=${up.current} latest=${up.latest} hasUpdate=${up.hasUpdate}`)
check('upgrade/check reports the real install root',
  typeof up.installRoot === 'string' && up.installRoot.includes('Claude Code'),
  up.installRoot)

// --- mobile
const mob = (await req('GET', `${API}/mobile`)).json
check('mobile lists LAN IPv4 interfaces',
  Array.isArray(mob.interfaces) && mob.interfaces.length > 0 && /^192\.168\.|^10\.|^172\./.test(mob.interfaces[0].address),
  mob.interfaces.map((i) => i.name + '=' + i.address).join(', '))

const started = await req('POST', `${API}/mobile/start`, { host: mob.interfaces[0].address })
const st = started.json?.state || {}
check('mobile/start boots a LAN web instance and prints its URL',
  Boolean(st.running && /^http:\/\/\d+\.\d+\.\d+\.\d+:\d+\/\?token=/.test(st.url)), st.url || started.json?.error)
check('mobile/start exposes a short redirect address', Boolean(st.shortUrl), st.shortUrl)

if (st.running) {
  // the short address must 302 to the tokenised URL
  const shortHost = new URL(st.shortUrl)
  const redir = await new Promise((resolve, reject) => {
    const r = http.request({ hostname: shortHost.hostname, port: shortHost.port, path: '/', method: 'GET' }, (res) => {
      resolve({ status: res.statusCode, location: res.headers.location })
      res.resume()
    })
    r.on('error', reject); r.end()
  })
  check('short address redirects to the tokenised URL',
    redir.status === 302 && redir.location === st.url, `${redir.status} -> ${redir.location}`)

  // the LAN address must serve the real app shell once the token is exchanged
  const u = new URL(st.url)
  const mint = await new Promise((resolve, reject) => {
    const r = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: 'GET' }, (res) => {
      resolve({ status: res.statusCode, cookie: (res.headers['set-cookie'] || [])[0] })
      res.resume()
    })
    r.on('error', reject); r.end()
  })
  check('LAN address mints a session cookie for the LAN authority',
    mint.status === 303 && Boolean(mint.cookie), String(mint.status))

  const shell = await new Promise((resolve, reject) => {
    const r = http.request({
      hostname: u.hostname, port: u.port, path: '/', method: 'GET',
      headers: mint.cookie ? { cookie: mint.cookie.split(';')[0] } : {},
    }, (res) => {
      let buf = ''
      res.on('data', (c) => { buf += c })
      res.on('end', () => resolve({ status: res.statusCode, body: buf }))
    })
    r.on('error', reject); r.end()
  })
  check('LAN address serves the DSH app shell', shell.status === 200 && shell.body.includes('__DSH_CONTACT_CONFIG__'),
    String(shell.status))

  const lanApi = await new Promise((resolve, reject) => {
    const r = http.request({
      hostname: u.hostname, port: u.port, path: `${API}/health`, method: 'GET',
      headers: mint.cookie ? { cookie: mint.cookie.split(';')[0] } : {},
    }, (res) => {
      let buf = ''
      res.on('data', (c) => { buf += c })
      res.on('end', () => resolve({ status: res.statusCode, body: buf }))
    })
    r.on('error', reject); r.end()
  })
  // The health payload echoes the plugin display name, which is now
  // "DSH-Claude Code CLI"; assert on the payload shape, not on a stale string.
  let lanHealth = {}
  try { lanHealth = JSON.parse(lanApi.body) } catch (e) { /* not json */ }
  check('this plugin answers over the LAN address',
    lanApi.status === 200 && lanHealth.ok === true && Boolean(lanHealth.plugin),
    `${lanApi.status} plugin=${lanHealth.plugin}`)

  const stopped = await req('POST', `${API}/mobile/stop`, {})
  check('mobile/stop shuts the instance down', stopped.json?.state?.running === false)
  const closed = await new Promise((resolve) => {
    const r = http.request({ hostname: shortHost.hostname, port: shortHost.port, path: '/', method: 'GET', timeout: 2500 }, () => resolve(false))
    r.on('error', () => resolve(true)); r.on('timeout', () => { r.destroy(); resolve(true) }); r.end()
  })
  check('short address stops listening after stop', closed)
}

// --- export format
const sessions = (await req('GET', `${API}/history?limit=20`)).json
const list = sessions.sessions || []
// Exercise both kinds: a plugin-owned thread and a raw CLI transcript.
const targets = [list.find((s) => s.source === 'plugin'), list.find((s) => s.source !== 'plugin')].filter(Boolean)
for (const one of targets) {
  const md = (await req('POST', `${API}/history/export`, { id: one.id || one.key, format: 'markdown' })).json
  const txt = (await req('POST', `${API}/history/export`, { id: one.id || one.key, format: 'txt' })).json
  const ok = Boolean(md && txt && md.filename && txt.filename
    && md.filename.endsWith('.md') && txt.filename.endsWith('.txt') && md.content !== txt.content)
  check(`export honours export_format for a ${one.source || 'unknown'} session`, ok,
    md && txt ? `${md.filename} / ${txt.filename}` : JSON.stringify(md || txt).slice(0, 120))
}

// --- history_limit is honoured
await req('POST', `${API}/settings`, { history_limit: 20 })
const limited = (await req('GET', `${API}/history`)).json
check('history_limit caps the session list', limited.limit === 20 && (limited.sessions || []).length <= 20,
  `limit=${limited.limit} n=${(limited.sessions || []).length}`)
await req('POST', `${API}/settings`, snapshot)

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
if (failed.length) { console.log('FAILURES:'); for (const f of failed) console.log(' -', f.name, '::', f.detail) }
process.exit(failed.length ? 1 : 0)
