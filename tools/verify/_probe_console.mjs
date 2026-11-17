// Capture browser console errors + check whether the client bundle mounted.
import { spawn } from 'node:child_process'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

const TOKEN = process.argv[2]
const BASE = 'http://127.0.0.1:39120'
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const RUN = Math.random().toString(36).slice(2, 8)
const PROFILE = path.join(os.tmpdir(), 'ccp-ui-' + RUN)
const PORT = 9300 + Math.floor(Math.random() * 300)

function httpJson(p, method = 'GET') {
  return new Promise((resolve, reject) => {
    const r = http.request({ hostname: '127.0.0.1', port: PORT, path: p, method }, (res) => {
      let b = ''; res.on('data', (c) => { b += c }); res.on('end', () => { try { resolve(JSON.parse(b)) } catch (e) { resolve(b) } })
    })
    r.on('error', reject); r.end()
  })
}
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--window-size=1440,900', 'about:blank'],
  { stdio: 'ignore', windowsHide: true })

async function waitFor(fn, ms, step = 300) {
  const end = Date.now() + ms
  while (Date.now() < end) { try { const v = await fn(); if (v) return v } catch (e) {} ; await new Promise((r) => setTimeout(r, step)) }
  return null
}
await waitFor(() => httpJson('/json/version'), 20000)
const t = await httpJson('/json/new?' + encodeURIComponent('about:blank'), 'PUT')
const ws = new WebSocket(t.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
let seq = 0; const pending = new Map(); const logs = []
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) { const { resolve, reject } = pending.get(m.id); pending.delete(m.id); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); return }
  if (m.method === 'Runtime.consoleAPICalled') logs.push('[console.' + m.params.type + '] ' + (m.params.args || []).map((a) => a.value ?? a.description ?? a.type).join(' '))
  if (m.method === 'Runtime.exceptionThrown') logs.push('[exception] ' + (m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text))
  if (m.method === 'Log.entryAdded') logs.push('[log.' + m.params.entry.level + '] ' + m.params.entry.text)
}
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })) })
const evaluate = async (e) => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) return { __err: r.exceptionDetails.exception?.description || r.exceptionDetails.text }; return r.result.value }

await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable')
await send('Page.navigate', { url: `${BASE}/?token=${encodeURIComponent(TOKEN)}` })
await waitFor(() => evaluate(`document.readyState === 'complete'`), 40000)
await new Promise((r) => setTimeout(r, 8000))

const info = await evaluate(`(async () => {
  const row = Array.from(document.querySelectorAll('button')).find((b) => (b.innerText || '').split(String.fromCharCode(10))[0].trim() === '插件')
  if (row) row.click()
  await new Promise((r) => setTimeout(r, 1500))
  return {
    panelRows: Array.from(document.querySelectorAll('button')).map((b) => (b.innerText || '').split(String.fromCharCode(10))[0].trim()).filter(Boolean).slice(0, 12),
    scripts: Array.from(document.querySelectorAll('script')).map((s) => String(s.src || '').slice(-70)).filter(Boolean).slice(0, 20),
    hasLoader: typeof window.__ModuleLoader__,
  }
})()`)
console.log(JSON.stringify(info, null, 2))
console.log('--- console/log entries ---')
for (const l of logs.slice(0, 40)) console.log(l.slice(0, 300))
ws.close(); chrome.kill(); process.exit(0)
