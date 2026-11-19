#!/usr/bin/env node
/**
 * Verify that a broken CLI is diagnosed instead of silently producing nothing.
 *
 * The incident this guards: an upgrade replaced `bin/claude.exe` with npm's
 * ~500-byte placeholder, the package version still read 2.1.328, every spawn
 * failed with `spawn UNKNOWN`, and the panel showed the user's message with no
 * reply and no explanation. Three questions are tested here:
 *   1. can we tell a placeholder from a real binary (cliHealth)?
 *   2. is the failure translated into something actionable (explainSpawnError)?
 *   3. does it reach the transcript, and does the upgrade refuse to call itself
 *      successful when the CLI it just installed cannot run?
 *
 * Run: node tools/verify/_verify_cli_health.mjs
 */
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { cliHealth, explainSpawnError, CLI_STUB_MARKER } from '../../lib/cli-health.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
const INDEX = fs.readFileSync(path.join(ROOT, 'lib/index.js'), 'utf8')
const CLIENT = fs.readFileSync(path.join(ROOT, 'lib/client.js'), 'utf8')

let pass = 0
let fail = 0
function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`) }
}

const TMP = path.join(os.tmpdir(), 'ccp-clihealth-' + Math.random().toString(36).slice(2, 8))
await fsp.mkdir(TMP, { recursive: true })

/* ------------------------------------------------ 1. the real stub, verbatim */
// The exact text npm's placeholder writes — copied from the machine that broke.
const STUB_TEXT = `#!/bin/sh
echo "Error: claude native binary not installed." >&2
echo "" >&2
echo "Either postinstall did not run (--ignore-scripts, some pnpm configs)" >&2
echo "or the platform-native optional dependency was not downloaded" >&2
echo "(--omit=optional)." >&2
`
const stubPath = path.join(TMP, 'claude-stub.exe')
await fsp.writeFile(stubPath, STUB_TEXT)

const stub = await cliHealth(stubPath)
ok('a real npm placeholder is rejected', stub.ok === false)
ok('the reason names the stub', stub.reason === 'cli-stub', stub.reason)
ok('the message says the native binary is missing', /原生二进制缺失/.test(stub.message), stub.message)
ok('the message tells the reader what to do', /重新安装|npm install/.test(stub.message))
ok('the marker matches the shipped placeholder wording', CLI_STUB_MARKER.test(STUB_TEXT))

/* ------------------------------------- 2. a small file that is NOT a stub */
// Global installs ship a small .cmd shim. Rejecting those would break working
// setups, so size alone must never decide.
const shimPath = path.join(TMP, 'claude.cmd')
await fsp.writeFile(shimPath, '@echo off\r\nnode "%~dp0\\cli.js" %*\r\n')
const shim = await cliHealth(shimPath)
ok('a small legitimate shim is accepted', shim.ok === true, JSON.stringify(shim))
ok('the shim is not called a stub', shim.reason !== 'cli-stub')

/* ------------------------------------------------- 3. missing / empty paths */
const missing = await cliHealth(path.join(TMP, 'nope.exe'))
ok('a missing CLI is rejected', missing.ok === false)
ok('the reason is cli-missing', missing.reason === 'cli-missing', missing.reason)
ok('the message includes the path', /nope\.exe/.test(missing.message))

const blank = await cliHealth('')
ok('an empty path is rejected', blank.ok === false)
ok('an empty path points at the settings field', /claude CLI 路径/.test(blank.message), blank.message)

/* ---------------------------------------- 4. a real binary passes untouched */
const realCli = path.join(
  'C:', 'AI_Workspace', '01_Agents', 'Claude Code', '安装目录',
  'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe',
)
const real = await cliHealth(realCli)
ok('the installed native binary is accepted', real.ok === true, JSON.stringify(real).slice(0, 120))
ok('a real binary is far larger than the stub cap', (real.size || 0) > 1024 * 1024, 'size=' + real.size)

/* ---------------------------------------------- 5. spawn errors are translated */
const unknown = explainSpawnError({ message: 'spawn UNKNOWN' }, realCli)
ok('spawn UNKNOWN is explained', /无法启动/.test(unknown), unknown)
ok('spawn UNKNOWN names the real cause', /占位符|原生包/.test(unknown), unknown)
ok('spawn UNKNOWN points at the update tab', /更新/.test(unknown))
ok('spawn UNKNOWN is not passed through raw', !/^spawn UNKNOWN$/.test(unknown))

const enoent = explainSpawnError({ code: 'ENOENT' }, realCli)
ok('ENOENT says the CLI is missing', /不存在/.test(enoent), enoent)
ok('ENOENT points at the path setting', /claude CLI 路径/.test(enoent))

const eacces = explainSpawnError({ code: 'EACCES' }, realCli)
ok('EACCES mentions permissions or antivirus', /权限|杀毒/.test(eacces), eacces)

const other = explainSpawnError({ code: 'E2BIG' }, realCli)
ok('unknown codes still say something', /启动失败/.test(other) && /E2BIG/.test(other), other)

/* ------------------------------------------ 6. the failure reaches the transcript */
ok('runJob probes the CLI before spawning', /const health = await cliHealth\(argv\[0\]\)/.test(INDEX))
ok('an unusable CLI aborts the turn', /if \(!health\.ok\) \{[\s\S]{0,400}?return\r?\n/.test(INDEX))
ok('the abort is recorded as a job error', /patchJob\(jobId, \{ error: health\.message, done: true, status: 'done' \}\)/.test(INDEX))
ok('the abort is pushed as a visible event', /pushEvent\(jobId, \{ kind: 'error', text: health\.message/.test(INDEX))
ok('a spawn error is translated before reporting', /const said = explainSpawnError\(e, argv\[0\]\)/.test(INDEX))
ok('a spawn error is pushed as a visible event', /pushEvent\(jobId, \{ kind: 'error', text: said/.test(INDEX))

ok('the client merges an error event', /ev\.kind === 'error'[\s\S]{0,300}?kind: 'error'/.test(CLIENT))
ok('an error row renders as a persistent box', /case 'error':[\s\S]{0,300}?ccp-errbox/.test(CLIENT))
ok('the error box style exists', /\.ccp-errbox\{/.test(CLIENT))

/* --------------------------------- 7. an upgrade may not claim a broken install */
ok('upgrade snapshots health, not only version', /healthyBefore: \(await cliHealth\(cli\)\)\.ok/.test(INDEX))
ok('upgrade re-probes health after npm finishes', /const healthAfter = await cliHealth\(cli\)/.test(INDEX))
ok('upgrade reports failure when the CLI cannot run', /else if \(!healthAfter\.ok\) \{[\s\S]{0,200}?升级后 CLI 不可用/.test(INDEX))
ok('upgrade success requires a runnable CLI', /ok: code === 0 && healthAfter\.ok/.test(INDEX))
ok('upgrade flags "it worked before, now it does not"', /brokeWorkingCli: Boolean\(state\.healthyBefore\) && !healthAfter\.ok/.test(INDEX))
ok('npm failure text is included in the error', /npm 退出码 \$\{code\}\$\{log\.trim\(\)/.test(INDEX))

/* --------------------------------------- 8. a stuck upgrade record self-heals */
ok('status detects a record left running by a dead process', /if \(!live && saved\.running\)/.test(INDEX))
ok('status closes out the stale record', /running: false, ok: false, finished: Date.now\(\)/.test(INDEX))
ok('status tells the reader it can retry', /没有正常结束[\s\S]{0,40}?重新尝试/.test(INDEX))
ok('status marks the recovery so the UI can tell', /recovered: true/.test(INDEX))

await fsp.rm(TMP, { recursive: true, force: true })

console.log(`\n${pass}/${pass + fail} passed`)
if (fail) {
  console.log(`${fail} FAILED`)
  process.exit(1)
}
