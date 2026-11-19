// Regression: history saves are ordered by a monotonic revision so a stale
// snapshot finishing last cannot drop the newest user message. Also verifies
// that explicit edits (which carry no revision) are still allowed.
// usage: node _verify_save_guard.mjs <dsh-token>
import http from 'node:http'
const TOKEN = process.argv[2]
const HOST = '127.0.0.1'
const PORT = 39120
const results = []
const check = (name, ok, d) => { results.push(ok); console.log(`${ok?'PASS':'FAIL'}  ${name}${d?'  — '+d:''}`) }

function req(p, method = 'GET', body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : ''
    const r = http.request({ hostname: HOST, port: PORT, path: p, method,
      headers: data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {} },
    (res) => { let b=''; res.on('data',c=>b+=c); res.on('end',()=>{ try{resolve(JSON.parse(b))}catch(e){resolve(b)} }) })
    r.on('error', reject); if (data) r.write(data); r.end()
  })
}
await req(`/?token=${encodeURIComponent(TOKEN)}`)
const key = 'verify-guard-' + Math.random().toString(36).slice(2, 9)
const U = (t) => ({ role: 'user', text: t })

// Newest save (rev 300) and a stale save (rev 100) overlap; stale finishes last.
const save = (rev, title, msgs) => new Promise((resolve) => {
  const data = JSON.stringify({ key, id: key, rev, title, messages: msgs })
  const r = http.request({ hostname: HOST, port: PORT, path: '/api/claude-code-parity/history/save', method: 'POST',
    headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } }, (res) => {
    let b=''; res.on('data',c=>b+=c); res.on('end',()=>resolve(b))
  })
  r.on('error',()=>resolve('')); r.write(data); r.end()
})
const fresh = save(300, 'newest', [U('第一条指令'), U('第二条指令'), U('第三条指令')])
const stale = new Promise((r) => setTimeout(r, 60)).then(() => save(100, 'stale', [U('第一条指令')]))
await Promise.all([fresh, stale])
let d = await req('/api/claude-code-parity/history/session?id=' + encodeURIComponent(key))
const texts = (d?.messages || []).filter(m=>m.role==='user').map(m=>m.text)
check('stale save did not overwrite newer messages', texts.length === 3, JSON.stringify(texts))
check('newest title preserved', d?.session?.title === 'newest', String(d?.session?.title))
check('stored revision is the higher one', Number(d?.session?.save_rev) === 300, String(d?.session?.save_rev))

// An explicit edit (no rev) must still be allowed to remove a message.
await req('/api/claude-code-parity/history/save', 'POST', {
  key, id: key, title: 'edited', messages: [U('第一条指令'), U('第二条指令')],
})
d = await req('/api/claude-code-parity/history/session?id=' + encodeURIComponent(key))
const edited = (d?.messages || []).map(m=>m.text)
check('explicit edit (no rev) still applies', edited.length === 2 && d?.session?.title === 'edited', JSON.stringify(edited)+' title='+d?.session?.title)

// A stale save after the edit must still be rejected.
await save(150, 'stale2', [U('only one')])
d = await req('/api/claude-code-parity/history/session?id=' + encodeURIComponent(key))
check('stale save after edit still rejected', (d?.messages||[]).length === 2 && d?.session?.title === 'edited')

await req('/api/claude-code-parity/history/action', 'POST', { id: key, action: 'delete' })
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`)
process.exit(results.every(Boolean) ? 0 : 1)
