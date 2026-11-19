// Regression for "thinking stops showing when the turn also uses tools".
//
// The typing pump queued tool/result events as markers between thinking text.
// Its backlog counter summed ALL text items in the queue, including text behind
// a marker. After the first text run was typed, the marker sat at the head but
// `backlog` was still non-zero (from later text), so the pump never released it
// and never reached that later text. The chain froze mid-way even though the
// backend had emitted thousands of thinking deltas.
//
// applyEvent and advanceTypeQueue live inside the client module closure, so
// they are lifted out of the source text and evaluated with a stubbed `uid`.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const TARGET = process.argv[2] || path.join(HERE, '..', '..', 'lib', 'client.js')
const SRC = fs.readFileSync(TARGET, 'utf-8')

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
const api = new Function(stubs + lift('applyEvent') + '\n' + lift('advanceTypeQueue') +
  '\nreturn { applyEvent, advanceTypeQueue }')()
const { applyEvent, advanceTypeQueue } = api

const results = []
const check = (name, ok, detail) => {
  results.push(Boolean(ok))
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
}

function pump(queue, step = advanceTypeQueue) {
  let messages = []
  let frames = 0
  while (queue.length && frames < 200) {
    frames++
    const { typed } = step(queue, (ev) => { messages = applyEvent(messages, ev) })
    for (const ev of typed) messages = applyEvent(messages, ev)
  }
  return { messages, frames, stuck: queue.length > 0 }
}

// The exact shape that deadlocked: thinking, tool marker, more thinking.
const q1 = [
  { t: 'text', kind: 'thinking', text: '前半段思考' },
  { t: 'ev', ev: { kind: 'tool', name: 'Bash', text: 'command output' } },
  { t: 'text', kind: 'thinking', text: '后半段思考' },
]
const r1 = pump(q1)
check('tool marker does not stall the pump', !r1.stuck, `frames=${r1.frames} left=${q1.length}`)
const thought = r1.messages.filter((m) => m.kind === 'thinking').map((m) => m.text).join('')
check('thinking on both sides of the tool is rendered', thought.includes('前半段思考') && thought.includes('后半段思考'), thought)
check('tool card is still applied', r1.messages.some((m) => m.kind === 'tool' && m.text === 'command output'))
check('arrival order is preserved',
  r1.messages.findIndex((m) => m.kind === 'tool') > r1.messages.findIndex((m) => m.kind === 'thinking')
  && r1.messages.findIndex((m) => m.kind === 'tool') < r1.messages.length - 1)

// Multiple interleaved tool calls, like the real legal-document turn.
const q2 = [
  { t: 'text', kind: 'thinking', text: '思考一' },
  { t: 'ev', ev: { kind: 'tool', name: 'Read', text: 'A' } },
  { t: 'text', kind: 'thinking', text: '思考二' },
  { t: 'ev', ev: { kind: 'tool_result', name: 'Bash', text: 'B' } },
  { t: 'text', kind: 'thinking', text: '思考三' },
]
const r2 = pump(q2)
check('multiple interleaved tools drain fully', !r2.stuck, `frames=${r2.frames} left=${q2.length}`)
check('all three thinking segments survive',
  ['思考一', '思考二', '思考三'].every((s) => r2.messages.some((m) => m.kind === 'thinking' && m.text === s)))

// Marker behind text must still wait for that text (ordering contract).
const q3 = [
  { t: 'text', kind: 'thinking', text: '先打字' },
  { t: 'ev', ev: { kind: 'result', ok: true, text: 'done' } },
]
const first = advanceTypeQueue(q3, () => {})
check('marker behind text waits for the first frame', first.typed.length > 0 && q3.length > 0,
  `typed=${first.typed.length} queued=${q3.length}`)

// Reverse proof: the old backlog rule really does deadlock on the same input.
function oldAdvance(q, apply) {
  if (!q || !q.length) return { typed: [], empty: true }
  let backlog = 0
  for (const it of q) if (it.t === 'text') backlog += it.text.length
  if (!backlog) {
    for (const it of q) apply(it.ev)
    q.length = 0
    return { typed: [], empty: true }
  }
  const rate = Math.min(6000, Math.max(15, backlog / 0.8))
  let budget = Math.max(1, Math.round(rate * 28 / 1000))
  const typed = []
  while (budget > 0 && q.length) {
    const it = q[0]
    if (it.t !== 'text') break
    const take = Math.min(budget, it.text.length)
    typed.push({ kind: it.kind, text: it.text.slice(0, take) })
    it.text = it.text.slice(take)
    budget -= take
    if (!it.text.length) q.shift()
  }
  return { typed, empty: false }
}
const oldQueue = [
  { t: 'text', kind: 'thinking', text: '前半段思考' },
  { t: 'ev', ev: { kind: 'tool', name: 'Bash', text: 'command output' } },
  { t: 'text', kind: 'thinking', text: '后半段思考' },
]
const old = pump(oldQueue, oldAdvance)
check('old pump is proven to deadlock', old.stuck, `left=${oldQueue.length} head=${oldQueue[0]?.t}`)

console.log(`\n${results.filter(Boolean).length}/${results.length} passed`)
process.exit(results.every(Boolean) ? 0 : 1)
