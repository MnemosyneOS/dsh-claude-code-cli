// Screenshot the jump-to-bottom control so its look can be checked against the
// reference image (a thin circle with a chevron, top-right of the transcript).
// usage: node _shot_tobottom.mjs <dsh-token> [outfile]
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

const TOKEN = process.argv[2]
const OUT = process.argv[3] || path.join(os.tmpdir(), 'ccp-tobottom.png')
const BASE = 'http://127.0.0.1:39120'
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PROFILE = path.join(os.tmpdir(), 'ccp-shot-' + Math.random().toString(36).slice(2, 8))
const PORT = 9800 + Math.floor(Math.random() * 90)
const TITLE = 'shot-scroll-' + Math.random().toString(36).slice(2, 8)

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
  '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--window-size=1280,860', 'about:blank'],
{ stdio: 'ignore', windowsHide: true })

async function waitFor(fn, ms, step = 300) {
  const end = Date.now() + ms
  while (Date.now() < end) { try { const v = await fn(); if (v) return v } catch (e) { /* retry */ } await new Promise((r) => setTimeout(r, step)) }
  return null
}

const version = await waitFor(() => httpJson('/json/version'), 20000)
if (!version) { chrome.kill(); process.exit(1) }
const target = await httpJson('/json/new?' + encodeURIComponent('about:blank'), 'PUT')
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
let seq = 0
const pending = new Map()
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result) }
}
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params }))
})
const evaluate = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text)
  return r.result?.value
}

await send('Page.enable')
await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 860, deviceScaleFactor: 2, mobile: false })
await send('Page.navigate', { url: `${BASE}/?token=${encodeURIComponent(TOKEN)}` })
await new Promise((r) => setTimeout(r, 3500))

await evaluate(`(async () => {
  const now = Date.now()
  const messages = []
  for (let i = 1; i <= 12; i++) {
    messages.push({ id: 'u' + i, role: 'user', text: '第 ' + i + ' 个问题：用来撑高会话的占位文本。', ts: now + i * 2, forceNew: true })
    messages.push({ id: 'a' + i, role: 'assistant', kind: 'blocks',
      blocks: [{ type: 'text', text: '第 ' + i + ' 条回答：' + '这是用于验证滚动位置的正文段落。'.repeat(3) }], ts: now + i * 2 + 1 })
  }
  await fetch('/api/claude-code-parity/history/save', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key: ${JSON.stringify(TITLE)}, id: ${JSON.stringify(TITLE)}, title: ${JSON.stringify(TITLE)}, messages, created: now }),
  })
  return true
})()`)

await send('Page.reload')
await new Promise((r) => setTimeout(r, 4000))
const opened = await waitFor(() => evaluate(`(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const NL = String.fromCharCode(10)
  if (document.querySelector('.ccp-root')) return true
  const btn = Array.from(document.querySelectorAll('button')).find((b) => (b.innerText || '').split(NL)[0].trim() === '插件')
  if (btn) btn.click(); await sleep(1600)
  const cards = Array.from(document.querySelectorAll('[class*="cardMain"]'))
  const mine = cards.find((c) => /claude/i.test(c.innerText || ''))
  if (mine) mine.click(); await sleep(2200)
  const row = Array.from(document.querySelectorAll('button')).find((b) => (b.innerText || '').split(NL)[0].trim() === 'Claude Code Desktop')
  if (row) row.click(); await sleep(2200)
  return Boolean(document.querySelector('.ccp-root'))
})()`), 40000)
if (!opened) { console.log('FAIL panel'); ws.close(); chrome.kill(); process.exit(1) }

await evaluate(`(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const items = Array.from(document.querySelectorAll('.ccp-root .ccp-item'))
  const mine = items.find((it) => (it.querySelector('.ccp-item-title')?.textContent || '').includes(${JSON.stringify(TITLE)}))
  if (mine) mine.click()
  await sleep(2200)
  const el = document.querySelector('.ccp-root .ccp-stream')
  el.scrollTop = 900
  el.dispatchEvent(new Event('scroll'))
  await sleep(600)
  return true
})()`)

const box = await evaluate(`(() => {
  const btn = document.querySelector('.ccp-tobottom')
  // getBoundingClientRect is already viewport-relative — that is what
  // Page.captureScreenshot's clip expects.
  const r = btn.getBoundingClientRect()
  return { x: r.x, y: r.y, w: r.width, h: r.height }
})()`)
// Keep the clip fully inside the viewport: a clip that runs past the right edge
// gets cut and makes a circle look like a flat-sided box.
const view = await evaluate('({ w: innerWidth, h: innerHeight })')
const pad = 26
const clip = {
  x: Math.max(0, Math.min(box.x - pad, view.w - (box.w + pad * 2))),
  y: Math.max(0, box.y - pad),
  width: box.w + pad * 2,
  height: box.h + pad * 2,
  scale: 3,
}
const shot = await send('Page.captureScreenshot', { format: 'png', clip })
fs.writeFileSync(OUT, Buffer.from(shot.data, 'base64'))
console.log('saved ' + OUT + '  button=' + JSON.stringify(box))

await evaluate(`(async () => {
  await fetch('/api/claude-code-parity/history/purge', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: ${JSON.stringify(TITLE)} }) })
})()`)
ws.close()
chrome.kill()
process.exit(0)
