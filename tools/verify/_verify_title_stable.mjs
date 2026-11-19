// Session names are topics, not the newest user prompt.
//
// The old build called /title after EVERY turn and wrote the result over the
// existing session name, so the left column changed constantly. Now a title is
// generated only once, manual renames are locked, and the payload asks for a
// noun-phrase topic instead of a copy of the prompt.
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = fs.readFileSync(path.join(HERE, '..', '..', 'lib', 'client.js'), 'utf8')
const BASE = 'http://127.0.0.1:39120'
const API = '/api/claude-code-parity'
const TOKEN = process.argv[2]
if (!TOKEN) { console.error('usage: node _verify_title_stable.mjs <launchToken>'); process.exit(2) }

let COOKIE = ''
const results = []
function check(name, ok, detail) {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
}
function req(method, p, body, timeout = 60000) {
  return new Promise((resolve) => {
    const data = body === undefined ? null : JSON.stringify(body)
    const u = new URL(BASE + p)
    const r = http.request({
      hostname: u.hostname, port: u.port, path: u.pathname + u.search, method,
      headers: {
        ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}),
        ...(COOKIE ? { cookie: COOKIE } : {}),
      }, timeout,
    }, (res) => {
      const cs = []
      res.on('data', (c) => cs.push(c))
      res.on('end', () => {
        const text = Buffer.concat(cs).toString('utf8')
        let json = null
        try { json = JSON.parse(text) } catch (e) { /* not json */ }
        resolve({ status: res.statusCode, headers: res.headers, json, text })
      })
    })
    r.on('error', (e) => resolve({ status: 0, error: e.message }))
    r.on('timeout', () => { r.destroy(new Error('timeout')); resolve({ status: 0, error: 'timeout' }) })
    if (data) r.write(data)
    r.end()
  })
}

const auth = await req('GET', '/?token=' + encodeURIComponent(TOKEN))
COOKIE = (auth.headers['set-cookie'] || [''])[0].split(';')[0]
check('auth cookie minted', Boolean(COOKIE))

/* ---- 1. the generated name is a short topic, not a copy of the prompt --- */
const LEGAL = '请根据我上传的一审判决书和全部证据材料，独立完成一份劳动争议二审上诉状。' +
  '重点围绕加班费计算基数、未休年休假工资、违法解除赔偿、试用期延长以及录音证据合法性逐项分析，' +
  '并结合劳动合同法第四十七条、第八十七条和住房公积金管理条例给出论证。'
const titled = await req('POST', `${API}/title`, { text: LEGAL })
const name = String(titled.json?.title || '')
check('/title returns a name', titled.status === 200 && name.length >= 2, JSON.stringify(titled.json))
check('the name is a compact topic (<= 20 chars)', name.length <= 20, `${name.length}: ${name}`)
check('the name is not a verbatim prompt slice', !LEGAL.slice(0, name.length).startsWith(name), name)

/* ---- 2. a manual rename is locked and survives later saves -------------- */
const KEY = 'verify-title-' + Math.random().toString(36).slice(2, 8)
const first = await req('POST', `${API}/history/save`, {
  key: KEY, id: KEY, title: '劳动争议二审分析', title_locked: true, messages: [],
})
check('a session can carry a locked topic', first.status === 200 && first.json?.session?.title_locked === true,
  JSON.stringify(first.json?.session?.title))
const renamed = await req('POST', `${API}/history/rename`, { id: KEY, title: '我的自定义名称' })
check('rename locks the new title', renamed.status === 200 && renamed.json?.session?.title_locked === true,
  JSON.stringify(renamed.json?.session?.title))
const again = await req('POST', `${API}/history/save`, {
  key: KEY, id: KEY, title: '这一轮的最新提示词', title_locked: false,
})
check('a later save keeps the locked name', again.status === 200 && again.json?.session?.title === '我的自定义名称',
  JSON.stringify(again.json?.session?.title))

/* ---- 3. client only auto-titles an unnamed session ---------------------- */
check('auto-title is gated on a missing title', /if\s*\(!existingTitle[^)]*\)\s*\{[\s\S]{0,400}\/title/.test(SRC))
check('the generated title is a topic, not per-turn text', /body:\s*\{\s*text:\s*seed\s*\}/.test(SRC))

await req('POST', `${API}/history/purge`, { id: KEY })
const failed = results.filter((r) => !r.ok)
console.log('\n' + (failed.length ? `FAIL ${failed.length}/${results.length}` : `PASS all ${results.length}`))
process.exit(failed.length ? 1 : 0)
