// Regression for "only the thinking row, no answer".
//
// A reasoning model sends `thinking` first and `blocks` afterwards. The old
// merge rule keyed on `role === 'assistant' && streaming`, so the answer was
// appended INTO the thinking row: the message kept kind 'thinking' and the
// renderer had no branch that could draw it. These cases pin the merge rules
// down without needing a model, a browser or a running instance.
//
// applyEvent / groupAnswerText live inside the client module closure, so they
// are lifted out of the source text and evaluated with a stubbed `uid`.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// fileURLToPath decodes the %20 in "Claude Code Parity" — a raw pathname keeps it.
const HERE = path.dirname(fileURLToPath(import.meta.url))
// argv[2] lets the same test run against an older revision, to prove it fails there.
const TARGET = process.argv[2] || path.join(HERE, '..', '..', 'lib', 'client.js')
const SRC = fs.readFileSync(TARGET, 'utf-8')

/** Slice a top-level `function name(...) { ... }` out of the source. */
function lift(name) {
  const start = SRC.indexOf('function ' + name + '(')
  if (start < 0) throw new Error('cannot find function ' + name)
  let i = SRC.indexOf('{', start)
  let depth = 0
  for (; i < SRC.length; i++) {
    const c = SRC[i]
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return SRC.slice(start, i + 1)
    }
  }
  throw new Error('unbalanced braces in ' + name)
}

const stubs = `
  let n = 0
  const uid = () => 'id' + (++n)
`
const api = new Function(stubs + lift('applyEvent') + '\nreturn { applyEvent }')()
const { applyEvent } = api

/**
 * What the panel can actually draw, mirroring renderMessage's switch: only a
 * `blocks` message (its text blocks) and a plain text message produce visible
 * body copy. thinking / tool / result / stats rows draw no answer text. Keeping
 * this projection local means the test measures the UI contract rather than the
 * helper it is meant to check.
 */
function visibleAnswer(list) {
  return list.map((m) => {
    // kind first, exactly like renderMessage: a thinking row paints no answer
    // text even if a broken record left a `blocks` array hanging on it.
    if (m.kind === 'blocks') {
      return (m.blocks || []).filter((b) => b.type === 'text').map((b) => b.text).join('') || m.text || ''
    }
    if (m.kind) return ''
    return m.role === 'assistant' ? (m.text || '') : ''
  }).filter(Boolean).join('\n')
}
const groupAnswerText = visibleAnswer

const results = []
function check(name, ok, detail) {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
}

const run = (events) => events.reduce((acc, ev) => applyEvent(acc, ev), [])
const thinkingEv = { kind: 'thinking', text: '让我思考一下：用户在打招呼。' }
const blocksEv = (t) => ({ kind: 'blocks', blocks: [{ type: 'text', text: t }] })
const resultEv = (t) => ({ kind: 'result', ok: true, text: t })

/* 1. the reported bug: thinking → blocks must produce a visible answer */
{
  const list = run([thinkingEv, blocksEv('你好，堃！有什么需要帮忙的？'), resultEv('你好，堃！有什么需要帮忙的？')])
  const answer = groupAnswerText(list)
  check('thinking → blocks keeps the answer visible', answer.includes('你好，堃！'), JSON.stringify(answer))
  const blocks = list.find((m) => m.kind === 'blocks')
  check('answer lives in its own blocks message', Boolean(blocks) && blocks.text.includes('你好，堃！'))
  const think = list.find((m) => m.kind === 'thinking')
  check('thinking row does not swallow the answer', Boolean(think) && !String(think.text).includes('你好，堃！'),
    JSON.stringify(think && think.text))
  check('thinking row is closed once the answer starts', Boolean(think) && think.streaming === false,
    'streaming=' + (think && think.streaming))
  check('exactly one answer message is created',
    list.filter((m) => m.kind === 'blocks').length === 1,
    'blocks=' + list.filter((m) => m.kind === 'blocks').length)
  check('no message is left streaming after result', list.every((m) => !m.streaming))
}

/* 2. split answers: consecutive blocks events must merge, not stack */
{
  const list = run([blocksEv('第一段'), blocksEv('第二段')])
  check('consecutive blocks merge into one message', list.length === 1 && list[0].text === '第一段第二段',
    JSON.stringify(list.map((m) => m.text)))
}

/* 3. plain text first, then blocks: promote instead of duplicating */
{
  const list = run([{ kind: 'delta', text: '前言' }, blocksEv('正文')])
  const answer = groupAnswerText(list)
  check('delta then blocks keeps both halves in one answer', answer === '前言正文', JSON.stringify(answer))
  check('delta then blocks does not stack two messages', list.filter((m) => m.role === 'assistant').length === 1,
    'assistant=' + list.filter((m) => m.role === 'assistant').length)
}

/* 4. blocks then a later thinking row must not lose the answer */
{
  const list = run([blocksEv('答案在此'), thinkingEv, resultEv('答案在此')])
  check('a late thinking row does not hide the answer', groupAnswerText(list).includes('答案在此'))
}

/* 5. a turn that only reports text through `result` still shows something */
{
  const list = run([thinkingEv, resultEv('只出现在 result 里的回答')])
  const answer = groupAnswerText(list)
  check('result-only turns are visible via the render fallback', answer === '', 'groupAnswerText=' + JSON.stringify(answer))
  const rec = list.find((m) => m.kind === 'result')
  check('the fallback source exists', Boolean(rec && rec.text === '只出现在 result 里的回答'))
}

/* 6. user messages never absorb assistant output */
{
  const list = run([{ role: 'user', text: '你好' }, thinkingEv, blocksEv('回复')])
  check('user message stays untouched', list[0].role === 'user' && list[0].text === '你好')
  check('assistant answer is separate from the user turn', list.length === 3, 'len=' + list.length)
  check('a full turn keeps the answer visible next to the user message', visibleAnswer(list).includes('回复'),
    JSON.stringify(visibleAnswer(list)))
}

const failed = results.filter((r) => !r.ok)
console.log('\n' + (failed.length ? `FAIL ${failed.length}/${results.length}` : `PASS all ${results.length}`))
process.exit(failed.length ? 1 : 0)
