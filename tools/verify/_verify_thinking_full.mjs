// A long thinking chain must be fully rendered, not cut at an arbitrary cap.
//
// Real turns on this machine reach 30,000+ characters (one job held 23,382
// thinking deltas). WorkRow sliced the expanded detail to 8,000 characters, so
// the row looked complete while the rest of the chain was silently missing.
// The typing pump also capped at 400 chars/s, leaving long chains minutes
// behind the model until the final flush dumped everything at once.
//
// usage: node _verify_thinking_full.mjs <dsh-token>
import { spawn } from 'node:child_process'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

const TOKEN = process.argv[2]
const BASE = 'http://127.0.0.1:39120'
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const RUN = Math.random().toString(36).slice(2, 8)
const PROFILE = path.join(os.tmpdir(), 'ccp-thinkfull-' + RUN)
const PORT = 10000 + Math.floor(Math.random() * 200)
const TITLE = 'verify-long-thinking-' + RUN
const TAIL = 'THE-VERY-LAST-THOUGHT-' + RUN
const LONG = Array.from({ length: 3000 }, (_, i) => `第${i}步：继续推演当前思路。`).join('') + TAIL

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
  '--window-size=1440,900', 'about:blank',
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
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id)
    pending.delete(msg.id)
    if (msg.error) reject(new Error(JSON.stringify(msg.error)))
    else resolve(msg.result)
  }
}
function send(method, params = {}) {
  const id = ++seq
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })
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
await send('Page.navigate', { url: `${BASE}/?token=${encodeURIComponent(TOKEN)}` })
await new Promise((r) => setTimeout(r, 3500))

const saved = await evaluate(`(async () => {
  const now = Date.now()
  const messages = [
    { id: 'u1', role: 'user', text: '长思考测试', ts: now, forceNew: true },
    { id: 't1', role: 'assistant', kind: 'thinking', streaming: false, ts: now + 1, text: ${JSON.stringify(LONG)} },
    { id: 'r1', role: 'assistant', kind: 'result', ok: true, ts: now + 2, text: '完成' },
  ]
  const r = await fetch('/api/claude-code-parity/history/save', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key: ${JSON.stringify(TITLE)}, id: ${JSON.stringify(TITLE)},
      title: ${JSON.stringify(TITLE)}, messages, created: now }),
  })
  const j = await r.json().catch(() => ({}))
  return { status: r.status, persisted: j.persisted, chars: ${LONG.length} }
})()`)
check('a 30k-character thinking chain can be stored', saved?.status === 200, JSON.stringify(saved))

await send('Page.reload')
await new Promise((r) => setTimeout(r, 4000))
const opened = await waitFor(() => evaluate(OPEN_PANEL), 40000)
check('panel opens', Boolean(opened))
if (!opened) { ws.close(); chrome.kill(); process.exit(1) }

const clicked = await evaluate(`(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const items = Array.from(document.querySelectorAll('.ccp-root .ccp-item'))
  const mine = items.find((it) => (it.querySelector('.ccp-item-title')?.textContent || '').includes(${JSON.stringify(TITLE)}))
  if (!mine) return { ok: false, why: 'not in list', n: items.length }
  mine.click()
  await sleep(2500)
  const row = document.querySelector('.ccp-root .ccp-work-think .ccp-work-row')
  if (!row) return { ok: false, why: 'no thinking row' }
  row.click()
  await sleep(600)
  return { ok: true }
})()`)
check('the long thinking row opens', Boolean(clicked?.ok), JSON.stringify(clicked))

const snap = await evaluate(`(() => {
  const pre = document.querySelector('.ccp-root .ccp-work-think .ccp-work-detail')
  if (!pre) return { noDetail: true }
  const text = pre.textContent || ''
  return { len: text.length, tail: text.includes(${JSON.stringify(TAIL)}), head: text.slice(0, 30) }
})()`)
check('the expanded detail exists', Boolean(snap && !snap.noDetail), JSON.stringify(snap))
check('no 8,000-character cap remains', Number(snap?.len || 0) === LONG.length,
  `rendered=${snap?.len} expected=${LONG.length}`)
check('the last thought is present', Boolean(snap?.tail), JSON.stringify({ head: snap?.head }))

const purged = await evaluate(`(async () => {
  const r = await fetch('/api/claude-code-parity/history/purge', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: ${JSON.stringify(TITLE)} }),
  })
  return r.status
})()`)
check('the synthetic record is purged', purged === 200, 'HTTP ' + purged)

const failed = results.filter((r) => !r.ok)
console.log('\n' + (failed.length ? `FAIL ${failed.length}/${results.length}` : `PASS all ${results.length}`))
ws.close()
chrome.kill()
await new Promise((r) => setTimeout(r, 300))
process.exit(failed.length ? 1 : 0)
