// Real-UI verification through CDP: opens the plugin panel in headless Chrome
// and asserts the settings page, the upgrade block and the mobile tab.
import { spawn } from 'node:child_process'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const TOKEN = process.argv[2]
const BASE = 'http://127.0.0.1:39120'
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const RUN = Math.random().toString(36).slice(2, 8)
const PROFILE = path.join(os.tmpdir(), 'ccp-ui-' + RUN)
const PORT = 9300 + Math.floor(Math.random() * 300)

const results = []
function check(name, ok, detail) {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
}

function httpJson(pathname, method = 'GET') {
  return new Promise((resolve, reject) => {
    const r = http.request({ hostname: '127.0.0.1', port: PORT, path: pathname, method }, (res) => {
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
const wsUrl = target.webSocketDebuggerUrl
const ws = new WebSocket(wsUrl)
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

async function evaluate(expression) {
  const r = await send('Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise: true,
  })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''))
  return r.result.value
}

await send('Page.enable')
await send('Runtime.enable')

// 1) load the authenticated UI
const tokenUrl = `${BASE}/?token=${encodeURIComponent(TOKEN)}`
await send('Page.navigate', { url: tokenUrl })
const booted = await waitFor(async () => evaluate(`document.readyState === 'complete' && document.body.innerText.length > 0`), 40000)
check('DSH UI boots over the authenticated URL', Boolean(booted))

// 2) open the plugin panel from its sidebar row
const cardTitle = await waitFor(async () => evaluate(`(() => {
  const row = Array.from(document.querySelectorAll('button'))
    .find((b) => (b.innerText || '').split(String.fromCharCode(10))[0].trim() === 'Claude Code Desktop')
  if (!row) return ''
  row.click()
  return 'Claude Code Desktop'
})()`), 25000)
check('sidebar exposes the Claude Code Desktop entry', Boolean(cardTitle), cardTitle || 'not listed')

const panelUp = await waitFor(async () => evaluate(`Boolean(document.querySelector('.ccp-root'))`), 25000)
check('plugin panel mounts', Boolean(panelUp))

// 3) open settings
await waitFor(async () => evaluate(`(() => {
  const gear = Array.from(document.querySelectorAll('button[title]'))
    .find((x) => /设置|Settings/.test(x.getAttribute('title') || ''))
  if (!gear) return false
  gear.click()
  return true
})()`), 15000)

const tabs = await waitFor(async () => {
  const t = await evaluate(`Array.from(document.querySelectorAll('.ccp-tab')).map((x) => x.textContent.trim())`)
  return Array.isArray(t) && t.length ? t : null
}, 15000)
check('settings tabs include 手机访问', Boolean(tabs && tabs.some((x) => /手机访问|Mobile/.test(x))),
  (tabs || []).join(' / '))

// 4) advanced tab: real version numbers from the registry check
await evaluate(`(() => {
  const t = Array.from(document.querySelectorAll('.ccp-tab')).find((x) => /高级|Advanced/.test(x.textContent))
  if (t) t.click()
})()`)
await new Promise((r) => setTimeout(r, 600))
await evaluate(`(() => {
  const b = Array.from(document.querySelectorAll('.ccp-btn')).find((x) => /检查更新|Check update/.test(x.textContent))
  if (b) b.click()
})()`)
const upText = await waitFor(async () => {
  const t = await evaluate(`(() => {
    const box = Array.from(document.querySelectorAll('.ccp-field')).find((x) => /升级 Claude CLI|Upgrade Claude CLI/.test(x.textContent))
    return box ? box.innerText.replace(/\\s+/g, ' ').trim() : ''
  })()`)
  return t && /2\.\d+\.\d+/.test(t) ? t : null
}, 25000)
check('advanced tab shows real current/latest versions', Boolean(upText), (upText || '').slice(0, 160))

// 5) mobile tab: interface list + start button
await evaluate(`(() => {
  const t = Array.from(document.querySelectorAll('.ccp-tab')).find((x) => /手机访问|Mobile/.test(x.textContent))
  if (t) t.click()
})()`)
await new Promise((r) => setTimeout(r, 800))
const mobileUi = await evaluate(`(() => {
  const sel = document.querySelector('.ccp-select')
  const opts = sel ? Array.from(sel.options).map((o) => o.value) : []
  const btns = Array.from(document.querySelectorAll('.ccp-btn')).map((b) => b.textContent.trim())
  return { opts, btns }
})()`)
check('mobile tab lists a LAN interface and a start button',
  Boolean(mobileUi && mobileUi.opts.some((v) => /^\d+\.\d+\.\d+\.\d+$/.test(v))
    && mobileUi.btns.some((b) => /启动手机访问|Start mobile access/.test(b))),
  JSON.stringify(mobileUi).slice(0, 180))

// 6) start it from the UI and confirm the link renders
await evaluate(`(() => {
  const b = Array.from(document.querySelectorAll('.ccp-btn')).find((x) => /启动手机访问|Start mobile access/.test(x.textContent))
  if (b) b.click()
})()`)
const link = await waitFor(async () => {
  const t = await evaluate(`(() => {
    const code = Array.from(document.querySelectorAll('code')).map((c) => c.textContent).filter(Boolean)
    return code.find((c) => /^http:\\/\\/\\d+\\.\\d+\\.\\d+\\.\\d+:\\d+$/.test(c)) || ''
  })()`)
  return t || null
}, 120000, 1500)
check('UI shows a usable short LAN address after start', Boolean(link), link || 'not rendered')

// stop it again so nothing is left running
await evaluate(`(() => {
  const b = Array.from(document.querySelectorAll('.ccp-btn')).find((x) => /停止手机访问|Stop mobile access/.test(x.textContent))
  if (b) b.click()
})()`)
await new Promise((r) => setTimeout(r, 2500))

// 7) every tab renders human labels (no raw keys like show_thinking)
const tabLabels = {}
for (const name of ['常规', '外观', '工具与权限', '模型', '会话', '高级']) {
  await evaluate(`(() => {
    const t = Array.from(document.querySelectorAll('.ccp-tab')).find((x) => x.textContent.trim() === ${JSON.stringify(name)})
    if (t) t.click()
  })()`)
  await new Promise((r) => setTimeout(r, 400))
  const labels = await evaluate(`Array.from(document.querySelectorAll('.ccp-label')).map((x) => x.textContent.trim())`)
  tabLabels[name] = labels || []
}
const allLabels = Object.values(tabLabels).flat()
const rawKeys = allLabels.filter((x) => /^[a-z0-9_]+$/.test(x))
check('all settings labels are human readable (no raw keys)', rawKeys.length === 0,
  rawKeys.slice(0, 8).join(', ') || `${allLabels.length} labels OK`)
check('appearance tab exposes thinking/tool switches',
  (tabLabels['外观'] || []).some((x) => /思考链/.test(x)) && (tabLabels['外观'] || []).some((x) => /工具输出/.test(x)),
  (tabLabels['外观'] || []).join(' / '))

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
if (failed.length) { console.log('FAILURES:'); for (const f of failed) console.log(' -', f.name, '::', f.detail) }
ws.close()
chrome.kill()
process.exit(failed.length ? 1 : 0)
