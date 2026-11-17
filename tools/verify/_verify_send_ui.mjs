// End-to-end check of the exact scenario that looked like a dead UI:
// attach a large video, send a task, and require the panel to come back with
// either an answer or a visible error — never a permanently disabled send
// button ("working…" with no way out).
import { spawn } from 'node:child_process'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

const TOKEN = process.argv[2]
const BASE = 'http://127.0.0.1:39120'
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const RUN = Math.random().toString(36).slice(2, 8)
const PROFILE = path.join(os.tmpdir(), 'ccp-send-' + RUN)
const PORT = 9300 + Math.floor(Math.random() * 300)
const PROVIDER = process.argv[3] || 'qwen3-8-flash-next-exl3'
const MODEL = process.argv[4] || 'Qwen3.8-Flash-Next-EXL3-4.05bpw'

const results = []
function check(name, ok, detail) {
  results.push({ name, ok, detail })
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

await send('Page.enable')
await send('Runtime.enable')
await send('Page.navigate', { url: `${BASE}/?token=${encodeURIComponent(TOKEN)}` })
await new Promise((r) => setTimeout(r, 3500))

// Pin the model so the test never depends on whatever is currently selected.
const pin = await evaluate(`(async () => {
  const r = await fetch('/api/claude-code-parity/model/select', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider: ${JSON.stringify(PROVIDER)}, model: ${JSON.stringify(MODEL)} }),
  })
  return r.status
})()`)
check('model pinned for the run', pin === 200, 'HTTP ' + pin)

// Open the panel.
const opened = await waitFor(async () => evaluate(`(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const NL = String.fromCharCode(10)
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
})()`), 40000)
check('plugin panel opens', Boolean(opened))

// Attach a 40 MB fake video through the real file input (it lives in the "+" menu).
const attached = await evaluate(`(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const plus = document.querySelector('.ccp-root .ccp-plus')
  if (!plus) return { ok: false, why: 'no plus button' }
  plus.click()
  await sleep(400)
  const inp = document.querySelector('.ccp-root .ccp-plusmenu input[type=file]')
  if (!inp) return { ok: false, why: 'no file input in the plus menu' }
  const bytes = new Uint8Array(40 * 1024 * 1024)
  bytes[4] = 0x66; bytes[5] = 0x74; bytes[6] = 0x79; bytes[7] = 0x70 // 'ftyp'
  const file = new File([bytes], 'clip.mp4', { type: 'video/mp4' })
  const dt = new DataTransfer()
  dt.items.add(file)
  inp.files = dt.files
  inp.dispatchEvent(new Event('change', { bubbles: true }))
  for (let i = 0; i < 30; i++) {
    await sleep(200)
    const chips = Array.from(document.querySelectorAll('.ccp-root .ccp-file')).map((x) => x.textContent.trim())
    if (chips.length) return { ok: true, chips }
  }
  return { ok: false, why: 'no attachment chip appeared' }
})()`)
check('40 MB attachment is accepted and shown', Boolean(attached?.ok), JSON.stringify(attached?.chips || attached?.why || ''))

// Type a short task and send.
const sent = await evaluate(`(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const ta = document.querySelector('.ccp-root textarea')
  if (!ta) return { ok: false, why: 'no textarea' }
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
  setter.call(ta, '只回答两个字：好的')
  ta.dispatchEvent(new Event('input', { bubbles: true }))
  await sleep(300)
  const btn = document.querySelector('.ccp-root .ccp-send')
  if (!btn) return { ok: false, why: 'no send button' }
  if (btn.disabled) return { ok: false, why: 'send button disabled' }
  btn.click()
  await sleep(1500)
  return { ok: true, busy: Boolean(document.querySelector('.ccp-root .ccp-send')?.disabled) }
})()`)
check('send button accepts the task', Boolean(sent?.ok), JSON.stringify(sent || {}))

// The whole point: the panel must leave the busy state on its own.
// `.ccp-loading` is the real busy indicator — the send button is also disabled
// when the composer is simply empty, so it cannot be used as the signal.
// The answer must be in a rendered answer body, not merely somewhere in the
// panel text: a thinking row that swallowed the reply used to satisfy a plain
// text search while the user saw no answer at all.
const settled = await waitFor(async () => evaluate(`(() => {
  const root = document.querySelector('.ccp-root')
  const busy = Boolean(root.querySelector('.ccp-loading'))
  const bodies = Array.from(root.querySelectorAll('.ccp-msg:not(.user) .ccp-readable')).map((x) => (x.innerText || '').trim())
  const answered = bodies.some((b) => /好的/.test(b))
  const errored = /失败|错误|error|超时|未返回内容/i.test(root.innerText || '')
  return (!busy && (answered || errored)) ? { busy, answered, errored, bodies: bodies.map((b) => b.slice(0, 40)) } : null
})()`), 180000, 1200)

check('panel returns to idle with an answer in the answer body (or a visible error)', Boolean(settled),
  settled ? `answered=${settled.answered} errored=${settled.errored} bodies=${JSON.stringify(settled.bodies)}` : 'still busy after 180s')

const finalState = await evaluate(`(() => ({
  busy: Boolean(document.querySelector('.ccp-root .ccp-loading')),
  text: (document.querySelector('.ccp-root')?.innerText || '').slice(-400),
}))()`)
check('busy indicator is cleared afterwards', !finalState.busy, 'busy=' + finalState.busy)

console.log('\n--- tail of the panel text ---\n' + String(finalState.text || '').replace(/\n+/g, ' | ').slice(-360))

ws.close()
chrome.kill()
await new Promise((r) => setTimeout(r, 500))

const failed = results.filter((r) => !r.ok)
console.log('\n' + (failed.length ? `FAIL ${failed.length}/${results.length}` : `PASS all ${results.length}`))
process.exit(failed.length ? 1 : 0)
