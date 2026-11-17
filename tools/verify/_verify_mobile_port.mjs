/**
 * Mobile-access port resilience.
 *
 * Reproduces the exact failure a user hit: 192.168.1.103:9240 was already taken,
 * DSH's web server could not bind, and the whole instance died with
 * "2 required plugins did not activate" — an error that blames the plugins and
 * never mentions the port. /mobile/start must pick a bindable port instead.
 */
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'

const BASE = 'http://127.0.0.1:39120'
const TOKEN = process.argv[2]
const API = '/api/claude-code-parity'
if (!TOKEN) { console.error('usage: node _verify_mobile_port.mjs <launchToken>'); process.exit(2) }

const results = []
function check(name, ok, detail) {
  results.push({ name, ok, detail })
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  — ' + detail : ''))
}

let COOKIE = ''
function req(method, p, body) {
  return new Promise((resolve) => {
    const d = body ? JSON.stringify(body) : null
    const u = new URL(BASE + p)
    const r = http.request({
      hostname: u.hostname, port: u.port, path: u.pathname + u.search, method,
      headers: { ...(COOKIE ? { cookie: COOKIE } : {}), ...(d ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(d) } : {}) },
      timeout: 150000,
    }, (res) => {
      let b = ''
      res.setEncoding('utf8')
      res.on('data', (c) => { b += c })
      res.on('end', () => {
        let json = null
        try { json = JSON.parse(b) } catch (e) { /* ignore */ }
        resolve({ status: res.statusCode, headers: res.headers, json, text: b })
      })
    })
    r.on('error', (e) => resolve({ status: 0, error: e.code || e.message }))
    r.on('timeout', () => { r.destroy(); resolve({ status: 0, error: 'client-timeout' }) })
    if (d) r.write(d)
    r.end()
  })
}

const auth = await req('GET', '/?token=' + encodeURIComponent(TOKEN))
COOKIE = (auth.headers['set-cookie'] || [''])[0].split(';')[0]
check('auth cookie minted', Boolean(COOKIE))

const ifaces = os.networkInterfaces()
const lan = Object.values(ifaces).flat().find((a) => a && a.family === 'IPv4' && !a.internal)
if (!lan) { console.log('FAIL no LAN IPv4 address'); process.exit(1) }
const HOST = lan.address

// Occupy the default port the way another DSH instance would. A base port can be
// passed in because a real mobile instance may already own 9240 — testing the
// fallback must not require killing the user's live instance.
const WANT = Number(process.argv[3] || 9240)
const squatter = net.createServer()
const occupied = await new Promise((resolve) => {
  squatter.once('error', () => resolve(false))
  squatter.listen(WANT, HOST, () => resolve(true))
})
check(`port ${WANT} could be occupied for the test`, occupied, HOST + ':' + WANT)
if (!occupied) { console.log('SKIP cannot occupy ' + WANT); process.exit(1) }

const started = await req('POST', `${API}/mobile/start`, { host: HOST, port: WANT })
check(`mobile/start succeeds even though ${WANT} is taken`, started.status === 200 && started.json?.ok === true,
  `HTTP ${started.status} ${started.json?.error || started.error || ''}`)

const st = started.json?.state || {}
check('it moved to a different port', Number(st.port) > 0 && Number(st.port) !== WANT, 'port=' + st.port)
check('it explains the substitution', /占用|taken|in use/i.test(String(started.json?.note || '')), String(started.json?.note || ''))
check('the reported URL points at the new port', String(st.url || '').includes(':' + st.port + '/'), String(st.url || '').slice(0, 70))

// The LAN address must actually serve the app.
if (st.url) {
  const probe = await new Promise((resolve) => {
    const u = new URL(st.url)
    const r = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: 'GET', timeout: 30000 }, (res) => {
      res.resume()
      resolve({ status: res.statusCode, cookie: (res.headers['set-cookie'] || [''])[0] })
    })
    r.on('error', (e) => resolve({ status: 0, error: e.code || e.message }))
    r.on('timeout', () => { r.destroy(); resolve({ status: 0, error: 'timeout' }) })
    r.end()
  })
  check('the tokenised LAN URL mints a session cookie', probe.status === 303 && Boolean(probe.cookie),
    `HTTP ${probe.status} ${probe.error || ''}`)
  if (probe.cookie) {
    const home = await new Promise((resolve) => {
      const u = new URL(st.url)
      const r = http.request({
        hostname: u.hostname, port: u.port, path: '/', method: 'GET',
        headers: { cookie: probe.cookie.split(';')[0] }, timeout: 30000,
      }, (res) => { res.resume(); resolve(res.statusCode) })
      r.on('error', () => resolve(0))
      r.on('timeout', () => { r.destroy(); resolve(0) })
      r.end()
    })
    check('the LAN instance serves the app shell', home === 200, 'HTTP ' + home)
  }
}

const stopped = await req('POST', `${API}/mobile/stop`, {})
check('mobile/stop shuts it down', stopped.status === 200 && stopped.json?.state?.running === false)

await new Promise((r) => squatter.close(r))
console.log('\n' + (results.some((r) => !r.ok) ? 'FAIL' : 'PASS all ' + results.length))
process.exit(results.some((r) => !r.ok) ? 1 : 0)
