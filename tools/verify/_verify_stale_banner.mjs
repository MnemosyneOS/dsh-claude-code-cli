// The "you are running old code" banner.
//
// The failure this guards against is invisible by definition: after an update
// the panel still runs the previous build, so it looks and behaves exactly like
// the version the user just installed. That is how a fixed tool bug was reported
// as "still broken" — the desktop process had been started before the fix was
// written. The banner is the only signal the user gets, so it has to appear on
// its own, at the top of the conversation, without opening any settings tab.
//
// /health is intercepted here to report `build.stale`, because the real instance
// is by definition not stale.
//
// usage: node _verify_stale_banner.mjs <dsh-token>
import { spawn } from 'node:child_process'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

const TOKEN = process.argv[2]
const BASE = 'http://127.0.0.1:39120'
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const RUN = Math.random().toString(36).slice(2, 8)
const PROFILE = path.join(os.tmpdir(), 'ccp-stale-' + RUN)
const PORT = 9900 + Math.floor(Math.random() * 90)

const results = []
function check(name, ok, detail) {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
}

function httpJson(p, method = 'GET') {
  return new Promise((resolve, reject) => {
    const r = http.request({ hostname: '127.0.0.1', port: PORT, path: p, method }, (res) => {
      let b = ''
      res.on('data', (c) => { b += c })
      res.on('end', () => { try { resolve(JSON.parse(b)) } catch (e) { resolve(b) } })
    })
    r.on('error', reject)
    r.end()
  })
}

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu',
  '--window-size=1280,900', 'about:blank',
], { stdio: 'ignore', windowsHide: true })

async function waitFor(fn, timeoutMs, step = 300) {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    try { const v = await fn(); if (v) return v } catch (e) { /* retry */ }
    await new Promise((r) => setTimeout(r, step))
  }
  return null
}

const version = await waitFor(() => httpJson('/json/version'), 20000)
if (!version) { console.log('FAIL chrome devtools never came up'); chrome.kill(); process.exit(1) }

const target = await httpJson('/json/new?' + encodeURIComponent('about:blank'), 'PUT')
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })

let seq = 0
const pending = new Map()
const consoleErrors = []
let staleMode = true

function send(method, params = {}) {
  const id = ++seq
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })
}

ws.onmessage = async (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id)
    pending.delete(msg.id)
    if (msg.error) reject(new Error(JSON.stringify(msg.error)))
    else resolve(msg.result)
    return
  }
  // Answer /health ourselves so the panel can be driven into the stale state.
  if (msg.method === 'Fetch.requestPaused') {
    const body = {
      version: '2.5.3',
      pid: 4242,
      uptimeMs: 1000,
      build: staleMode
        ? { file: 'lib/index.js', mtime: Date.now() + 60000, loadedAt: Date.now() - 60000, stale: true }
        : { file: 'lib/index.js', mtime: Date.now() - 60000, loadedAt: Date.now(), stale: false },
      bridge: { running: true, port: 47823 },
      cli: { path: 'claude.exe', version: '2.1.326' },
      selection: { provider: 'workbuddy-ai', model: 'hy4flash' },
      counts: { sessions: 1, cliMeta: 0, jobs: 1, uploads: 0 },
      recentJobs: [],
      settings: {},
    }
    await send('Fetch.fulfillRequest', {
      requestId: msg.params.requestId,
      responseCode: 200,
      responseHeaders: [
        { name: 'content-type', value: 'application/json; charset=utf-8' },
        { name: 'access-control-allow-origin', value: '*' },
      ],
      body: Buffer.from(JSON.stringify(body), 'utf-8').toString('base64'),
    }).catch(() => {})
    return
  }
  if (msg.method === 'Runtime.exceptionThrown') consoleErrors.push(msg.params?.exceptionDetails?.text || 'exception')
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params?.type === 'error') {
    consoleErrors.push((msg.params.args || []).map((a) => a.value ?? a.description ?? '').join(' '))
  }
}

async function evaluate(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''))
  return r.result?.value
}

const OPEN_PANEL = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const NL = String.fromCharCode(10)
  if (document.querySelector('.ccp-root')) return true
  const btn = Array.from(document.querySelectorAll('button')).find((b) => (b.innerText || '').split(NL)[0].trim() === '插件')
  if (btn) btn.click()
  await sleep(1600)
  const cards = Array.from(document.querySelectorAll('[class*="cardMain"]'))
  const mine = cards.find((c) => /claude/i.test(c.innerText || ''))
  if (mine) mine.click()
  await sleep(2200)
  const row = Array.from(document.querySelectorAll('button')).find((b) => (b.innerText || '').split(NL)[0].trim() === 'Claude Code Desktop')
  if (row) row.click()
  await sleep(2200)
  return Boolean(document.querySelector('.ccp-root'))
})()`

await send('Page.enable')
await send('Runtime.enable')
await send('Fetch.enable', { patterns: [{ urlPattern: '*claude-code-parity/health*' }] })
await send('Page.navigate', { url: `${BASE}/?token=${encodeURIComponent(TOKEN)}` })
await new Promise((r) => setTimeout(r, 3500))
await waitFor(() => evaluate(OPEN_PANEL), 45000)

const shown = await waitFor(() => evaluate(`(() => {
  const el = document.querySelector('.ccp-root .ccp-stale')
  if (!el) return null
  const r = el.getBoundingClientRect()
  const stream = document.querySelector('.ccp-root .ccp-stream')
  const sr = stream ? stream.getBoundingClientRect() : null
  return {
    text: (el.innerText || '').trim(),
    aboveTranscript: sr ? r.bottom <= sr.top + 2 : false,
    width: Math.round(r.width),
  }
})()`), 25000, 500)

check('a stale build shows a banner without opening settings', Boolean(shown),
  shown ? '' : 'no .ccp-stale element')
check('the banner sits above the transcript', Boolean(shown?.aboveTranscript),
  'width=' + shown?.width)
check('it says the running code is old and asks for a full restart',
  Boolean(shown) && /旧代码|old code/i.test(shown.text) && /重开|restart/i.test(shown.text),
  JSON.stringify(String(shown?.text || '').slice(0, 90)))

// And it must disappear again once the build is current.
staleMode = false
const gone = await waitFor(() => evaluate(`(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  // Force a re-read of /health by switching the panel away and back.
  const btns = Array.from(document.querySelectorAll('.ccp-root .ccp-sidefoot .ccp-sidebtn'))
  const st = btns.find((b) => (b.innerText || '').trim() === '设置')
  if (st) st.click()
  await sleep(900)
  const back = Array.from(document.querySelectorAll('.ccp-root .ccp-sidefoot .ccp-sidebtn'))
  const ar = back.find((b) => (b.innerText || '').trim() === '归档')
  if (ar) { ar.click(); await sleep(600); ar.click() }
  await sleep(600)
  return document.querySelector('.ccp-root .ccp-stale') ? null : { ok: true }
})()`), 20000, 700)
check('the banner clears once the build is current', Boolean(gone), gone ? '' : 'banner still present')

check('no console errors', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | '))

ws.close()
chrome.kill()
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length}`)
process.exit(failed ? 1 : 0)
