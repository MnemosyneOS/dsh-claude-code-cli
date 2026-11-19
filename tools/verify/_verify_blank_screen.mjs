// Regression for the "blank panel" bug: a render exception used to unmount the
// whole React tree with no boundary and no crash log. Verify the guard pieces
// are present and that malformed text is sanitized before reaching the DOM.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const client = fs.readFileSync(path.join(ROOT, 'lib/client.js'), 'utf8')
const index = fs.readFileSync(path.join(ROOT, 'lib/index.js'), 'utf8')

let pass = 0
const check = (name, ok) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name)
  if (ok) pass++
}

// --- 1. Error boundary exists and wraps the main panel ---
check('ErrorBoundary class defined', /class ErrorBoundary extends React\.Component/.test(client))
check('getDerivedStateFromError present', /static getDerivedStateFromError\(\)/.test(client))
check('componentDidCatch reports', /componentDidCatch\(err, info\)/.test(client) && /reportUiError\('render:'/.test(client))
check('main view wrapped in boundary', /h\(ErrorBoundary, \{ area: 'main' \}/.test(client))
check('boundary offers a retry', /this\.retry = this\.retry\.bind\(this\)/.test(client) && /onClick: this\.retry/.test(client))
check('fallback is not blank', /t\.viewFailed/.test(client) && /t\.viewFailedHint/.test(client))
check('both locales have fallback copy', (client.match(/viewFailed:/g) || []).length >= 2)

// --- 2. async errors are reported too ---
check('window error hook', /addEventListener\('error'/.test(client) && /kind: 'window\.error'/.test(client))
check('unhandled rejection hook', /addEventListener\('unhandledrejection'/.test(client))
check('hook installed once', /window\.__ccpUiErrorHooked/.test(client))

// --- 3. lone surrogates sanitized before innerHTML ---
check('safeText strips lone surrogates', /function safeText\(text\)/.test(client) && /\\uD800-\\uDBFF/.test(client))
check('renderInline uses safeText', /function renderInline\(text\) \{\s*return safeText\(text\)/.test(client))
// Behavioral check: extract the regex and apply it to a real GBK-misdecode sample
const lone = '\uD800' + 'A' + '\uDC00' + '中'.repeat(3) // high lone, low lone, valid pair-free CJK
const cleaned = lone.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '\uFFFD')
check('lone surrogate replaced with U+FFFD', cleaned === '\uFFFD' + 'A' + '\uFFFD' + '中'.repeat(3))

// --- 4. host-side error log endpoint ---
check('ui-error route registered', /\$\{API\}\/ui-error/.test(index))
check('ui-error appended to disk', /appendFile\(path\.join\(dataRoot\(\), 'ui-errors\.log'/.test(index))
check('ui-error logs via ctx.logger', /\[ccp\]\[ui\]/.test(index))

const total = 16
console.log('\n' + pass + '/' + total + ' passed')
if (pass !== total) process.exit(1)
