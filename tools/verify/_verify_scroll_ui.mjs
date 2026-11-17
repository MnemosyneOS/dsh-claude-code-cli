// Scroll behaviour of the transcript.
//
// Two things used to be wrong together: every incoming event yanked the view back
// to the bottom, so reading an earlier turn during a long answer was impossible,
// and there was no way back down except dragging. This script drives the real
// panel: it seeds a long session so the transcript can scroll, sends a long task,
// scrolls up while the answer is still streaming, and requires the position to
// hold, the jump button to appear, and a click on it to return to the newest
// output — after which auto-follow resumes.
//
// usage: node _verify_scroll_ui.mjs <dsh-token> [provider] [model]
import { spawn } from 'node:child_process'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

const TOKEN = process.argv[2]
const BASE = 'http://127.0.0.1:39120'
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const RUN = Math.random().toString(36).slice(2, 8)
const PROFILE = path.join(os.tmpdir(), 'ccp-scroll-' + RUN)
const PORT = 9700 + Math.floor(Math.random() * 90)
const PROVIDER = process.argv[3] || 'qwen3-8-flash-next-exl3'
const MODEL = process.argv[4] || 'Qwen3.8-Flash-Next-EXL3-4.05bpw'
const TITLE = 'verify-scroll-' + RUN
const PROMPT = '请输出 40 行编号列表，每行至少 12 个字，主题随意，不要解释。'

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
  '--window-size=1280,860', 'about:blank',
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
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id)
    pending.delete(msg.id)
    if (msg.error) reject(new Error(JSON.stringify(msg.error)))
    else resolve(msg.result)
    return
  }
  if (msg.method === 'Runtime.exceptionThrown') consoleErrors.push(msg.params?.exceptionDetails?.text || 'exception')
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params?.type === 'error') {
    consoleErrors.push((msg.params.args || []).map((a) => a.value ?? a.description ?? '').join(' '))
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

const METRICS = `(() => {
  const el = document.querySelector('.ccp-root .ccp-stream')
  if (!el) return { noStream: true }
  const gap = el.scrollHeight - el.scrollTop - el.clientHeight
  const btn = document.querySelector('.ccp-root .ccp-tobottom')
  const rect = btn ? btn.getBoundingClientRect() : null
  const box = el.getBoundingClientRect()
  return {
    gap: Math.round(gap),
    top: Math.round(el.scrollTop),
    scrollable: el.scrollHeight - el.clientHeight,
    scrollHeight: el.scrollHeight,
    arrow: Boolean(btn),
    // The control must sit inside the transcript box, top-right.
    arrowInBox: rect ? (rect.top >= box.top - 2 && rect.right <= box.right + 2 && rect.left > box.left + box.width / 2) : false,
    arrowLabel: btn ? (btn.getAttribute('aria-label') || '') : '',
    busy: Boolean(document.querySelector('.ccp-root .ccp-loading')),
  }
})()`

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

const pin = await evaluate(`(async () => {
  const r = await fetch('/api/claude-code-parity/model/select', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider: ${JSON.stringify(PROVIDER)}, model: ${JSON.stringify(MODEL)} }),
  })
  return r.status
})()`)
check('model pinned for the run', pin === 200, 'HTTP ' + pin)

// A long synthetic session gives the transcript something to scroll.
const seeded = await evaluate(`(async () => {
  const now = Date.now()
  const messages = []
  for (let i = 1; i <= 24; i++) {
    messages.push({ id: 'u' + i, role: 'user', text: '第 ' + i + ' 个问题：这是一段用来撑高会话的占位文本。', ts: now + i * 2, forceNew: true })
    messages.push({ id: 'a' + i, role: 'assistant', kind: 'blocks',
      blocks: [{ type: 'text', text: '第 ' + i + ' 条回答：' + '这是用于验证滚动位置的正文段落。'.repeat(3) }],
      text: '第 ' + i + ' 条回答', ts: now + i * 2 + 1 })
  }
  const r = await fetch('/api/claude-code-parity/history/save', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key: ${JSON.stringify(TITLE)}, id: ${JSON.stringify(TITLE)},
      title: ${JSON.stringify(TITLE)}, messages, created: now }),
  })
  const j = await r.json().catch(() => ({}))
  return { status: r.status, persisted: j.persisted }
})()`)
check('a long session can be seeded', seeded?.status === 200 && seeded?.persisted !== false, JSON.stringify(seeded))

await send('Page.reload')
await new Promise((r) => setTimeout(r, 4000))
const opened = await waitFor(() => evaluate(OPEN_PANEL), 40000)
check('panel opens', Boolean(opened))
if (!opened) { ws.close(); chrome.kill(); process.exit(1) }

const loaded = await evaluate(`(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const items = Array.from(document.querySelectorAll('.ccp-root .ccp-item'))
  const mine = items.find((it) => (it.querySelector('.ccp-item-title')?.textContent || '').includes(${JSON.stringify(TITLE)}))
  if (!mine) return { ok: false, n: items.length }
  mine.click()
  await sleep(2200)
  return { ok: true }
})()`)
check('the long session loads', Boolean(loaded?.ok), JSON.stringify(loaded))

const start = await evaluate(METRICS)
check('the transcript is scrollable', Number(start?.scrollable || 0) > 400, 'scrollable=' + start?.scrollable)
check('a freshly opened session lands at the newest message', Number(start?.gap || 0) <= 40, 'gap=' + start?.gap)
check('no jump button while already at the bottom', start?.arrow === false, 'arrow=' + start?.arrow)

// Scroll up: the button must appear, positioned top-right inside the transcript.
const up = await evaluate(`(async () => {
  const el = document.querySelector('.ccp-root .ccp-stream')
  el.scrollTop = 0
  el.dispatchEvent(new Event('scroll'))
  await new Promise((r) => setTimeout(r, 700))
  return true
})()`)
const upState = await evaluate(METRICS)
check('scrolling up shows the jump button', Boolean(up) && upState?.arrow === true, 'arrow=' + upState?.arrow)
check('the button sits at the top-right of the transcript', upState?.arrowInBox === true, JSON.stringify({ inBox: upState?.arrowInBox }))
check('the button carries a readable label', String(upState?.arrowLabel || '').length > 0, JSON.stringify(upState?.arrowLabel))

// Send a long task, then scroll up while it streams.
const sent = await evaluate(`(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const ta = document.querySelector('.ccp-root textarea')
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
  setter.call(ta, ${JSON.stringify(PROMPT)})
  ta.dispatchEvent(new Event('input', { bubbles: true }))
  await sleep(300)
  document.querySelector('.ccp-root .ccp-send').click()
  await sleep(1500)
  return { ok: true }
})()`)
check('a long task is sent', Boolean(sent?.ok))

// Wait until the answer has started growing, then park the view at the top.
const grew = await waitFor(async () => {
  const m = await evaluate(METRICS)
  return m && !m.noStream && m.busy && m.scrollable > Number(start.scrollable) + 60 ? m : null
}, 90000, 800)
check('the streaming answer grows the transcript', Boolean(grew), grew ? 'scrollable=' + grew.scrollable : 'no growth in 90s')

await evaluate(`(async () => {
  const el = document.querySelector('.ccp-root .ccp-stream')
  el.scrollTop = 0
  el.dispatchEvent(new Event('scroll'))
  await new Promise((r) => setTimeout(r, 400))
})()`)
const parked = await evaluate(METRICS)
check('the view can be parked at the top while streaming', Number(parked?.gap || 0) > 200, 'gap=' + parked?.gap)

// The heart of the fix: the answer lands while the reader sits far above it.
// The bridge delivers the reply as one `blocks` event, so waiting for the turn to
// finish is the meaningful moment — that is exactly when the old code yanked the
// view down.
const after = await waitFor(async () => {
  const m = await evaluate(`(() => {
    const el = document.querySelector('.ccp-root .ccp-stream')
    return { grew: el.scrollHeight > ${Number(parked?.scrollHeight || 0)},
      gap: Math.round(el.scrollHeight - el.scrollTop - el.clientHeight),
      scrollHeight: el.scrollHeight,
      busy: Boolean(document.querySelector('.ccp-root .ccp-loading')) }
  })()`)
  return m && !m.busy ? m : null
}, 240000, 1200)
check('the turn finished while parked at the top', Boolean(after), after ? '' : 'still running after 240s')
check('the answer arrived while parked at the top', Boolean(after?.grew),
  'scrollHeight ' + parked?.scrollHeight + ' → ' + after?.scrollHeight)
check('the position holds instead of being yanked to the bottom', Number(after?.gap ?? 0) > 200, 'gap=' + after?.gap)

const parkedState = await evaluate(METRICS)
check('the jump button is offered while parked', parkedState?.arrow === true, 'arrow=' + parkedState?.arrow)

// Clicking it returns to the newest output and resumes auto-follow.
const clicked = await evaluate(`(async () => {
  const btn = document.querySelector('.ccp-root .ccp-tobottom')
  if (!btn) return { ok: false, why: 'no button' }
  btn.click()
  await new Promise((r) => setTimeout(r, 1400))
  const el = document.querySelector('.ccp-root .ccp-stream')
  return { ok: true, gap: Math.round(el.scrollHeight - el.scrollTop - el.clientHeight) }
})()`)
// gap 0 is success, so it must not be swallowed by a `|| fallback`.
const jumpGap = clicked && clicked.gap !== undefined ? Number(clicked.gap) : null
check('clicking the button jumps to the bottom', Boolean(clicked?.ok) && jumpGap !== null && jumpGap <= 40,
  'gap=' + (jumpGap === null ? 'n/a' : jumpGap))

const backState = await evaluate(METRICS)
check('the button disappears once at the bottom', backState?.arrow === false, 'arrow=' + backState?.arrow)

// Back at the bottom, following must resume by itself.
const follow = await evaluate(`(async () => {
  const el = document.querySelector('.ccp-root .ccp-stream')
  const before = el.scrollHeight
  await new Promise((r) => setTimeout(r, 5000))
  const gap = el.scrollHeight - el.scrollTop - el.clientHeight
  return { grew: el.scrollHeight > before, gap: Math.round(gap),
    busy: Boolean(document.querySelector('.ccp-root .ccp-loading')) }
})()`)
if (follow?.grew) {
  check('auto-follow resumes at the bottom', Number(follow?.gap || 0) <= 60, 'gap=' + follow?.gap)
} else {
  check('auto-follow resumes at the bottom', Number(follow?.gap || 0) <= 60,
    'no new output in the window (turn already finished), gap=' + follow?.gap)
}

check('no console errors during the run', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | '))

// Clean up the seeded session.
const purged = await evaluate(`(async () => {
  const r = await fetch('/api/claude-code-parity/history/purge', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: ${JSON.stringify(TITLE)} }),
  })
  return r.status
})()`)
check('the seeded session is purged', purged === 200, 'HTTP ' + purged)

ws.close()
chrome.kill()
await new Promise((r) => setTimeout(r, 500))

const failed = results.filter((r) => !r.ok)
console.log('\n' + (failed.length ? `FAIL ${failed.length}/${results.length}` : `PASS all ${results.length}`))
process.exit(failed.length ? 1 : 0)
