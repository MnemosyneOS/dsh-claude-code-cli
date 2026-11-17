// Real-browser verification of the split view and the Start panel.
// Every card must do something real: files list the workspace, the terminal
// runs a command, diagnostics reads live state.
import { spawn } from 'node:child_process'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

const TOKEN = process.argv[2]
const BASE = 'http://127.0.0.1:39120'
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const RUN = Math.random().toString(36).slice(2, 8)
const PROFILE = path.join(os.tmpdir(), 'ccp-split-' + RUN)
const PORT = 9300 + Math.floor(Math.random() * 300)

const results = []
function check(name, ok, detail) {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS ' : 'FAIL '} ${name}${detail ? '  — ' + detail : ''}`)
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

async function openPanel() {
  await send('Page.navigate', { url: `${BASE}/?token=${encodeURIComponent(TOKEN)}` })
  await new Promise((r) => setTimeout(r, 3500))
  return waitFor(async () => evaluate(`(async () => {
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
  })()`), 45000)
}

await send('Page.enable')
await send('Runtime.enable')
check('panel opens', Boolean(await openPanel()))

/* ---- 1. the three layout buttons exist ---- */
const btns = await evaluate(`Array.from(document.querySelectorAll('.ccp-layouts button')).map((b) => b.getAttribute('title'))`)
check('three layout buttons are present', Array.isArray(btns) && btns.length === 3, (btns || []).join(' / '))
check('the single-pane button starts active',
  Boolean(await evaluate(`Boolean(document.querySelector('.ccp-layouts button.on'))`)))

/* ---- 2. switch to side-by-side ---- */
await evaluate(`document.querySelectorAll('.ccp-layouts button')[1].click()`)
const splitOn = await waitFor(async () => evaluate(`(() => {
  const body = document.querySelector('.ccp-body')
  const pane2 = document.querySelector('.ccp-pane2')
  return body && body.classList.contains('h') && pane2 && document.querySelector('.ccp-start')
    ? { cls: body.className, cards: Array.from(document.querySelectorAll('.ccp-start-card')).map((c) => c.innerText.split(String.fromCharCode(10))[0]) }
    : null
})()`), 12000)
check('side-by-side split renders the second pane', Boolean(splitOn), splitOn?.cls || '')
check('the Start panel lists all five entries', Array.isArray(splitOn?.cards) && splitOn.cards.length === 5,
  (splitOn?.cards || []).join(' / '))

/* ---- 3. workspace files card ---- */
const filesView = await waitFor(async () => evaluate(`(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const card = Array.from(document.querySelectorAll('.ccp-start-card')).find((c) => /工作区文件|Workspace files/.test(c.innerText))
  if (!card) return { ok: false, why: 'card missing' }
  card.click()
  for (let i = 0; i < 40; i++) {
    await sleep(200)
    const rows = Array.from(document.querySelectorAll('.ccp-start-row'))
    if (rows.length) {
      const path = document.querySelector('.ccp-start-path')?.textContent || ''
      return { ok: true, n: rows.length, path, first: rows.slice(0, 3).map((r) => r.querySelector('.nm')?.textContent) }
    }
  }
  const err = document.querySelector('.ccp-start-body .ccp-hint')?.textContent || ''
  return { ok: false, why: err || 'no rows' }
})()`), 25000)
check('workspace files lists a real directory', Boolean(filesView?.ok),
  filesView?.ok ? `${filesView.n} entries @ ${filesView.path}` : String(filesView?.why))

/* ---- 4. terminal card actually runs a command ---- */
const termView = await waitFor(async () => evaluate(`(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const back = document.querySelector('.ccp-start-head button')
  if (back) back.click()
  await sleep(500)
  const card = Array.from(document.querySelectorAll('.ccp-start-card')).find((c) => /新建终端|New terminal/.test(c.innerText))
  if (!card) return { ok: false, why: 'card missing' }
  card.click()
  await sleep(600)
  const input = document.querySelector('.ccp-start-body input.ccp-input')
  if (!input) return { ok: false, why: 'no command input' }
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(input, 'echo ccp-split-ok')
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await sleep(400)
  const runBtn = Array.from(document.querySelectorAll('.ccp-start-body .ccp-btn')).find((b) => /运行|Run/.test(b.textContent))
  if (!runBtn) return { ok: false, why: 'no run button' }
  runBtn.click()
  for (let i = 0; i < 60; i++) {
    await sleep(250)
    const pre = document.querySelector('.ccp-start-pre')
    if (pre && pre.textContent.includes('exit')) return { ok: true, out: pre.textContent.slice(0, 120) }
  }
  return { ok: false, why: 'no output' }
})()`), 40000)
check('terminal runs a command and shows its output', Boolean(termView?.ok),
  termView?.ok ? termView.out.replace(/\n+/g, ' | ') : String(termView?.why))

/* ---- 5. diagnostics card ---- */
const diagView = await waitFor(async () => evaluate(`(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const back = document.querySelector('.ccp-start-head button')
  if (back) back.click()
  await sleep(500)
  const card = Array.from(document.querySelectorAll('.ccp-start-card')).find((c) => /会话数据诊断|Session diagnostics/.test(c.innerText))
  if (!card) return { ok: false, why: 'card missing' }
  card.click()
  for (let i = 0; i < 40; i++) {
    await sleep(200)
    const dts = Array.from(document.querySelectorAll('.ccp-start-kv dt')).map((d) => d.textContent)
    if (dts.length) {
      const dds = Array.from(document.querySelectorAll('.ccp-start-kv dd')).map((d) => d.textContent)
      return { ok: true, n: dts.length, sample: dts.slice(0, 4).map((k, i) => k + '=' + dds[i]) }
    }
  }
  return { ok: false, why: 'no diagnostics rows' }
})()`), 25000)
check('diagnostics shows live runtime values', Boolean(diagView?.ok),
  diagView?.ok ? `${diagView.n} fields · ${diagView.sample.join(', ')}` : String(diagView?.why))

/* ---- 6. stacked layout ---- */
await evaluate(`document.querySelectorAll('.ccp-layouts button')[2].click()`)
const stacked = await waitFor(async () => evaluate(`(() => {
  const b = document.querySelector('.ccp-body')
  return b && b.classList.contains('v') ? b.className : null
})()`), 8000)
check('top/bottom split switches the direction', Boolean(stacked), stacked || '')

/* ---- 7. layout survives a reload ---- */
// A reload drops back to the DSH shell, so the panel has to be opened again
// before the stored layout can be observed.
await openPanel()
const persisted = await waitFor(async () => evaluate(`(() => {
  const b = document.querySelector('.ccp-body')
  return b ? b.className : null
})()`), 20000)
check('layout choice persists across a reload', Boolean(persisted && persisted.includes('v')), persisted || '')

/* ---- 8. back to single ---- */
await evaluate(`document.querySelectorAll('.ccp-layouts button')[0].click()`)
const single = await waitFor(async () => evaluate(`(() => {
  const b = document.querySelector('.ccp-body')
  return b && !document.querySelector('.ccp-pane2') ? 'single' : null
})()`), 8000)
check('single-pane mode hides the second pane', Boolean(single), single || '')

/* ---- 9. Ctrl+P opens the files card from single-pane mode ---- */
await evaluate(`(() => { const ta = document.querySelector('.ccp-root .ccp-ta'); if (ta) ta.focus(); return true })()`)
for (const type of ['keyDown', 'keyUp']) {
  await send('Input.dispatchKeyEvent', {
    type, modifiers: 2, key: 'p', code: 'KeyP', windowsVirtualKeyCode: 80, nativeVirtualKeyCode: 80,
  })
}
const shortcut = await waitFor(async () => evaluate(`(() => {
  const body = document.querySelector('.ccp-body')
  const rows = document.querySelectorAll('.ccp-start-row').length
  return body && body.classList.contains('h') && rows > 0 ? { cls: body.className, rows } : null
})()`), 20000)
check('Ctrl+P opens the workspace files card', Boolean(shortcut),
  shortcut ? `${shortcut.cls} · ${shortcut.rows} entries` : 'did not open')

ws.close()
chrome.kill()
await new Promise((r) => setTimeout(r, 500))
const failed = results.filter((r) => !r.ok)
console.log('\n' + (failed.length ? `FAIL ${failed.length}/${results.length}` : `PASS all ${results.length}`))
process.exit(failed.length ? 1 : 0)
