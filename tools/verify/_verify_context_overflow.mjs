// Regression for the 2.5.7 context-overflow fix:
//  1. Claude CLI is launched with --autocompact when supported.
//  2. The protocol bridge trims replayed history to a hard budget before the
//     model sees it, using a CJK-aware token estimate.
//  3. Raw exceed_context_size_error JSON is translated into an actionable
//     Chinese hint instead of being dumped into the chat panel.
// usage: node _verify_context_overflow.mjs [launchToken]
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import { withAutoCompact } from '../../lib/index.js'
import { trimMessagesToBudget, friendlyProviderFailure } from '../../lib/bridge.js'

const TOKEN = process.argv[2] || ''
const HOST = '127.0.0.1'
const PORT = 39120
const results = []
const check = (name, ok, detail) => {
  results.push(Boolean(ok))
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
}

/* ---------------------------------------------------------- argv guard */
const baseArgv = ['claude.exe', '-p', 'hello']
check('default adds --autocompact 100000',
  withAutoCompact(baseArgv, {}, true).join(' ').includes('--autocompact 100000'),
  withAutoCompact(baseArgv, {}, true).slice(-2).join(' '))
check('configured threshold is honoured',
  withAutoCompact(baseArgv, { autocompact_tokens: 120000 }, true).slice(-1)[0] === '120000',
  withAutoCompact(baseArgv, { autocompact_tokens: 120000 }, true).slice(-2).join(' '))
check('unsupported CLI is left alone',
  withAutoCompact(baseArgv, {}, false).join(' ') === baseArgv.join(' '))
check('extra_flags already carrying the flag is not duplicated',
  withAutoCompact(baseArgv, { extra_flags: '--autocompact 150000' }, true).filter((x) => x === '--autocompact').length === 0)

/* ------------------------------------------------------- bridge trimming */
const longText = '劳动争议二审分析：'.repeat(600)
const messages = Array.from({ length: 120 }, (_, i) => ({
  role: i % 2 ? 'assistant' : 'user',
  content: [{ type: 'text', text: longText + '#' + i }],
}))
const trimmed = trimMessagesToBudget(messages, 100000, 'system', [])
check('CJK-heavy history is actually trimmed', trimmed.dropped > 0, `dropped ${trimmed.dropped} of ${messages.length}`)
check('newest message is always kept',
  trimmed.messages.at(-1).content[0].text.endsWith('#' + (messages.length - 1)))
check('trimmed estimate respects the hard budget',
  trimmed.inputTokens <= 100000, String(trimmed.inputTokens))
const tiny = trimMessagesToBudget(messages.slice(-1), 100000, 'system', [])
check('short history is untouched', tiny.dropped === 0 && tiny.messages.length === 1)
const hugeLast = trimMessagesToBudget([{ role: 'user', content: [{ type: 'text', text: longText }] }], 10, 'sys', [])
check('a single oversized message is still delivered', hugeLast.messages.length === 1)

/* -------------------------------------------------------- error translation */
const raw = '400: {"code":400,"message":"request (131770 tokens) exceeds the available context size (131072 tokens), try increasing it","type":"exceed_context_size_error"}'
const friendly = friendlyProviderFailure(raw)
check('raw overflow JSON is translated', !friendly.includes('exceed_context_size_error'), friendly.slice(0, 40) + '...')
check('translated hint names the real numbers', friendly.includes('131,770') && friendly.includes('131,072'))
check('translated hint points to compaction setting', friendly.includes('自动压缩阈值'))
check('non-context errors pass through', friendlyProviderFailure('provider timeout') === 'provider timeout')
check('empty failures stay empty', friendlyProviderFailure('') === '')

/* ------------------------------------- live argv check (optional, needs DSH) */
if (TOKEN) {
  const req = (p, method = 'GET', body) => new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : ''
    const r = http.request({ hostname: HOST, port: PORT, path: p, method,
      headers: data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {} },
    (res) => { let b = ''; res.on('data', (c) => { b += c }); res.on('end', () => { try { resolve(JSON.parse(b)) } catch (e) { resolve(b) } }) })
    r.on('error', reject); if (data) r.write(data); r.end()
  })
  await req('/?token=' + encodeURIComponent(TOKEN))
  const started = await req('/api/claude-code-parity/chat', 'POST', {
    text: 'ping',
    provider: 'qwen3-8-flash-next-exl3',
    model: 'Qwen3.8-Flash-Next-EXL3-4.05bpw',
    resume_id: '00000000-0000-4000-8000-000000000000',
    session_key: 'verify-context-argv',
  })
  check('live chat job started', Boolean(started?.job_id), String(started?.job_id))
  const jobPath = path.join(os.homedir(), '.dsh', 'ccp-data', 'jobs', `${started.job_id}.json`)
  let argv = []
  for (let i = 0; i < 60; i++) {
    try { argv = JSON.parse(fs.readFileSync(jobPath, 'utf8')).argv || [] } catch (e) { /* not written yet */ }
    if (argv.length) break
    await new Promise((r) => setTimeout(r, 100))
  }
  check('live CLI argv carries --autocompact', argv.includes('--autocompact'), argv.slice(-4).join(' '))
}

console.log(`\n${results.filter(Boolean).length}/${results.length} passed`)
process.exit(results.every(Boolean) ? 0 : 1)
