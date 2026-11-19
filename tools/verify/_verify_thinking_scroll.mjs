// Regression for "scrolling up inside a live thinking chain snaps back down".
//
// WorkRow used to set `el.scrollTop = el.scrollHeight` on every detail delta.
// A 3,000-character chain therefore yanked the reader back to the newest line
// several times a second, making the beginning unreadable. Auto-follow is now
// conditional on the box already being at its bottom, with a jump button when
// it is not.
//
// The rule lives in `detailFollowsBottom`, lifted from the client source so the
// test needs neither a browser nor a model.
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
const detailFollowsBottom = new Function(lift('detailFollowsBottom') + '\nreturn detailFollowsBottom')()

const results = []
const check = (name, ok, detail) => {
  results.push(Boolean(ok))
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
}

const box = (scrollTop, scrollHeight = 1000, clientHeight = 200) =>
  ({ scrollTop, scrollHeight, clientHeight })

check('top of a long chain is not followed', detailFollowsBottom(box(0)) === false)
check('middle of a long chain is not followed', detailFollowsBottom(box(400)) === false)
check('near bottom (gap 20) still follows', detailFollowsBottom(box(780)) === true)
check('exactly at bottom follows', detailFollowsBottom(box(800)) === true)
check('a short box follows', detailFollowsBottom(box(0, 100, 100)) === true)
check('missing element defaults to follow', detailFollowsBottom(null) === true)
check('custom threshold is honoured', detailFollowsBottom(box(700), 120) === true)

// Reverse proof of the old behaviour: it scrolled regardless of position.
function oldFollow(el) {
  if (el) el.scrollTop = el.scrollHeight
  return el
}
const parked = box(120)
oldFollow(parked)
check('old rule is proven to yank the reader', parked.scrollTop === 1000, `scrollTop=${parked.scrollTop}`)

// The new rule applied to the same parked box leaves it untouched.
const parked2 = box(120)
if (detailFollowsBottom(parked2)) parked2.scrollTop = parked2.scrollHeight
check('new rule preserves the parked position', parked2.scrollTop === 120, `scrollTop=${parked2.scrollTop}`)

console.log(`\n${results.filter(Boolean).length}/${results.length} passed`)
process.exit(results.every(Boolean) ? 0 : 1)
