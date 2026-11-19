// End-to-end proof for "the model only shows its thinking, never its answer".
//
// A reasoning model streams `thinking` first and its `blocks` afterwards. The
// merge rule used to key on `role === 'assistant' && streaming`, so the answer
// was appended INTO the thinking row — the turn rendered as a single muted
// "思考" line and the reply was unreachable in the DOM. This script drives the
// real panel with the real local model and requires the answer to be painted,
// both live and after a reload from history.
//
// usage: node _verify_reply_ui.mjs <dsh-token> [provider] [model]
import { spawn } from 'node:child_process'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

const TOKEN = process.argv[2]
const BASE = 'http://127.0.0.1:39120'
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const RUN = Math.random().toString(36).slice(2, 8)
const PROFILE = path.join(os.tmpdir(), 'ccp-reply-' + RUN)
const PORT = 9600 + Math.floor(Math.random() * 300)
const PROVIDER = process.argv[3] || 'qwen3-8-flash-next-exl3'
const MODEL = process.argv[4] || 'Qwen3.8-Flash-Next-EXL3-4.05bpw'
const PROMPT = '你好'

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
  if (msg.method === 'Runtime.exceptionThrown') {
    consoleErrors.push(msg.params?.exceptionDetails?.text || 'exception')
  }
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

// The snapshot of the last assistant turn: what the panel actually painted.
const SNAPSHOT = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const root = document.querySelector('.ccp-root')
  if (!root) return { noRoot: true }
  const groups = Array.from(root.querySelectorAll('.ccp-msg')).filter((m) => !m.classList.contains('user'))
  const last = groups[groups.length - 1]
  const think = last ? last.querySelector('.ccp-work-think') : null
  // Thinking rows are bare toggles now: the text lives in the expanded detail.
  if (think && !think.querySelector('.ccp-work-detail')) {
    think.querySelector('.ccp-work-row')?.click()
    await sleep(120)
  }
  const thinkText = think ? ((think.querySelector('.ccp-work-detail')?.textContent)
    || (think.innerText || '')).replace(/\\s+/g, ' ').trim() : ''
  const bodies = last ? Array.from(last.querySelectorAll('.ccp-readable')).map((x) => (x.innerText || '').trim()).filter(Boolean) : []
  return {
    busy: Boolean(root.querySelector('.ccp-loading')),
    turns: groups.length,
    thinkText,
    bodies,
    body: bodies.join('\\n'),
    whole: (root.innerText || '').slice(-600),
  }
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

const opened = await waitFor(async () => evaluate(`(async () => {
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
})()`), 40000)
check('plugin panel opens', Boolean(opened))
if (!opened) { ws.close(); chrome.kill(); process.exit(1) }

const sent = await evaluate(`(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const ta = document.querySelector('.ccp-root textarea')
  if (!ta) return { ok: false, why: 'no textarea' }
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
  setter.call(ta, ${JSON.stringify(PROMPT)})
  ta.dispatchEvent(new Event('input', { bubbles: true }))
  await sleep(300)
  const btn = document.querySelector('.ccp-root .ccp-send')
  if (!btn) return { ok: false, why: 'no send button' }
  if (btn.disabled) return { ok: false, why: 'send button disabled' }
  btn.click()
  await sleep(1200)
  return { ok: true }
})()`)
check('a message can be sent', Boolean(sent?.ok), JSON.stringify(sent))

// Wait for the turn to finish, then judge what is on screen.
const done = await waitFor(async () => {
  const s = await evaluate(SNAPSHOT)
  if (!s || s.noRoot || s.busy) return null
  return (s.body || s.thinkText) ? s : null
}, 240000, 1200)

check('the turn finishes and renders something', Boolean(done), done ? '' : 'nothing rendered within 240s')

const live = done || (await evaluate(SNAPSHOT))
const answer = String(live.body || '')
const think = String(live.thinkText || '')

check('the reasoning row is present (thinking path exercised)', think.length > 0, JSON.stringify(think.slice(0, 60)))
check('the answer body is painted', answer.length > 0, JSON.stringify(answer.slice(0, 80)))
check('the answer is real text, not a placeholder', /[\u4e00-\u9fa5A-Za-z0-9]/.test(answer) && answer.length >= 2,
  'len=' + answer.length)
check('the answer is NOT swallowed by the thinking row', answer.length > 0 && !think.includes(answer),
  'answer⊂thinking=' + think.includes(answer))
check('exactly one answer box for the turn', (live.bodies || []).length === 1, 'boxes=' + (live.bodies || []).length)

// The reply must survive a reload: history stores what the panel kept in state.
await new Promise((r) => setTimeout(r, 4000))
await send('Page.reload')
await new Promise((r) => setTimeout(r, 4000))
const reopened = await waitFor(async () => evaluate(`(async () => {
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
})()`), 40000)
check('panel reopens after reload', Boolean(reopened))

const clicked = await evaluate(`(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const items = Array.from(document.querySelectorAll('.ccp-root .ccp-item'))
  if (!items.length) return { ok: false, why: 'no history item' }
  items[0].click()
  await sleep(2500)
  return { ok: true, title: items[0].innerText.split(String.fromCharCode(10))[0] }
})()`)
check('the saved session can be reopened', Boolean(clicked?.ok), JSON.stringify(clicked))

const reloaded = await evaluate(SNAPSHOT)
check('the answer is still visible after reload', String(reloaded?.body || '').length > 0,
  JSON.stringify(String(reloaded?.body || '').slice(0, 80)))
check('no console errors during the run', consoleErrors.length === 0,
  consoleErrors.slice(0, 2).join(' | '))

console.log('\n--- last turn on screen ---\n' + String(reloaded?.whole || live.whole || '').replace(/\n+/g, ' | ').slice(-420))

ws.close()
chrome.kill()
await new Promise((r) => setTimeout(r, 500))

const failed = results.filter((r) => !r.ok)
console.log('\n' + (failed.length ? `FAIL ${failed.length}/${results.length}` : `PASS all ${results.length}`))
process.exit(failed.length ? 1 : 0)
