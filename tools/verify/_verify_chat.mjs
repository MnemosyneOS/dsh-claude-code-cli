// Chat regression: two consecutive turns through the real CLI + protocol bridge.
import http from 'node:http'

const BASE = 'http://127.0.0.1:39120'
const TOKEN = process.argv[2]
let COOKIE = ''

function req(method, path, body, timeout = 180000) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body)
    const u = new URL(BASE + path)
    const r = http.request({
      hostname: u.hostname, port: u.port, path: u.pathname + u.search, method,
      headers: {
        ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}),
        ...(COOKIE ? { cookie: COOKIE } : {}),
      },
      timeout,
    }, (res) => {
      let buf = ''
      res.setEncoding('utf-8')
      res.on('data', (c) => { buf += c })
      res.on('end', () => { let j = null; try { j = JSON.parse(buf) } catch (e) {} ; resolve({ status: res.statusCode, headers: res.headers, json: j, body: buf }) })
    })
    r.on('error', reject)
    r.on('timeout', () => r.destroy(new Error('timeout')))
    if (data) r.write(data)
    r.end()
  })
}

const API = '/api/claude-code-parity'
const auth = await req('GET', '/?token=' + encodeURIComponent(TOKEN))
COOKIE = (auth.headers['set-cookie'] || [''])[0].split(';')[0]

// The chat regression must not depend on whatever the user happens to have
// selected: a rate-limited or image-only model would fail for reasons that
// have nothing to do with the plugin. Pin a text model, then restore.
const PIN = { provider: process.argv[3] || 'deepseek-official', model: process.argv[4] || 'deepseek-flash' }
let ORIGINAL = null
{
  const cur = await req('GET', `${API}/models`)
  ORIGINAL = cur.json?.selected || null
  const hit = (cur.json?.models || []).find((m) => m.provider === PIN.provider && m.model === PIN.model)
  if (!hit) {
    console.error(`SKIP  pinned model ${PIN.provider}/${PIN.model} is not in this profile's catalog`)
    process.exit(2)
  }
  const sel = await req('POST', `${API}/model/select`, PIN)
  if (!sel.json?.ok) throw new Error('model select failed: ' + sel.body)
  console.log(`pin  ${PIN.provider}/${PIN.model}  (was ${ORIGINAL?.provider}/${ORIGINAL?.model})`)
}

async function restore() {
  if (!ORIGINAL?.provider || !ORIGINAL?.model) return
  try { await req('POST', `${API}/model/select`, { provider: ORIGINAL.provider, model: ORIGINAL.model }) } catch (e) { /* best effort */ }
  console.log(`restore ${ORIGINAL.provider}/${ORIGINAL.model}`)
}

async function turn(text, resumeId) {
  const start = await req('POST', `${API}/chat`, {
    text, session_key: 'verify-chat', cwd: 'C:\\AI_Workspace',
    ...(resumeId ? { resume_id: resumeId } : {}),
  })
  if (!start.json?.ok) throw new Error('chat start failed: ' + start.body)
  const jobId = start.json.job_id
  let cursor = 0
  let textOut = ''
  let cliSession = resumeId || ''
  for (let i = 0; i < 400; i++) {
    const p = await req('GET', `${API}/poll?job_id=${jobId}&cursor=${cursor}`, undefined, 30000)
    const d = p.json
    cursor = d.cursor
    for (const ev of d.events || []) {
      if (ev.kind === 'init' && ev.session_id) cliSession = ev.session_id
      if (ev.kind === 'blocks') for (const b of ev.blocks || []) if (b.type === 'text') textOut += b.text
      if (ev.kind === 'delta' && ev.text) textOut += ev.text
      if (ev.kind === 'result') { if (ev.session_id) cliSession = ev.session_id; if (!ev.ok) throw new Error('result error: ' + ev.error) }
    }
    if (d.done) {
      if (d.error) throw new Error('job error: ' + d.error)
      break
    }
    await new Promise((r) => setTimeout(r, 400))
  }
  return { text: textOut.trim(), cliSession }
}

// A failing turn must not leave the user's model selection pinned.
let t1, t2, err = null
try {
  t1 = await turn('只回答两个字：好的')
  console.log('turn1:', JSON.stringify(t1.text).slice(0, 120), '| session', String(t1.cliSession).slice(0, 8))
  t2 = await turn('6 乘 7 等于多少？只回答数字。', t1.cliSession)
  console.log('turn2:', JSON.stringify(t2.text).slice(0, 160), '| session', String(t2.cliSession).slice(0, 8))
} catch (e) {
  err = e
} finally {
  await restore()
}

if (err) { console.error('\nFAIL chat regression :: ' + err.message); process.exit(1) }
const ok1 = t1.text.length > 0
// The contract under test is "the second turn resumes the same CLI transcript",
// not "a small local model gets arithmetic right" — 6x7 came back as "4" once,
// and the job record proved the model itself wrote that, so grading the maths
// only produced false alarms.
const ok2 = t2.text.length > 0 && Boolean(t2.cliSession) && t2.cliSession === t1.cliSession
if (!ok2) console.error('turn2 session=' + String(t2.cliSession) + ' turn1 session=' + String(t1.cliSession))
console.log(ok1 && ok2 ? '\nPASS chat regression (2 turns, history replay OK)' : '\nFAIL chat regression')
process.exit(ok1 && ok2 ? 0 : 1)
