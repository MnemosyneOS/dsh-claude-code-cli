// Thinking must be *seen* while it happens.
//
// Before this, the whole chain arrived as one finished block: the CLI only
// emitted finished messages, the panel painted them in one go, and the row was
// collapsed to a single line anyway. Three things had to change together —
// `--include-partial-messages` on the CLI, a typing pump in the panel, and a
// thinking row that opens itself while it is live — so this drives the real
// panel and samples the DOM while the answer is still streaming.
//
// It also covers the sidebar footer (archive / recycle bin / settings) and the
// removal of the settings entry from the "+" menu.
//
// usage: node _verify_typing_ui.mjs <dsh-token> [provider] [model]
import { spawn } from 'node:child_process'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

const TOKEN = process.argv[2]
const BASE = 'http://127.0.0.1:39120'
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const RUN = Math.random().toString(36).slice(2, 8)
const PROFILE = path.join(os.tmpdir(), 'ccp-typing-' + RUN)
const PORT = 9800 + Math.floor(Math.random() * 90)
const PROVIDER = process.argv[3] || 'workbuddy-ai'
const MODEL = process.argv[4] || 'hy4flash'

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
await waitFor(() => evaluate(OPEN_PANEL), 45000)

/* ---------------------------------------------------------------- footer UI */

const foot = await evaluate(`(() => {
  const bar = document.querySelector('.ccp-root .ccp-sidefoot')
  if (!bar) return { ok: false }
  const btns = Array.from(bar.querySelectorAll('.ccp-sidebtn'))
  return {
    ok: true,
    count: btns.length,
    labels: btns.map((b) => (b.innerText || '').trim()),
    icons: btns.map((b) => Boolean(b.querySelector('svg'))),
    order: btns.map((b) => (b.innerText || '').trim()).join('|'),
  }
})()`)
check('the sidebar footer exists', Boolean(foot?.ok))
check('it holds exactly three buttons', foot?.count === 3, 'count=' + foot?.count)
check('they read archive / recycle bin / settings in that order',
  foot?.order === '归档|回收站|设置', JSON.stringify(foot?.order))
check('every footer button carries an icon', Array.isArray(foot?.icons) && foot.icons.every(Boolean),
  JSON.stringify(foot?.icons))

// Archive list: toggling must change what the sidebar lists and light the button.
const archiveToggle = await evaluate(`(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const btns = Array.from(document.querySelectorAll('.ccp-root .ccp-sidefoot .ccp-sidebtn'))
  const ar = btns.find((b) => (b.innerText || '').trim() === '归档')
  if (!ar) return { ok: false, why: 'no archive button' }
  ar.click()
  await sleep(1200)
  const on = document.querySelector('.ccp-root .ccp-sidebtn.on')
  return {
    ok: true,
    lit: on ? (on.innerText || '').trim() : '',
    items: document.querySelectorAll('.ccp-root .ccp-item').length,
    empty: Boolean(document.querySelector('.ccp-root .ccp-empty')),
  }
})()`)
check('clicking archive switches the list and highlights the button',
  Boolean(archiveToggle?.ok) && archiveToggle.lit === '归档',
  'lit=' + JSON.stringify(archiveToggle?.lit) + ' items=' + archiveToggle?.items)

const binToggle = await evaluate(`(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const btns = Array.from(document.querySelectorAll('.ccp-root .ccp-sidefoot .ccp-sidebtn'))
  const tr = btns.find((b) => (b.innerText || '').trim() === '回收站')
  if (!tr) return { ok: false }
  tr.click()
  await sleep(1200)
  const on = document.querySelector('.ccp-root .ccp-sidebtn.on')
  const items = document.querySelectorAll('.ccp-root .ccp-item').length
  // Back to the live list for the rest of the run.
  tr.click()
  await sleep(900)
  return { ok: true, lit: on ? (on.innerText || '').trim() : '', items }
})()`)
check('clicking the recycle bin switches to the bin', Boolean(binToggle?.ok) && binToggle.lit === '回收站',
  'lit=' + JSON.stringify(binToggle?.lit) + ' items=' + binToggle?.items)

const plusMenu = await evaluate(`(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const plus = document.querySelector('.ccp-root .ccp-plus')
  if (!plus) return { ok: false, why: 'no plus button' }
  plus.click()
  await sleep(700)
  const menu = document.querySelector('.ccp-root .ccp-plusmenu')
  const text = menu ? (menu.innerText || '') : ''
  const hasSettings = /设置|Settings/.test(text)
  plus.click()
  await sleep(400)
  return { ok: true, hasSettings, text: text.replace(/\\n+/g, ' / ').slice(0, 160) }
})()`)
check('the "+" menu no longer offers settings', Boolean(plusMenu?.ok) && plusMenu.hasSettings === false,
  plusMenu?.text)

/* ------------------------------------------------------- typing behaviour */

const pin = await evaluate(`(async () => {
  const r = await fetch('/api/claude-code-parity/model/select', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider: ${JSON.stringify(PROVIDER)}, model: ${JSON.stringify(MODEL)} }),
  })
  return r.status
})()`)
check('model pinned for the run', pin === 200, 'HTTP ' + pin)

// A new conversation, so the sample only sees this turn.
const fresh = await evaluate(`(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const b = document.querySelector('.ccp-root .ccp-new')
  if (b) b.click()
  await sleep(900)
  return Boolean(document.querySelector('.ccp-root .ccp-stream'))
})()`)
check('a fresh conversation can be opened', Boolean(fresh))

const PROMPT = '请先在心里逐条推理：1 到 30 的每个整数是否为质数、为什么，然后只给出最终结论清单。'

// Sample the DOM every 200 ms: a one-shot render produces at most one step from
// zero to full, a real stream produces many.
const sampler = `;(() => {
  window.__ccpS = { think: [], body: [], live: 0, n: 0 }
  const read = () => {
    const root = document.querySelector('.ccp-root')
    if (!root) return
    const d = Array.from(root.querySelectorAll('.ccp-work-think .ccp-work-detail'))
    const think = d.map((x) => (x.textContent || '').length).reduce((a, b) => a + b, 0)
    const body = Array.from(root.querySelectorAll('.ccp-msg:not(.user) .ccp-readable'))
      .map((x) => (x.textContent || '').length).reduce((a, b) => a + b, 0)
    window.__ccpS.think.push(think)
    window.__ccpS.body.push(body)
    window.__ccpS.live = Math.max(window.__ccpS.live, d.length)
    window.__ccpS.n++
  }
  read()
  window.__ccpTimer = setInterval(read, 200)
  return true
})()`

const start = await evaluate(`(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const box = document.querySelector('.ccp-root textarea, .ccp-root [contenteditable="true"]')
  if (!box) return { ok: false, why: 'no composer' }
  const text = ${JSON.stringify(PROMPT)}
  if (box.tagName === 'TEXTAREA') {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
    setter.call(box, text)
    box.dispatchEvent(new Event('input', { bubbles: true }))
  } else {
    box.focus()
    document.execCommand('insertText', false, text)
  }
  await sleep(300)
  // Sampling starts before the click so the very first frame is captured.
  ${sampler};
  const btn = document.querySelector('.ccp-root .ccp-send')
  if (!btn) return { ok: false, why: 'no send button' }
  if (btn.disabled) return { ok: false, why: 'send button disabled' }
  btn.click()
  await sleep(500)
  return { ok: true, busy: Boolean(document.querySelector('.ccp-root .ccp-loading')) }
})()`)
check('the task was sent', Boolean(start?.ok), start?.why || 'busy=' + start?.busy)

const done = await waitFor(() => evaluate(`(() => {
  const root = document.querySelector('.ccp-root')
  if (!root) return null
  if (document.querySelector('.ccp-root .ccp-loading')) return null
  const s = window.__ccpS || { n: 0 }
  return s.n > 4 ? { n: s.n } : null
})()`), 300000, 800)
check('the turn finished while sampling', Boolean(done), done ? done.n + ' samples' : 'never went idle')

const samples = await evaluate(`(() => {
  clearInterval(window.__ccpTimer)
  const s = window.__ccpS || { think: [], body: [], live: 0 }
  return { think: s.think, body: s.body, live: s.live, n: s.n }
})()`)

const thinkSeq = (samples?.think || [])
const thinkMax = Math.max(0, ...thinkSeq)
// Steps strictly between "nothing yet" and "everything": each one is a moment
// where the reader could actually see a partial chain.
const thinkSteps = new Set(thinkSeq.filter((v) => v > 0 && v < thinkMax))
check('the thinking chain was streamed, not delivered in one block',
  thinkSteps.size >= 4,
  'steps=' + thinkSteps.size + ' max=' + thinkMax + ' samples=' + thinkSeq.length)
check('the chain only ever grew', thinkSeq.every((v, i) => i === 0 || v >= thinkSeq[i - 1]),
  JSON.stringify(thinkSeq.slice(0, 14)))
check('the thinking detail box was open while streaming', Number(samples?.live || 0) >= 1,
  'openBoxes=' + samples?.live)

const bodySeq = (samples?.body || [])
const bodyMax = Math.max(0, ...bodySeq)
const bodySteps = new Set(bodySeq.filter((v) => v > 0 && v < bodyMax))
check('the answer was streamed too, not pasted at the end',
  bodySteps.size >= 3,
  'steps=' + bodySteps.size + ' max=' + bodyMax)

// A settled turn must stop typing: the pump has to release the tail.
const settled = await evaluate(`(() => {
  const root = document.querySelector('.ccp-root')
  const live = root.querySelectorAll('.ccp-work-detail.live').length
  const blink = root.querySelectorAll('.ccp-work-live').length
  const text = (root.querySelector('.ccp-msg:not(.user) .ccp-readable') || {}).textContent || ''
  return { live, blink, len: text.trim().length }
})()`)
check('no row is still marked as streaming after the turn',
  Number(settled?.live || 0) === 0 && Number(settled?.blink || 0) === 0,
  'live=' + settled?.live + ' blink=' + settled?.blink)
check('the final answer is fully on screen', Number(settled?.len || 0) > 20, 'len=' + settled?.len)

check('the panel logged no console errors', consoleErrors.length === 0,
  consoleErrors.slice(0, 2).join(' | '))

ws.close()
chrome.kill()
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length}`)
process.exit(failed ? 1 : 0)
