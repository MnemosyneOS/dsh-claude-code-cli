#!/usr/bin/env node
/**
 * Verify the context nudge (the "compaction is about to happen" bar).
 *
 * The point of this test is to exercise the *shipped* decision function, not a
 * re-implementation of it: `ctxNudge` is sliced out of lib/client.js by name and
 * evaluated, so a behaviour change in the panel fails here immediately.
 *
 * Run: node tools/verify/_verify_ctx_nudge.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
const CLIENT = path.join(ROOT, 'lib/client.js')
const src = fs.readFileSync(CLIENT, 'utf8')

let pass = 0
let fail = 0
function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`) }
}

/* ---------------------------------------------- 1. extract the real function */
function sliceFunction(source, name) {
  const start = source.indexOf(`function ${name}(`)
  if (start < 0) return null
  // Brace-match from the first `{` after the signature.
  const open = source.indexOf('{', start)
  let depth = 0
  for (let i = open; i < source.length; i++) {
    const c = source[i]
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return source.slice(start, i + 1)
    }
  }
  return null
}

const fnSrc = sliceFunction(src, 'ctxNudge')
ok('ctxNudge exists in lib/client.js', Boolean(fnSrc))

let ctxNudge = null
if (fnSrc) {
  try {
    // eslint-disable-next-line no-new-func
    ctxNudge = new Function(`${fnSrc}; return ctxNudge;`)()
    ok('ctxNudge evaluates in isolation', typeof ctxNudge === 'function')
  } catch (e) {
    ok('ctxNudge evaluates in isolation', false, e.message)
  }
}

if (ctxNudge) {
  /* ------------------------------------------------------ 2. the truth table */
  const W = 200000

  const at = (pct, dismissed = -1) => ctxNudge(W * pct, W, dismissed)

  // Below the threshold: silence.
  ok('silent at 0%', at(0).show === false)
  ok('silent at 50%', at(0.5).show === false)
  ok('silent at 74%', at(0.74).show === false)

  // At/above 75%: it speaks.
  ok('warns at exactly 75%', at(0.75).show === true)
  ok('warns at 80%', at(0.8).show === true)
  ok('warns at 95%', at(0.95).show === true)

  // Loudness switches at 90%, and only there.
  ok('level=near at 75%', at(0.75).level === 'near')
  ok('level=near at 89%', at(0.89).level === 'near')
  ok('level=over at 90%', at(0.9).level === 'over')
  ok('level=over at 99%', at(0.99).level === 'over')

  // Never invent a denominator.
  ok('no window => no percent', ctxNudge(150000, 0, -1).pct === 0)
  ok('no window => no warning', ctxNudge(150000, 0, -1).show === false)
  ok('no window => no warning (undefined)', ctxNudge(150000, undefined, -1).show === false)

  // Junk in, sane out.
  ok('NaN used is treated as 0', ctxNudge(NaN, W, -1).show === false)
  ok('negative used clamps to 0', ctxNudge(-500, W, -1).pct === 0)
  ok('used > window clamps to 1', ctxNudge(W * 2, W, -1).pct === 1)
  ok('over-full still warns as over', ctxNudge(W * 2, W, -1).level === 'over')

  // Band arithmetic: 75% -> band 7, 89% -> band 8, 100% -> band 10.
  ok('band at 75% is 7', at(0.75).band === 7)
  ok('band at 89% is 8', at(0.89).band === 8)
  ok('band at 100% is 10', at(1).band === 10)

  /* --------------------------------------------------- 3. dismissal is banded */
  ok('dismissing band 7 hides the 75% notice', at(0.75, 7).show === false)
  ok('dismissing band 7 keeps 79% quiet', at(0.79, 7).show === false)
  ok('dismissing band 7 re-warns at 80%', at(0.8, 7).show === true)
  ok('dismissing band 8 re-warns at 90%', at(0.9, 8).show === true)
  ok('dismissing band 9 keeps 95% quiet', at(0.95, 9).show === false)
  ok('dismissing band 10 stays quiet at 100%', at(1, 10).show === false)
  ok('dismissed=-1 means never dismissed', at(0.75, -1).show === true)
  ok('dismissed=undefined is treated as never', at(0.75, undefined).show === true)

  /* --------------------------------- 4. percentage text matches the gauge rule */
  // The bar must show the same number as the composer gauge, or the two
  // disagree on screen. Both round the same pct.
  ok('pct matches gauge rounding at 76.4%', Math.round(at(0.764).pct * 100) === 76)
  ok('pct matches gauge rounding at 90%', Math.round(at(0.9).pct * 100) === 90)
}

/* ------------------------------------------------------------- 5. i18n wiring */
const zhBlock = src.slice(src.indexOf('zh:'), src.indexOf('en:'))
const enBlock = src.slice(src.indexOf('en:'), src.indexOf('en:') + 9000)

ok('zh has ctxNear', /ctxNear:\s*'[^']*\{pct\}[^']*'/.test(zhBlock))
ok('zh has ctxOver', /ctxOver:\s*'[^']*\{pct\}[^']*'/.test(zhBlock))
ok('en has ctxNear', /ctxNear:\s*'[^']*\{pct\}[^']*'/.test(enBlock))
ok('en has ctxOver', /ctxOver:\s*'[^']*\{pct\}[^']*'/.test(enBlock))
ok('zh has dismiss label', /dismiss:\s*'[^']+'/.test(zhBlock))
ok('en has dismiss label', /dismiss:\s*'[^']+'/.test(enBlock))
ok('zh mentions the semantic summary', /语义摘要/.test(zhBlock))
ok('en mentions the semantic summary', /semantic summary/.test(enBlock))

/* --------------------------------------------------------- 6. render wiring */
ok('render reads nudge.show', /const ctxWarn = nudge\.show/.test(src))
ok('render reads nudge.level', /nudge\.level === 'over'/.test(src))
ok('render calls ctxNudge with the live window', /ctxNudge\(ctxInfo\.used,\s*ctxInfo\.ctxWindow,\s*ctxWarnDismissed\)/.test(src))
ok('dismiss button records the current band', /setCtxWarnDismissed\(ctxBand\)/.test(src))
ok('bar only renders when ctxWarn is true', /ctxWarn\s*\n\s*\?\s*h\('div',\s*\{\s*className:\s*'ccp-ctxwarn'/.test(src))
ok('placeholder is substituted, not printed', /\.replace\('\{pct\}',\s*ctxPctText\)/.test(src))

/* ------------------------------------------- 7. the bar shares the text baseline */
const cssBlock = src.slice(src.indexOf('const CSS = `'))

ok('bar uses the stream gutter (26px)', /\.ccp-ctxwarn\{padding:7px 26px/.test(cssBlock))
ok('bar inner mirrors the 880px column', /\.ccp-ctxwarn-in\{max-width:880px;margin:0 auto;padding:0 14px/.test(cssBlock))
ok('bar icon is absolutely positioned (does not eat flex width)', /\.ccp-ctxwarn-ico\{position:absolute;left:0/.test(cssBlock))
ok('bar text is indented for the icon', /\.ccp-ctxwarn-t\{position:relative;flex:1;min-width:0;padding-left:16px\}/.test(cssBlock))
ok('bar uses the warn palette, not the coral stale palette', /\.ccp-ctxwarn\{[^}]*var\(--warnSoft\)/.test(cssBlock))
ok('bar line-height matches the transcript rhythm', /\.ccp-ctxwarn\{[^}]*line-height:1\.55/.test(cssBlock))
ok('light palette defines warn', /light:\s*\{[^}]*warn:\s*'#[0-9a-f]{6}'/.test(src))
ok('dark palette defines warn', /dark:\s*\{[^}]*warn:\s*'#[0-9a-f]{6}'/.test(src))

console.log(`\n${pass}/${pass + fail} passed`)
if (fail) {
  console.log(`${fail} FAILED`)
  process.exit(1)
}
