/**
 * _verify_component_scope.mjs — module-level components must not reach into
 * Panel's closure.
 *
 * The bug this exists for: WorkRow is declared at module scope (so renderMessage
 * can call it) but its "jump to newest line" button read `t.toBottom`, and `t`
 * only exists inside Panel(). It stayed invisible for months because that branch
 * needs `live && open && !detailAtBottom` — i.e. the reader scrolling up inside a
 * still-streaming thinking chain. Then it fired, the error boundary caught a
 * ReferenceError, and the panel showed "render failed" instead of a transcript.
 *
 * Two checks, because either alone is weak:
 *   1. static  — no module-scope function may reference `t.` unless `t` is in its
 *                own parameter list / props or declared in its body;
 *   2. runtime — WorkRow is sliced out of the real source and rendered through a
 *                stub `h` in the exact state that triggers the button, with the
 *                props renderMessage actually passes. The pre-fix signature must
 *                throw ReferenceError; the shipped one must produce a button
 *                carrying the translated label.
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '../..')
const SRC = fs.readFileSync(path.join(ROOT, 'lib/client.js'), 'utf8')

let pass = 0
let fail = 0
function ok(cond, name, detail) {
  if (cond) { pass++; console.log('  PASS  ' + name) }
  else { fail++; console.log('  FAIL  ' + name + (detail ? ' — ' + detail : '')) }
}

/* ---------------------------------------------------------------- helpers */

/** Slice `function NAME(...) {` … matching close brace. */
function sliceFunction(src, name) {
  const start = src.indexOf('function ' + name + '(')
  if (start < 0) throw new Error('function not found: ' + name)
  // Skip the parameter list first: a destructured signature like ({ t, icon })
  // opens a brace that is NOT the body, and counting it returns immediately.
  let p = src.indexOf('(', start)
  let pdepth = 0
  let afterParams = -1
  for (let j = p; j < src.length; j++) {
    if (src[j] === '(') pdepth++
    else if (src[j] === ')') { pdepth--; if (pdepth === 0) { afterParams = j + 1; break } }
  }
  if (afterParams < 0) throw new Error('unbalanced params: ' + name)
  let i = src.indexOf('{', afterParams)
  let depth = 0
  for (let j = i; j < src.length; j++) {
    const c = src[j]
    if (c === '{') depth++
    else if (c === '}') { depth--; if (depth === 0) return src.slice(start, j + 1) }
  }
  throw new Error('unbalanced braces: ' + name)
}

/** Split the top-level destructured prop names of a component signature. */
function propNames(fnSrc) {
  const m = fnSrc.match(/function\s+\w+\s*\(\s*\{([^}]*)\}/)
  if (!m) return []
  return m[1].split(',').map((s) => s.trim().split(':')[0].split('=')[0].trim()).filter(Boolean)
}

/* ------------------------------------------------ 1. static scope analysis */
console.log('\n1. module-scope functions do not borrow Panel\'s `t`')

// A module-scope function starts at column 4 and is not nested inside Panel().
// Panel() itself is excluded: it legitimately owns `t`.
const declRe = /^    function ([A-Za-z_$][\w$]*)\s*\(/gm
const decls = []
let dm
while ((dm = declRe.exec(SRC))) decls.push({ name: dm[1], at: dm.index })

const panelAt = SRC.indexOf('function Panel()')
const offenders = []
for (const d of decls) {
  if (d.name === 'Panel') continue
  let body
  try { body = sliceFunction(SRC, d.name) } catch { continue }
  // Does the body reference `t.` as a value?
  if (!/(^|[^A-Za-z0-9_$.])t\.[A-Za-z_$]/.test(body)) continue
  const props = propNames(body)
  const params = (body.match(/function\s+\w+\s*\(([^)]*)\)/) || [, ''])[1]
  const hasT = props.includes('t') || /(^|,)\s*t\s*(,|=|$)/.test(params)
  // Also accept a local declaration inside the body.
  const localT = /(?:const|let|var)\s+t\s*=/.test(body)
  if (!hasT && !localT) offenders.push(d.name)
}
ok(offenders.length === 0, 'no module-scope function reads an undeclared `t`',
  offenders.length ? 'offenders: ' + offenders.join(', ') : '')

// The specific regression: WorkRow must declare `t` as a prop.
const workRowSrc = sliceFunction(SRC, 'WorkRow')
ok(propNames(workRowSrc).includes('t'), 'WorkRow declares `t` as a prop')

// And every call site must actually pass it.
const callSites = [...SRC.matchAll(/h\(WorkRow,\s*\{([^}]*)\}/g)].map((m) => m[1])
ok(callSites.length >= 2, 'both WorkRow call sites found', 'found ' + callSites.length)
ok(callSites.every((c) => /(^|,|\s)t\s*(,|$)/.test(c.replace(/\s+/g, ' '))),
  'every WorkRow call site passes `t`', callSites.map((c) => c.trim().slice(0, 40)).join(' | '))

/* ------------------------------------------------------ 2. runtime render */

// Stub React so WorkRow's hooks work without a renderer. useState returns the
// initial value except for the call that seeds `detailAtBottom`, which we force
// to false — that is precisely the state the broken button needed.
function makeStubs(forceDetailAtBottomFalse) {
  let stateCall = 0
  const React = {
    useState(init) {
      stateCall++
      const forced = forceDetailAtBottomFalse && stateCall === 2 && init === true
      return [forced ? false : init, () => {}]
    },
    useRef: (v) => ({ current: v }),
    useEffect: () => {},
    useCallback: (fn) => fn,
  }
  // h() builds a plain tree we can inspect.
  const h = (type, props, ...children) => ({ type, props: props || {}, children })
  const Icon = () => null
  const detailFollowsBottom = () => false
  return { React, h, Icon, detailFollowsBottom }
}

function renderWorkRow(fnSrc, props, force) {
  const { React, h, Icon, detailFollowsBottom } = makeStubs(force)
  // Evaluate the shipped source, not a reimplementation of it.
  const factory = new Function(
    'React', 'h', 'Icon', 'detailFollowsBottom', 'useState', 'useRef', 'useEffect', 'useCallback',
    fnSrc + '\nreturn WorkRow;',
  )
  const WorkRow = factory(
    React, h, Icon, detailFollowsBottom,
    React.useState, React.useRef, React.useEffect, React.useCallback,
  )
  return WorkRow(props)
}

function findButton(node) {
  if (!node || typeof node !== 'object') return null
  if (node.type === 'button') return node
  for (const c of node.children || []) {
    const hit = findButton(c)
    if (hit) return hit
  }
  return null
}

console.log('\n2. WorkRow renders the jump button in the scrolling-up state')

const T = { toBottom: '跳到最新' }
const liveProps = {
  t: T, icon: 'think', label: '思考中', summary: '', detail: 'line\nline',
  tone: 'think', compact: false, live: true,
}

let tree
try {
  tree = renderWorkRow(workRowSrc, liveProps, true)
  ok(true, 'WorkRow renders without throwing')
} catch (e) {
  ok(false, 'WorkRow renders without throwing', String(e && e.message || e))
}

if (tree) {
  const btn = findButton(tree)
  ok(Boolean(btn), 'the jump button is present while scrolled up mid-stream')
  ok(btn && btn.props.title === T.toBottom, 'button title uses the passed translation',
    btn ? 'got ' + JSON.stringify(btn.props.title) : 'no button')
  ok(btn && btn.props['aria-label'] === T.toBottom, 'button aria-label uses the passed translation')
  ok(btn && typeof btn.props.onClick === 'function', 'button is clickable')
}

// The button must NOT appear when the reader is at the bottom.
try {
  const atBottom = renderWorkRow(workRowSrc, liveProps, false)
  ok(!findButton(atBottom), 'no jump button while already at the newest line')
} catch (e) {
  ok(false, 'no jump button while already at the newest line', String(e && e.message || e))
}

/* ------------------------------------------- 3. the pre-fix code would fail */

console.log('\n3. the pre-fix signature is actually rejected (the test has teeth)')

const preFix = workRowSrc.replace('function WorkRow({ t, ', 'function WorkRow({ ')
let threw = null
try {
  renderWorkRow(preFix, liveProps, true)
} catch (e) {
  threw = e
}
ok(Boolean(threw) && /t is not defined/.test(String(threw.message)),
  'pre-fix WorkRow throws ReferenceError: t is not defined',
  threw ? String(threw.message) : 'did not throw — the test would not have caught it')

// Sanity: the same broken source is fine when the button never renders, which is
// exactly why this survived so long.
let quiet = null
try {
  renderWorkRow(preFix, liveProps, false)
} catch (e) { quiet = e }
ok(quiet === null, 'pre-fix code is silent while at the bottom (explains the latency)')

/* ------------------------------------- 4. one bad row must not cost the rest */

console.log('\n4. a row fault degrades to one line, not the whole transcript')

ok(/class RowBoundary extends React\.Component/.test(SRC), 'RowBoundary exists')
ok(/static getDerivedStateFromError/.test(SRC.slice(SRC.indexOf('class RowBoundary'))),
  'RowBoundary implements getDerivedStateFromError')
ok(/render:row/.test(SRC), 'row faults are logged under a distinct kind (render:row)')
ok(/groupMessages\(messages\)\.map\(\(g\) => h\(RowBoundary, \{ key: g\.key \}/.test(SRC),
  'every rendered group is wrapped in RowBoundary')
ok(/rowFailed/.test(SRC) && /rowFailedHint/.test(SRC), 'row fallback has its own copy')
// The fallback must carry the message so the next report is actionable.
ok(/ccp-rowfail-msg/.test(SRC), 'row fallback shows the underlying error text')
// Theme-aware: the old errbox used fixed light colours and glared in dark mode.
const cssBlock = SRC.slice(SRC.indexOf('const CSS = `'), SRC.indexOf('const CSS = `') + 60000)
const errboxRule = (cssBlock.match(/\.ccp-errbox\{[^}]*\}/) || [''])[0]
ok(!/#[0-9a-fA-F]{3,6}/.test(errboxRule), 'errbox uses theme variables, not fixed hex')
const rowfailRule = (cssBlock.match(/\.ccp-rowfail\{[^}]*\}/) || [''])[0]
ok(/var\(--warn\)/.test(rowfailRule) && /var\(--warnSoft\)/.test(rowfailRule),
  'rowfail is amber and theme-aware')

/* ------------------------------------------------------------------ report */

console.log('\n' + pass + '/' + (pass + fail) + ' passed')
if (fail) {
  console.log('\n' + fail + ' FAILED')
  process.exit(1)
}
