// Regression: a just-sent user message must survive across consecutive turns.
//
// The failure this guards against: each turn wrote history in a fire-and-forget
// task that (a) captured session meta at turn start and (b) had no ordering.
// Rapid sends produced overlapping /history/save calls; a stale one finished
// last and overwrote the file, dropping the newest user message while keeping
// the reply. Symptom: "I sent an instruction, the model started thinking, and
// my instruction disappeared" — the prompt survived only in the job/title.
//
// usage: node _verify_usermsg_persist.mjs <dsh-token> [provider] [model]
import { spawn } from 'node:child_process'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

const TOKEN = process.argv[2]
const BASE = 'http://127.0.0.1:39120'
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const RUN = Math.random().toString(36).slice(2, 8)
const PROFILE = path.join(os.tmpdir(), 'ccp-persist-' + RUN)
const PORT = 9600 + Math.floor(Math.random() * 300)
const PROVIDER = process.argv[3] || 'workbuddy-ai'
const MODEL = process.argv[4] || 'hy4flash'

const results = []
function check(name, ok, detail) {
  results.push(ok)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
}
function httpJson(p, method = 'GET') {
  return new Promise((resolve, reject) => {
    const r = http.request({ hostname: '127.0.0.1', port: PORT, path: p, method }, (res) => {
      let b = ''
      res.on('data', (c) => { b += c })
      res.on('end', () => { try { resolve(JSON.parse(b)) } catch (e) { resolve(b) } })
    }); r.on('error', reject); r.end()
  })
}
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu',
  '--window-size=1280,760', 'about:blank',
], { stdio: 'ignore', windowsHide: true })
async function waitFor(fn, ms, step = 300) {
  const end = Date.now() + ms
  while (Date.now() < end) { try { const v = await fn(); if (v) return v } catch (e) {} await new Promise((r) => setTimeout(r, step)) }
  return null
}
const version = await waitFor(() => httpJson('/json/version'), 20000)
if (!version) { console.log('FAIL no devtools'); chrome.kill(); process.exit(1) }
const target = await httpJson('/json/new?' + encodeURIComponent('about:blank'), 'PUT')
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
let seq = 0
const pending = new Map()
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id); pending.delete(m.id)
    if (m.error) reject(new Error(JSON.stringify(m.error))); else resolve(m.result)
  }
}
function send(method, params = {}) {
  const id = ++seq
  return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })) })
}
async function evaluate(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''))
  return r.result?.value
}

await send('Page.enable'); await send('Runtime.enable')
await send('Page.navigate', { url: `${BASE}/?token=${encodeURIComponent(TOKEN)}` })
await new Promise((r) => setTimeout(r, 3000))
await evaluate(`(async () => {
  await fetch('/api/claude-code-parity/model/select', { method:'POST', headers:{'content-type':'application/json'},
    body: JSON.stringify({provider:${JSON.stringify(PROVIDER)}, model:${JSON.stringify(MODEL)}}) })
  return true
})()`)
const opened = await waitFor(async () => evaluate(`(async () => {
  const sleep=(ms)=>new Promise(r=>setTimeout(r,ms)); const NL=String.fromCharCode(10)
  if (!document.querySelector('.ccp-root')) {
    const btn=Array.from(document.querySelectorAll('button')).find(b=>(b.innerText||'').split(NL)[0].trim()==='插件'); if(btn)btn.click(); await sleep(1500)
    const cards=Array.from(document.querySelectorAll('[class*="cardMain"]')); const mine=cards.find(c=>/claude/i.test(c.innerText||'')); if(mine)mine.click(); await sleep(2000)
    const row=Array.from(document.querySelectorAll('button')).find(b=>(b.innerText||'').split(NL)[0].trim()==='Claude Code Desktop'); if(row)row.click(); await sleep(2000)
  }
  return Boolean(document.querySelector('.ccp-root'))
})()`), 40000)
check('plugin panel opens', Boolean(opened))
if (!opened) { ws.close(); chrome.kill(); process.exit(1) }

async function typeAndSend(text) {
  return await evaluate(`(async () => {
    const sleep=(ms)=>new Promise(r=>setTimeout(r,ms))
    const ta=document.querySelector('.ccp-root textarea'); if(!ta) return {ok:false,why:'no textarea'}
    const setter=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set
    setter.call(ta, ${JSON.stringify('__T__')})
    ta.dispatchEvent(new Event('input',{bubbles:true})); await sleep(200)
    let btn=document.querySelector('.ccp-root .ccp-send')
    for(let i=0;i<30 && (!btn||btn.disabled);i++){ await sleep(200); btn=document.querySelector('.ccp-root .ccp-send') }
    if(!btn||btn.disabled) return {ok:false,why:'btn disabled'}
    const before=document.querySelectorAll('.ccp-root .ccp-msg.user').length
    btn.click(); await sleep(250)
    const after=document.querySelectorAll('.ccp-root .ccp-msg.user').length
    return {ok:true, added:(after-before)}
  })()`.replace('"__T__"', JSON.stringify(text)))
}
async function domUsers() {
  return await evaluate(`(() => { const root=document.querySelector('.ccp-root'); if(!root) return []
    return Array.from(root.querySelectorAll('.ccp-msg.user')).map(m=>(m.innerText||'').replace(/\\s+/g,' ').trim()) })()`)
}
async function waitIdle(ms=120000) {
  // A turn is idle only when loading has been absent continuously for ~800ms.
  const end = Date.now() + ms
  let stableSince = 0
  while (Date.now() < end) {
    const busy = await evaluate(`Boolean(document.querySelector('.ccp-root .ccp-loading'))`)
    if (!busy) { if (!stableSince) stableSince = Date.now(); if (Date.now() - stableSince > 800) return true }
    else stableSince = 0
    await new Promise((r) => setTimeout(r, 200))
  }
  return false
}
async function activeSessionKey() {
  // Read which session is open from the selected sidebar item's title attr / text.
  return await evaluate(`(() => {
    const root=document.querySelector('.ccp-root'); if(!root) return null
    return root.getAttribute('data-session') || (window.__SID||null)
  })()`)
}

const P1 = '第一条指令：请列出劳动争议二审的第一个争点'
const P2 = '第二条指令：请基于前面的分析生成上诉状初稿'

// Turn 1
check('turn 1 sent', (await typeAndSend(P1))?.ok)
await waitIdle()

// Turn 2 immediately after turn 1 finishes (while turn 1 save may still be in flight)
check('turn 2 sent', (await typeAndSend(P2))?.ok)
await waitIdle()

// Let all background saves settle.
await new Promise((r) => setTimeout(r, 4000))

const users = await domUsers()
const joined = users.join('\n')
check('both user messages still in DOM', users.length >= 2, JSON.stringify(users.map((u) => u.slice(0, 24))))
check('message 1 text intact', joined.includes('第一条指令'), '')
check('message 2 text intact', joined.includes('第二条指令'), '')

// Verify persisted history via the plugin API contains every user message.
const hist = await evaluate(`(async () => {
  const r = await fetch('/api/claude-code-parity/history')
  const d = await r.json()
  const list = d.sessions || []
  // newest session whose title mentions our marker, else newest session
  const mine = list.find((s) => /第一条指令|第二条指令/.test(s.title||''))
    || list.slice().sort((a,b)=>(b.updated||0)-(a.updated||0))[0]
  if (!mine) return { noSession: true }
  const one = await (await fetch('/api/claude-code-parity/history/session?id=' + encodeURIComponent(mine.id||mine.key))).json()
  const msgs = one.messages || []
  return { title: mine.title, userTexts: msgs.filter((m)=>m.role==='user').map((m)=>String(m.text||'')) }
})()`)
const saved = (hist?.userTexts || []).join('\n')
check('persisted history found', !hist?.noSession, JSON.stringify(hist?.title))
check('persisted: message 1', saved.includes('第一条指令'), '')
check('persisted: message 2', saved.includes('第二条指令'), '')

console.log(`\n${results.filter(Boolean).length}/${results.length} passed`)
ws.close(); chrome.kill(); process.exit(results.every(Boolean) ? 0 : 1)
