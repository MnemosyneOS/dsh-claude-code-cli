// Measure the real left edge of every transcript element in headless Chrome.
//
// The panel used to hang its blocks off different paddings (loading 26px,
// user bubble 16px, composer 18px vs transcript 26px), so their text never
// shared a left edge. This drives the actual CSS from client.js against a DOM
// shaped like renderGroup()'s output and asserts one content baseline and one
// line rhythm. No plugin instance or token needed.
import { spawn } from 'node:child_process'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  path.join(os.homedir(), 'AppData/Local/ms-playwright/chromium-1129/chrome-win/chrome.exe'),
].find((p) => fs.existsSync(p))
if (!CHROME) { console.error('no Chrome/Edge found'); process.exit(2) }

// Pull the CSS template literal straight out of the client source.
const src = fs.readFileSync(path.join(ROOT, 'lib/client.js'), 'utf8')
const start = src.indexOf('const CSS = `')
if (start < 0) { console.error('CSS block not found'); process.exit(2) }
const end = src.indexOf('\n`', start)
const css = src.slice(start + 'const CSS = `'.length, end)
  // The template interpolates theme colours; give them concrete values.
  .replace(/\$\{C\.[a-zA-Z]+\}/g, '#888888')

const html = `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;padding:0}
.ccp-root{height:auto!important}
${css}
</style>
<div class="ccp-root"><div class="ccp-main"><div class="ccp-streamwrap">
  <div class="ccp-stream"><div class="ccp-wrap" id="wrap">
    <div class="ccp-msg user" id="m-user"><div class="ccp-msg-body" id="user-body">
      <div class="ccp-text" id="user-text"><div>请根据我上传的一审判决书和全部证据材料</div></div>
    </div></div>
    <div class="ccp-msg" id="m-assistant"><div class="ccp-msg-body">
      <div class="ccp-work ccp-work-think" id="work">
        <div class="ccp-work-row" id="work-row">
          <span class="ccp-work-ico" id="work-ico">◇</span>
          <span class="ccp-work-label" id="work-label">思考过程</span>
        </div>
        <pre class="ccp-work-detail" id="work-detail">让我思考一下：本案的核心争点是赔偿金基数。</pre>
      </div>
      <div class="ccp-text" id="asst-text"><div>我先核对判决书里的关键认定逻辑。</div></div>
      <div class="ccp-foot ccp-respfoot" id="foot"><span>输入: 12.3k t/s</span></div>
    </div></div>
    <div class="ccp-loading" id="loading">正在加载 …</div>
  </div></div>
</div>
<div class="ccp-compose"><div class="ccp-compose-in" id="compose-in">
  <div class="ccp-box" id="box"><textarea class="ccp-ta" id="ta">描述任务</textarea></div>
</div></div>
</div></div>`

const RUN = Math.random().toString(36).slice(2, 8)
const PROFILE = path.join(os.tmpdir(), 'ccp-align-' + RUN)
const PORT = 9600 + Math.floor(Math.random() * 300)
const PAGE = path.join(os.tmpdir(), 'ccp-align-' + RUN + '.html')
fs.writeFileSync(PAGE, html, 'utf8')

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars',
  '--window-size=1400,900', 'file:///' + PAGE.replace(/\\/g, '/'),
], { stdio: 'ignore' })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function httpJson(pathname) {
  return new Promise((resolve, reject) => {
    const r = http.request({ hostname: '127.0.0.1', port: PORT, path: pathname }, (res) => {
      let b = ''
      res.on('data', (c) => { b += c })
      res.on('end', () => { try { resolve(JSON.parse(b)) } catch (e) { resolve(b) } })
    })
    r.on('error', reject)
    r.end()
  })
}

async function evaluate(wsUrl, expression) {
  // Node 22+ ships a global WebSocket, which is all the CDP client needs.
  const ws = new WebSocket(wsUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  let id = 0
  const call = (method, params) => new Promise((res, rej) => {
    const myId = ++id
    const onMsg = (ev) => {
      const m = JSON.parse(ev.data)
      if (m.id === myId) {
        ws.removeEventListener('message', onMsg)
        m.error ? rej(new Error(m.error.message)) : res(m.result)
      }
    }
    ws.addEventListener('message', onMsg)
    ws.send(JSON.stringify({ id: myId, method, params }))
  })
  await call('Runtime.enable', {})
  const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  ws.close()
  return r.result && r.result.value
}

let pass = 0
const check = (name, ok, detail) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  — ' + detail : ''))
  if (ok) pass++
}

try {
  // Wait for the debugger endpoint.
  let target = null
  for (let i = 0; i < 60; i++) {
    try {
      const list = await httpJson('/json/list')
      target = (list || []).find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
      if (target) break
    } catch (e) { /* not up yet */ }
    await sleep(250)
  }
  if (!target) throw new Error('no CDP page target')

  const m = await evaluate(target.webSocketDebuggerUrl, `(() => {
    const px = (el) => el ? el.getBoundingClientRect().left : null
    const lh = (el) => el ? parseFloat(getComputedStyle(el).lineHeight) : null
    const fs2 = (el) => el ? parseFloat(getComputedStyle(el).fontSize) : null
    const textLeft = (el) => {
      if (!el) return null
      // First text-bearing descendant, so the measurement is the glyph edge.
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
      const n = walker.nextNode()
      if (!n) return el.getBoundingClientRect().left
      const r = document.createRange(); r.selectNodeContents(n)
      return r.getBoundingClientRect().left
    }
    const q = (id) => document.getElementById(id)
    return {
      userText: textLeft(q('user-text')),
      userBubble: px(q('user-body')),
      asstText: textLeft(q('asst-text')),
      thinkLabel: textLeft(q('work-label')),
      thinkIcon: px(q('work-ico')),
      loading: textLeft(q('loading')),
      compose: px(q('box')),
      ta: px(q('ta')),
      thinkDetail: textLeft(q('work-detail')),
      // line rhythm — compare the ratio, since the blocks use different sizes
      lhAsst: lh(q('asst-text')),
      lhThinkDetail: lh(q('work-detail')),
      lhLoading: lh(q('loading')),
      lhWorkRow: lh(q('work-row')),
      fsAsst: fs2(q('asst-text')),
      fsThinkDetail: fs2(q('work-detail')),
      fsLoading: fs2(q('loading')),
      fsWorkRow: fs2(q('work-row')),
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
    }
  })()`)

  const base = m.asstText
  const near = (a, b, tol = 0.6) => a != null && b != null && Math.abs(a - b) <= tol

  check('assistant text defines the baseline', Number.isFinite(base), 'x=' + base.toFixed(1))
  check('user bubble text on the same left edge', near(m.userText, base), 'x=' + (m.userText ?? NaN).toFixed(1))
  check('thinking row starts on the same left edge', near(m.thinkIcon, base), 'icon x=' + (m.thinkIcon ?? NaN).toFixed(1))
  check('thinking label sits just right of its icon', m.thinkLabel != null && m.thinkLabel > m.thinkIcon, 'label=' + m.thinkLabel.toFixed(1) + ' icon=' + m.thinkIcon.toFixed(1))
  check('loading line on the same left edge', near(m.loading, base), 'x=' + (m.loading ?? NaN).toFixed(1))
  check('composer box on the same left edge', near(m.compose, base), 'x=' + (m.compose ?? NaN).toFixed(1))
  check('composer textarea inside the box', m.ta != null && m.ta > m.compose, 'box=' + m.compose + ' ta=' + m.ta)
  check('user bubble grows outward (background left of text)', m.userBubble < m.userText - 4, 'bubble=' + m.userBubble.toFixed(1))

  check('thinking detail nests one level under its header', m.thinkDetail > m.thinkLabel + 4, 'detail=' + (m.thinkDetail ?? NaN).toFixed(1) + ' label=' + m.thinkLabel)
  // The blocks differ in font size, so the shared property is the line-height
  // ratio: every block reads at the same rhythm (1.55), never a tighter one.
  const ratio = (lh, fs) => (fs ? lh / fs : null)
  const rAsst = ratio(m.lhAsst, m.fsAsst)
  const rThink = ratio(m.lhThinkDetail, m.fsThinkDetail)
  const rLoading = ratio(m.lhLoading, m.fsLoading)
  const rRow = ratio(m.lhWorkRow, m.fsWorkRow)
  check('thinking detail line rhythm matches the reply', near(rThink, rAsst, 0.03), 'think=' + rThink?.toFixed(3) + ' asst=' + rAsst?.toFixed(3))
  check('loading line rhythm matches the reply', near(rLoading, rAsst, 0.03), 'loading=' + rLoading?.toFixed(3) + ' asst=' + rAsst?.toFixed(3))
  check('thinking header line rhythm matches the reply', near(rRow, rAsst, 0.03), 'row=' + rRow?.toFixed(3) + ' asst=' + rAsst?.toFixed(3))
  check('no horizontal overflow', m.scrollW <= m.clientW + 1, 'scroll=' + m.scrollW + ' client=' + m.clientW)

  const total = 13
  console.log('\n' + pass + '/' + total + ' passed')
  process.exitCode = pass === total ? 0 : 1
} catch (e) {
  console.error('ERROR', e && e.message || e)
  process.exitCode = 1
} finally {
  try { chrome.kill() } catch (e) {}
  try { fs.rmSync(PROFILE, { recursive: true, force: true }) } catch (e) {}
  try { fs.rmSync(PAGE, { force: true }) } catch (e) {}
}
