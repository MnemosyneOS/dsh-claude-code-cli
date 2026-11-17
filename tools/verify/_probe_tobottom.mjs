// Probe the computed style of the jump button to see what the browser really
// applied (a rounded square instead of the intended circle means something is
// outranking .ccp-tobottom).
// usage: node _probe_tobottom.mjs <dsh-token>
import { spawn } from 'node:child_process'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

const TOKEN = process.argv[2]
const BASE = 'http://127.0.0.1:39120'
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PROFILE = path.join(os.tmpdir(), 'ccp-probe-' + Math.random().toString(36).slice(2, 8))
const PORT = 9850 + Math.floor(Math.random() * 40)
const TITLE = 'probe-scroll-' + Math.random().toString(36).slice(2, 8)

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
  while (Date.now() < end) { try { const v = await fn(); if (v) return v } catch (e) {} await new Promise((r) => setTimeout(r, step)) }
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
await send('Page.navigate', { url: `${BASE}/?token=${encodeURIComponent(TOKEN)}` })
await new Promise((r) => setTimeout(r, 3500))
await evaluate(`(async () => {
  const now = Date.now()
  const messages = []
  for (let i = 1; i <= 8; i++) {
    messages.push({ id: 'u' + i, role: 'user', text: '问题 ' + i, ts: now + i * 2, forceNew: true })
    messages.push({ id: 'a' + i, role: 'assistant', kind: 'blocks', blocks: [{ type: 'text', text: ('回答 ' + i + ' ').repeat(30) }], ts: now + i * 2 + 1 })
  }
  await fetch('/api/claude-code-parity/history/save', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key: ${JSON.stringify(TITLE)}, id: ${JSON.stringify(TITLE)}, title: ${JSON.stringify(TITLE)}, messages, created: now }) })
})()`)
await send('Page.reload')
await new Promise((r) => setTimeout(r, 4000))
await waitFor(() => evaluate(`(async () => {
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

const out = await evaluate(`(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const items = Array.from(document.querySelectorAll('.ccp-root .ccp-item'))
  const mine = items.find((it) => (it.querySelector('.ccp-item-title')?.textContent || '').includes(${JSON.stringify(TITLE)}))
  if (mine) mine.click()
  await sleep(2000)
  const el = document.querySelector('.ccp-root .ccp-stream')
  el.scrollTop = 600
  el.dispatchEvent(new Event('scroll'))
  await sleep(500)
  const btn = document.querySelector('.ccp-tobottom')
  if (!btn) return { noButton: true }
  const cs = getComputedStyle(btn)
  // Which rules actually matched?
  const matched = []
  for (const sheet of Array.from(document.styleSheets)) {
    let rules
    try { rules = sheet.cssRules } catch (e) { continue }
    for (const r of Array.from(rules || [])) {
      if (!r.selectorText) continue
      if (/tobottom|button|border-radius/i.test(r.selectorText) && r.style && r.style.borderRadius) {
        try { if (btn.matches(r.selectorText)) matched.push(r.selectorText + ' { border-radius:' + r.style.borderRadius + (r.style.getPropertyPriority('border-radius') ? ' !important' : '') + ' }') } catch (e) {}
      }
    }
  }
  return {
    cornerShape: cs.cornerShape || '(unsupported)',
    radius: cs.borderRadius, width: cs.width, height: cs.height, bg: cs.backgroundColor,
    border: cs.border, shadow: cs.boxShadow, matched: matched.slice(0, 8),
  }
})()`)
console.log(JSON.stringify(out, null, 2))

await evaluate(`(async () => { await fetch('/api/claude-code-parity/history/purge', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: ${JSON.stringify(TITLE)} }) }) })()`)
ws.close(); chrome.kill(); process.exit(0)
