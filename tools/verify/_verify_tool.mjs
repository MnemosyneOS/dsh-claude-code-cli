// Tool round-trip regression.
//
// The reported symptom: the model reported that every tool call came back as
// "No result provided", including a bare `echo`. The CLI really did run the
// tools (the job log holds the output), so the loss had to be in the protocol
// bridge: it packed tool results as `{type:'tool-result'}` parts inside a user
// message, while DSH's harness vocabulary only reads text/image out of a user
// message — results belong in their own `role:'tool'` message. DSH then saw
// tool calls with no matching result and synthesised an error result for each.
//
// This test asks the model to run a command and echo its output, so the marker
// can only appear in the reply if the result really reached the model.
//
// usage: node _verify_tool.mjs <dsh-token> [provider] [model]
import http from 'node:http'

const BASE = 'http://127.0.0.1:39120'
const TOKEN = process.argv[2]
const API = '/api/claude-code-parity'
const PROVIDER = process.argv[3] || 'qwen3-8-flash-next-exl3'
const MODEL = process.argv[4] || 'Qwen3.8-Flash-Next-EXL3-4.05bpw'
const MARK = 'ccp-tool-' + Math.random().toString(36).slice(2, 8)
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
      res.on('end', () => { let j = null; try { j = JSON.parse(buf) } catch (e) { /* not json */ } resolve({ status: res.statusCode, headers: res.headers, json: j, body: buf }) })
    })
    r.on('error', reject)
    r.on('timeout', () => r.destroy(new Error('timeout')))
    if (data) r.write(data)
    r.end()
  })
}

const results = []
function check(name, ok, detail) {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
}

const auth = await req('GET', '/?token=' + encodeURIComponent(TOKEN))
COOKIE = (auth.headers['set-cookie'] || [''])[0].split(';')[0]

const cur = await req('GET', `${API}/models`)
const ORIGINAL = cur.json?.selected || null
const hit = (cur.json?.models || []).find((m) => m.provider === PROVIDER && m.model === MODEL)
if (!hit) {
  console.error(`SKIP  pinned model ${PROVIDER}/${MODEL} is not in this profile's catalog`)
  process.exit(2)
}
const sel = await req('POST', `${API}/model/select`, { provider: PROVIDER, model: MODEL })
check('model pinned for the run', Boolean(sel.json?.ok), `HTTP ${sel.status}`)

async function restore() {
  if (!ORIGINAL?.provider || !ORIGINAL?.model) return
  try { await req('POST', `${API}/model/select`, { provider: ORIGINAL.provider, model: ORIGINAL.model }) } catch (e) { /* best effort */ }
  console.log(`restore ${ORIGINAL.provider}/${ORIGINAL.model}`)
}

// The output must be unpredictable: a marker written in the prompt could be
// repeated by the model without ever reading the tool result, which would make
// this test pass on a broken bridge. `$RANDOM` keeps the command quote-free so
// the test measures the pipeline rather than the model's shell quoting.
const mkCmd = (n) => `echo ccp-tool-${n}-$RANDOM`
const CMD_A = mkCmd('a')
const CMD_B = mkCmd('b')
const CMD_C = mkCmd('c')
const prompt = `请用 Bash 工具分别执行下面三条命令（可以并行），然后把三条命令的标准输出按 a、b、c 的顺序各占一行回复给我，不要任何解释：\n${CMD_A}\n${CMD_B}\n${CMD_C}`

async function turn(text, resumeId) {
  const start = await req('POST', `${API}/chat`, {
    text, session_key: 'verify-tool-' + MARK, cwd: 'C:\\AI_Workspace',
    ...(resumeId ? { resume_id: resumeId } : {}),
  })
  if (!start.json?.ok) throw new Error('chat start failed: ' + (start.json?.error || start.status))
  const jobId = start.json.job_id
  let cursor = 0
  let reply = ''
  let done = false
  let jobError = ''
  let cliSession = resumeId || ''
  const toolCalls = []
  const toolResults = []
  for (let i = 0; i < 600 && !done; i++) {
    const p = await req('GET', `${API}/poll?job_id=${jobId}&cursor=${cursor}`, undefined, 30000)
    const d = p.json || {}
    cursor = d.cursor || cursor
    for (const ev of d.events || []) {
      if (ev.kind === 'init' && ev.session_id) cliSession = ev.session_id
      if (ev.kind === 'blocks') for (const b of ev.blocks || []) if (b.type === 'text') reply += b.text
      if (ev.kind === 'delta' && ev.text) reply += ev.text
      if (ev.kind === 'tool') toolCalls.push(ev)
      if (ev.kind === 'tool_result') toolResults.push(ev)
      if (ev.kind === 'result' && ev.session_id) cliSession = ev.session_id
    }
    if (d.error) jobError = String(d.error)
    if (d.done) done = true
    if (!done) await new Promise((r) => setTimeout(r, 400))
  }
  return { done, jobError, reply: reply.trim(), toolCalls, toolResults, cliSession }
}

/* ---- turn 1: three tool calls in one request ---- */
const t1 = await turn(prompt, null)
check('the multi-tool turn finished', t1.done, t1.jobError || '')
check('every command was executed', t1.toolCalls.length >= 3, 'calls=' + t1.toolCalls.length)

const outOf = (r, tag) => {
  const m = String(r.text || '').match(new RegExp('ccp-tool-' + tag + '-\\d+'))
  return m ? m[0] : ''
}
const gotA = t1.toolResults.map((r) => outOf(r, 'a')).filter(Boolean)[0] || ''
const gotB = t1.toolResults.map((r) => outOf(r, 'b')).filter(Boolean)[0] || ''
const gotC = t1.toolResults.map((r) => outOf(r, 'c')).filter(Boolean)[0] || ''
check('the CLI returned all three outputs', Boolean(gotA && gotB && gotC), [gotA, gotB, gotC].join(' | '))
check('no output is guessable from the prompt',
  ![gotA, gotB, gotC].some((x) => prompt.includes(x)), 'ok')
check('the model quoted all three real outputs',
  Boolean(gotA && gotB && gotC) && [gotA, gotB, gotC].every((x) => t1.reply.includes(x)),
  JSON.stringify(t1.reply.slice(0, 200)))
check('no tool result was reported missing', !/No result provided/i.test(t1.reply),
  JSON.stringify((t1.reply.match(/.{0,30}No result provided.{0,20}/i) || [''])[0]))
// The contract under test is "the model sees what the tool returned", not "the
// model writes good shell". A model may also run its own probe commands, whose
// output it is under no obligation to quote — so only a *failed* call must show
// up in the reply, and no call may come back empty.
const emptyResults = t1.toolResults.filter((r) => !String(r.text || '').trim())
check('no tool call came back empty', emptyResults.length === 0,
  emptyResults.length + ' empty of ' + t1.toolResults.length)
const errored = t1.toolResults.filter((r) => r.isError)
if (errored.length) {
  const sample = String(errored[0].text || '').split(/\r?\n/)[0].slice(0, 40)
  check('a failed tool call still reached the model', t1.reply.includes(sample),
    'expected ' + JSON.stringify(sample) + ' in reply')
} else {
  check('a failed tool call still reached the model', true, 'all calls succeeded')
}

/* ---- turn 2: same session, so the whole tool history is replayed ---- */
const cmdD = mkCmd('d')
const t2 = await turn(`再用 Bash 执行这条命令，只回复输出：\n${cmdD}`, t1.cliSession)
check('the follow-up turn finished', t2.done, t2.jobError || '')
const gotD = t2.toolResults.map((r) => outOf(r, 'd')).filter(Boolean)[0] || ''
check('the follow-up turn ran its tool', Boolean(gotD), gotD || 'no d output')
check('the model quoted the new output after a history replay',
  Boolean(gotD) && t2.reply.includes(gotD), JSON.stringify(t2.reply.slice(0, 160)))
check('the replay did not corrupt earlier results', !/No result provided/i.test(t2.reply),
  JSON.stringify((t2.reply.match(/.{0,30}No result provided.{0,20}/i) || [''])[0]))

await restore()

const failed = results.filter((r) => !r.ok)
console.log('\nturn 1: ' + JSON.stringify(t1.reply.slice(0, 200)))
console.log('turn 2: ' + JSON.stringify(t2.reply.slice(0, 200)))
console.log('\n' + (failed.length ? `FAIL ${failed.length}/${results.length}` : `PASS all ${results.length}`))
process.exit(failed.length ? 1 : 0)
