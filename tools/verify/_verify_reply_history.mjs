// The "thinking only" damage is already persisted in real history files: the
// panel stored the answer INSIDE the thinking row (kind 'thinking' + a blocks
// array), so re-opening that session showed nothing but the muted 思考 line.
// renderGroup now falls back to `result.text` for those records. This script
// proves it on both a deterministic synthetic record and the polluted records
// that already exist on this machine (read-only, nothing is modified).
//
// usage: node _verify_reply_history.mjs <dsh-token>
import { spawn } from 'node:child_process'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

const TOKEN = process.argv[2]
const BASE = 'http://127.0.0.1:39120'
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const RUN = Math.random().toString(36).slice(2, 8)
const PROFILE = path.join(os.tmpdir(), 'ccp-hist-' + RUN)
const PORT = 9900 + Math.floor(Math.random() * 90)
const TITLE = 'verify-broken-record-' + RUN
const ANSWER = '你好，堃！有什么需要帮忙的？'
const THINKING = '让我思考一下：用户在打招呼，直接回应即可。'

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

const SNAPSHOT = `(() => {
  const root = document.querySelector('.ccp-root')
  if (!root) return { noRoot: true }
  const groups = Array.from(root.querySelectorAll('.ccp-msg')).filter((m) => !m.classList.contains('user'))
  const last = groups[groups.length - 1]
  const think = last ? last.querySelector('.ccp-work-think') : null
  const bodies = last ? Array.from(last.querySelectorAll('.ccp-readable')).map((x) => (x.innerText || '').trim()).filter(Boolean) : []
  const foot = last ? last.querySelector('.ccp-respfoot') : null
  return {
    turns: groups.length,
    thinkText: think ? (think.innerText || '').replace(/\\s+/g, ' ').trim() : '',
    bodies,
    body: bodies.join('\\n'),
    copyBtns: foot ? foot.querySelectorAll('.ccp-foot-ico').length : 0,
    whole: (root.innerText || '').slice(-500),
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

/* ---- 1. write a record with the exact shape the old build produced ------- */
const saved = await evaluate(`(async () => {
  const now = Date.now()
  const messages = [
    { id: 'u1', role: 'user', text: '你好', ts: now, forceNew: true },
    { id: 't1', role: 'assistant', kind: 'thinking', streaming: false, ts: now + 1,
      text: ${JSON.stringify(THINKING)},
      blocks: [{ type: 'text', text: ${JSON.stringify(ANSWER)} }] },
    { id: 'r1', role: 'assistant', kind: 'result', ok: true, ts: now + 2, text: ${JSON.stringify(ANSWER)} },
  ]
  const r = await fetch('/api/claude-code-parity/history/save', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key: ${JSON.stringify(TITLE)}, id: ${JSON.stringify(TITLE)},
      title: ${JSON.stringify(TITLE)}, messages, created: now }),
  })
  const j = await r.json().catch(() => ({}))
  return { status: r.status, persisted: j.persisted }
})()`)
check('a record with the old broken shape can be stored', saved?.status === 200 && saved?.persisted !== false,
  JSON.stringify(saved))

/* ---- 2. reopen the panel and load it ------------------------------------- */
await send('Page.reload')
await new Promise((r) => setTimeout(r, 4000))
const opened = await waitFor(() => evaluate(OPEN_PANEL), 40000)
check('panel opens', Boolean(opened))
if (!opened) { ws.close(); chrome.kill(); process.exit(1) }

const clicked = await evaluate(`(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const items = Array.from(document.querySelectorAll('.ccp-root .ccp-item'))
  const mine = items.find((it) => (it.querySelector('.ccp-item-title')?.textContent || '').includes(${JSON.stringify(TITLE)}))
  if (!mine) return { ok: false, why: 'record not in the list', n: items.length }
  mine.click()
  await sleep(2500)
  return { ok: true }
})()`)
check('the broken record opens from history', Boolean(clicked?.ok), JSON.stringify(clicked))

const snap = await evaluate(SNAPSHOT)
const body = String(snap?.body || '')
const think = String(snap?.thinkText || '')
check('the thinking row is still shown', think.length > 0, JSON.stringify(think.slice(0, 50)))
check('the stored answer is recovered and painted', body.includes('有什么需要帮忙'), JSON.stringify(body.slice(0, 80)))
check('the answer is not folded into the thinking row', body.length > 0 && !think.includes(body),
  'answer⊂thinking=' + think.includes(body))
check('exactly one answer box is drawn', (snap?.bodies || []).length === 1, 'boxes=' + (snap?.bodies || []).length)
check('the footer still offers copy', Number(snap?.copyBtns || 0) >= 1, 'icons=' + snap?.copyBtns)

/* ---- 3. clean up the synthetic record ----------------------------------- */
const purged = await evaluate(`(async () => {
  const r = await fetch('/api/claude-code-parity/history/purge', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: ${JSON.stringify(TITLE)} }),
  })
  return r.status
})()`)
check('the synthetic record is purged', purged === 200, 'HTTP ' + purged)

/* ---- 4. the polluted records that already exist on this machine --------- */
const COPY = 'verify-real-copy-' + RUN
const scan = await evaluate(`(async () => {
  const list = await (await fetch('/api/claude-code-parity/history')).json()
  const sessions = (list.sessions || list || []).filter((s) => s && s.id && s.source !== 'cli')
  const broken = []
  for (const s of sessions.slice(0, 40)) {
    const d = await (await fetch('/api/claude-code-parity/history/session?id=' + encodeURIComponent(s.id))).json()
    const msgs = (d && d.messages) || []
    const bad = msgs.filter((m) => m.kind === 'thinking' && m.blocks && m.blocks.length)
    const res = [...msgs].reverse().find((m) => m.kind === 'result')
    if (bad.length && res && res.text) {
      broken.push({
        id: s.id,
        title: s.title || s.id,
        msgs,
        // Known markers let the check prove it loaded *this* record.
        think: String(bad[0].text || '').slice(0, 18),
        answer: String(res.text || '').replace(/\\s+/g, ' ').slice(0, 16),
      })
    }
  }
  broken.sort((a, b) => String(b.answer).length - String(a.answer).length)
  return { total: sessions.length, broken }
})()`)
const broken = (scan && scan.broken) || []
check('the machine was scanned for polluted records', Boolean(scan), 'sessions=' + (scan && scan.total))

if (!broken.length) {
  check('no polluted record on this machine (nothing to recover)', true, 'clean')
} else {
  // Sidebar items are filtered (recycle bin, archived) and titles repeat, so the
  // real payload is copied under a unique title instead of guessing which row to
  // click. The copy carries the exact stored messages — the damage included.
  const pick = broken[0]
  const copied = await evaluate(`(async () => {
    const r = await fetch('/api/claude-code-parity/history/save', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: ${JSON.stringify(COPY)}, id: ${JSON.stringify(COPY)},
        title: ${JSON.stringify(COPY)}, messages: ${JSON.stringify(pick.msgs)} }),
    })
    const j = await r.json().catch(() => ({}))
    return { status: r.status, persisted: j.persisted }
  })()`)
  check('a real polluted record can be copied for inspection',
    copied?.status === 200 && copied?.persisted !== false, JSON.stringify(copied))

  await send('Page.reload')
  await new Promise((r) => setTimeout(r, 4000))
  await waitFor(() => evaluate(OPEN_PANEL), 40000)

  const trial = await evaluate(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
    const items = Array.from(document.querySelectorAll('.ccp-root .ccp-item'))
      .filter((it) => (it.querySelector('.ccp-item-title')?.textContent || '') === ${JSON.stringify(COPY)})
    if (items.length !== 1) return { ok: false, why: 'copy not uniquely listed', n: items.length }
    items[0].click()
    await sleep(2600)
    const root = document.querySelector('.ccp-root')
    const groups = Array.from(root.querySelectorAll('.ccp-msg')).filter((m) => !m.classList.contains('user'))
    const last = groups[groups.length - 1]
    const think = last?.querySelector('.ccp-work-think')
    const thinkText = think ? (think.innerText || '').replace(/\\s+/g, ' ').trim() : ''
    const bodies = last ? Array.from(last.querySelectorAll('.ccp-readable')).map((x) => (x.innerText || '').trim()).filter(Boolean) : []
    const body = bodies.join(' ').replace(/\\s+/g, ' ')
    return {
      ok: thinkText.includes(${JSON.stringify(pick.think)}) && body.includes(${JSON.stringify(pick.answer)}),
      think: thinkText.slice(0, 40), body: body.slice(0, 80), boxes: bodies.length,
    }
  })()`)
  check(`a real polluted record (${broken.length} found) renders its answer`,
    Boolean(trial?.ok), JSON.stringify(trial))
  if (trial?.ok) {
    check('the real record still shows its thinking row', String(trial.think || '').length > 0, JSON.stringify(trial.think))
    check('the real record draws exactly one answer box', trial.boxes === 1, 'boxes=' + trial.boxes)
  }
  const purgedCopy = await evaluate(`(async () => {
    const r = await fetch('/api/claude-code-parity/history/purge', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: ${JSON.stringify(COPY)} }),
    })
    return r.status
  })()`)
  check('the copied record is purged', purgedCopy === 200, 'HTTP ' + purgedCopy)
}

console.log('\n--- last turn on screen ---\n' + String(snap?.whole || '').replace(/\n+/g, ' | ').slice(-360))

ws.close()
chrome.kill()
await new Promise((r) => setTimeout(r, 500))

const failed = results.filter((r) => !r.ok)
console.log('\n' + (failed.length ? `FAIL ${failed.length}/${results.length}` : `PASS all ${results.length}`))
process.exit(failed.length ? 1 : 0)
