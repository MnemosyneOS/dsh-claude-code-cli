// Click-through of the real upgrade UI: check → start → wait → read the verdict.
import { spawn } from 'node:child_process'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

const TOKEN = process.argv[2]
const BASE = 'http://127.0.0.1:39120'
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const RUN = Math.random().toString(36).slice(2, 8)
const PROFILE = path.join(os.tmpdir(), 'ccp-up-' + RUN)
const PORT = 9300 + Math.floor(Math.random() * 300)

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

const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--window-size=1440,900', 'about:blank'],
{ stdio: 'ignore', windowsHide: true })

async function waitFor(fn, ms, step = 300) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    try { const v = await fn(); if (v) return v } catch (e) { /* retry */ }
    await new Promise((r) => setTimeout(r, step))
  }
  return null
}

await waitFor(() => httpJson('/json/version'), 20000)
const t = await httpJson('/json/new?' + encodeURIComponent('about:blank'), 'PUT')
const ws = new WebSocket(t.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
let seq = 0
const pending = new Map()
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id)
    pending.delete(m.id)
    m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)
  }
}
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq
  pending.set(id, { resolve, reject })
  ws.send(JSON.stringify({ id, method, params }))
})
const evaluate = async (e) => {
  const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text)
  return r.result.value
}

await send('Page.enable')
await send('Runtime.enable')
await send('Page.navigate', { url: `${BASE}/?token=${encodeURIComponent(TOKEN)}` })
await waitFor(() => evaluate(`document.readyState === 'complete'`), 40000)
await new Promise((r) => setTimeout(r, 7000))

const results = []
const check = (name, ok, detail = '') => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  — ' + detail : ''))
  results.push({ name, ok })
}

// Open the panel from its sidebar row, then Settings → Advanced.
const opened = await evaluate(`(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const NL = String.fromCharCode(10)
  const row = Array.from(document.querySelectorAll('button'))
    .find((b) => (b.innerText || '').split(NL)[0].trim() === 'Claude Code Desktop')
  if (row) row.click()
  await sleep(3000)
  const gear = Array.from(document.querySelectorAll('button[title]'))
    .find((x) => /设置|Settings/.test(x.getAttribute('title') || ''))
  if (gear) gear.click()
  await sleep(1500)
  const tab = Array.from(document.querySelectorAll('.ccp-tab')).find((x) => /高级|Advanced/.test(x.textContent))
  if (tab) tab.click()
  await sleep(1200)
  return { panel: Boolean(document.querySelector('.ccp-root')), gear: Boolean(gear), tab: Boolean(tab) }
})()`)
check('settings → advanced opens', Boolean(opened && opened.panel && opened.gear && opened.tab), JSON.stringify(opened))

const snapshot = () => evaluate(`(() => {
  const NL = String.fromCharCode(10)
  const txt = document.body.innerText
  const i = txt.indexOf('升级 Claude CLI')
  return i < 0 ? '' : txt.slice(i, i + 400).split(NL).filter(Boolean).join(' | ')
})()`)

const before = await snapshot()
check('upgrade block visible before any click', /升级 Claude CLI/.test(before), before.slice(0, 120))

// Click 检查更新 and read the block again.
await evaluate(`(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const b = Array.from(document.querySelectorAll('.ccp-btn')).find((x) => /检查更新|Check update/.test(x.textContent))
  if (b) b.click()
  await sleep(4000)
})()`)
const afterCheck = await snapshot()
check('check update shows a real latest version', /最新版本: \d+\.\d+\.\d+/.test(afterCheck), afterCheck.slice(0, 200))
check('already-up-to-date badge appears', /已是最新版本/.test(afterCheck))
check('button is relabelled when nothing to install', /重新安装最新版/.test(afterCheck), afterCheck.slice(0, 220))

// Click 开始更新 and watch the running state.
const started = await evaluate(`(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const b = Array.from(document.querySelectorAll('.ccp-btn')).find((x) => /重新安装最新版|开始更新|Reinstall|Install update/.test(x.textContent))
  if (!b) return { clicked: false }
  const label = b.innerText.trim()
  b.click()
  await sleep(2500)
  const running = Array.from(document.querySelectorAll('.ccp-btn')).find((x) => /更新中|Updating/.test(x.textContent))
  return { clicked: true, label, runningLabel: running ? running.innerText.trim() : '' }
})()`)
check('start button is clickable', Boolean(started?.clicked), started?.label || '')
check('running state shows a live elapsed counter', /更新中.*\d+s/.test(started?.runningLabel || ''), started?.runningLabel || '')

// Wait for npm to finish, then read the verdict.
let final = ''
for (let i = 0; i < 60; i++) {
  await new Promise((r) => setTimeout(r, 3000))
  final = await snapshot()
  if (/更新完成|更新已执行|更新未能启动|npm 退出码|文件被占用/.test(final)) break
}
check('a verdict is shown after the run', /更新完成|更新已执行，版本未变化/.test(final), final.slice(0, 260))
check('npm log is rendered in the panel', /up to date|added|changed|packages/.test(final), final.slice(-200))

console.log()
const bad = results.filter((r) => !r.ok)
console.log(bad.length ? `${bad.length} FAILED` : `${results.length}/${results.length} passed`)
ws.close()
chrome.kill()
process.exit(bad.length ? 1 : 0)
