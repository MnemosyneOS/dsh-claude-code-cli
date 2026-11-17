/**
 * Claude Code Parity for DeepSeek Harness — Host-side plugin.
 *
 * A graphical, non-terminal Claude Code workspace inside DSH Web UI. This is
 * the DSH-native port of Hermes claude-code-parity 2.5.1:
 *   - Claude CLI (claude.exe) runs as a child process in headless stream-json mode
 *   - an Anthropic⇄DSH-LLM loopback bridge lets it use any DSH model with no
 *     separate Claude login (see bridge.js)
 *   - tool approvals are exchanged through per-job files (Y / A / N)
 *   - sessions, settings and attachments persist under DSH_HOME/ccp-data/
 *   - the front-end (client.js) contributes a sidebar entry + main panel
 *
 * inject declaration lists the DSH services this plugin needs.
 */

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import https from 'node:https'
import http from 'node:http'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createBridge, bridgeEnv } from './bridge.js'
import {
  dshHome, dataRoot, ensureDirs, safeName, readJson, writeJson,
  SETTING_GROUPS, SETTINGS_ITEMS, defaultSettings, loadSettings, saveSettings, coerce,
  settingsFile, createJob, getJob, jobFile, pushEvent, patchJob,
  listSessions, getSession, putSession, deleteSession, sessionFile,
  claudeProjectsDir, scanClaudeHistory, readCliTranscript,
  normalizeStreamJson, flattenEvents, randomUUID, shortHash,
  getCliMeta, putCliMeta, deleteCliMeta, mergeCliMeta, ensureCliTitles,
} from './common.js'

const execFileAsync = promisify(execFile)
// Display name used by the DSH plugin list. The API mount stays
// `/api/claude-code-parity` so existing links and scripts keep working.
export const name = 'DSH-Claude Code CLI'
export const inject = ['webServer', 'llm']

/* --------------------------------------------------------------- runtime state */

const JOBS = new Map() // id -> { job, proc, bridge, abort }
let bridge = null
let resolvedConfig = {}
let ctxRef = null
let selectedModel = null // updated by /api/claude-code-parity/model/select
let ACTIVE_JOB = null // jobId currently driving the bridge (for stats attribution)
let UPGRADE = null // { proc } while an npm install is in flight
let MOBILE = null // { proc, host, port } while the LAN web instance runs
// Sessions written while `keep_history` is off live here and die with the process.
const EPHEMERAL = new Map()

function logger() { return ctxRef?.logger || console }

/** Bridge stats callback: attribute speed/usage to the running job. */
function onBridgeStats(stats, _body) {
  const id = ACTIVE_JOB
  if (!id) return
  pushEvent(id, { kind: 'stats', ...stats }).catch(() => {})
}

/* ------------------------------------------------------------ model catalog */

/** Enumerate DSH providers/models via ctx.llm when available. */
async function modelCatalog(force = false) {
  const llm = ctxRef?.llm
  if (!llm) return []
  try {
    const providers = typeof llm.listProviders === 'function' ? llm.listProviders() : []
    const out = []
    for (const p of providers) {
      const slug = typeof p === 'string' ? p : (p.id || p.slug || p.name)
      if (!slug) continue
      const providerName = (typeof p === 'object' && (p.name || p.label || p.title)) || slug
      let models = []
      if (typeof llm.listModels === 'function') {
        try {
          const m = await llm.listModels(slug)
          models = Array.isArray(m) ? m : (m?.models || [])
        } catch (e) { models = [] }
      }
      for (const m of models) {
        const id = typeof m === 'string' ? m : (m.id || m.name)
        if (!id) continue
        out.push({
          provider: slug,
          providerName,
          model: id,
          name: (typeof m === 'object' && (m.name || m.displayName)) ? (m.name || m.displayName) : id,
          local: /127\.0\.0\.1|localhost|local/i.test(String((typeof m === 'object' && m.baseURL) || '')),
        })
      }
    }
    return out
  } catch (e) {
    logger().warn?.(`[ccp] modelCatalog failed: ${e && e.message}`)
    return []
  }
}

/**
 * Resolve the effective selection against the live DSH catalog.
 *
 * Never writes back to settings: `~/.dsh/ccp-data` is shared by every profile,
 * so a profile that happens to lack a provider must not rewrite the user's
 * choice for the others. Invalid values simply fall back for this run.
 */
async function ensureSelection() {
  const cat = await modelCatalog()
  const settings = await loadSettings()
  const valid = (p, m) => Boolean(m) && cat.some((x) => x.model === m && (!p || x.provider === p))
  if (selectedModel && valid(selectedModel.provider, selectedModel.model)) return selectedModel
  if (valid(settings.provider, settings.model)) return { provider: settings.provider, model: settings.model }
  const byModel = settings.model ? cat.find((x) => x.model === settings.model) : null
  return byModel || cat[0] || null
}

/** Resolve which provider/model this turn uses. */
async function resolveTarget(requested) {
  if (requested && requested.provider && requested.model) return { ...requested, local: false }
  const sel = await ensureSelection()
  if (sel) return { provider: sel.provider, model: sel.model, local: false }
  const cat = await modelCatalog()
  if (cat[0]) return cat[0]
  return { provider: '', model: '', local: false }
}

/* ------------------------------------------------------------- CLI discovery */

async function findCli(config) {
  let explicit = config.cliPath
  // The settings surface owns `cli_path`; honour it so the field is not decorative.
  if (!explicit) {
    try { explicit = String((await loadSettings()).cli_path || '') } catch (e) { /* ignore */ }
  }
  const candidates = []
  if (explicit) candidates.push(explicit)
  candidates.push(
    path.join(os.homedir(), 'AppData', 'Local', 'Claude Code', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'),
    path.join('C:', 'AI_Workspace', '01_Agents', 'Claude Code', '安装目录', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'),
    path.join(os.homedir(), '.local', 'bin', 'claude.cmd'),
    path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'claude.cmd'),
  )
  for (const c of candidates) {
    try { await fsp.access(c); return c } catch (e) { /* keep looking */ }
  }
  return null
}

/**
 * Split a resolved claude binary into its install coordinates.
 * `<root>/node_modules/@anthropic-ai/claude-code/bin/claude.exe` is a local
 * install; a global install lives under the npm prefix instead.
 */
function cliInstallLayout(cli) {
  const binDir = path.dirname(cli)
  const pkgDir = path.resolve(binDir, '..')
  const scopeDir = path.resolve(pkgDir, '..')
  const modulesDir = path.resolve(scopeDir, '..')
  const root = path.resolve(modulesDir, '..')
  return {
    binDir,
    pkgDir,
    scopeDir,
    modulesDir,
    root,
    // A local install has a package.json that owns the dependency.
    local: path.basename(scopeDir) === '@anthropic-ai' && path.basename(modulesDir) === 'node_modules',
  }
}

/** Read the version out of `<pkg>/package.json` — cheaper than spawning the CLI. */
async function installedCliVersion(cli) {
  const { pkgDir } = cliInstallLayout(cli)
  const meta = await readJson(path.join(pkgDir, 'package.json'), null)
  return meta && meta.version ? String(meta.version) : ''
}

/* ---------------------------------------------------------- upgrade plumbing */

/** Minimal JSON GET with a hard timeout; follows one redirect. */
function httpGetJson(url, timeoutMs = 12000, hops = 0) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { accept: 'application/json', 'user-agent': 'dsh-claude-code-cli' },
    }, (res) => {
      const code = res.statusCode || 0
      if (code >= 300 && code < 400 && res.headers.location && hops < 3) {
        res.resume()
        resolve(httpGetJson(new URL(res.headers.location, url).href, timeoutMs, hops + 1))
        return
      }
      if (code !== 200) {
        res.resume()
        reject(new Error(`registry 返回 HTTP ${code}`))
        return
      }
      let buf = ''
      res.setEncoding('utf-8')
      res.on('data', (c) => { buf += c })
      res.on('end', () => {
        try { resolve(JSON.parse(buf)) } catch (e) { reject(new Error('registry 返回内容不是 JSON')) }
      })
    })
    req.setTimeout(timeoutMs, () => req.destroy(new Error('registry 请求超时')))
    req.on('error', reject)
  })
}

/** Numeric semver comparison; ignores pre-release/build metadata. */
function compareVersions(a, b) {
  const parse = (v) => String(v || '').match(/\d+(?:\.\d+)*/)?.[0]?.split('.').map(Number) || []
  const pa = parse(a)
  const pb = parse(b)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const x = pa[i] || 0
    const y = pb[i] || 0
    if (x !== y) return x > y ? 1 : -1
  }
  return 0
}

/** Locate an npm launcher without assuming the user's PATH is set up. */
async function findNpm() {
  const isWin = process.platform === 'win32'
  const name = isWin ? 'npm.cmd' : 'npm'
  const cands = [
    path.join(path.dirname(process.execPath), name),
    isWin ? path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs', name) : '',
    isWin ? path.join(os.homedir(), 'AppData', 'Roaming', 'npm', name) : '',
    '/usr/local/bin/npm',
    '/usr/bin/npm',
  ].filter(Boolean)
  for (const dir of String(process.env.PATH || '').split(path.delimiter)) {
    if (dir) cands.push(path.join(dir, name))
  }
  for (const c of cands) {
    try { await fsp.access(c); return c } catch (e) { /* keep looking */ }
  }
  return null
}

/* ----------------------------------------------------------- mobile gateway */

/** Every non-internal IPv4 address, private ranges first. */
function lanAddresses() {
  const out = []
  const ifaces = os.networkInterfaces()
  for (const name of Object.keys(ifaces)) {
    for (const a of ifaces[name] || []) {
      if (a.family !== 'IPv4' || a.internal) continue
      out.push({ name, address: a.address, netmask: a.netmask })
    }
  }
  const rank = (ip) => (/^192\.168\./.test(ip) ? 0
    : /^10\./.test(ip) ? 1
      : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 2 : 3)
  return out.sort((x, y) => rank(x.address) - rank(y.address))
}

/** The desktop host's own CLI entry, used to boot a LAN-facing web instance. */
function dshCliEntry() {
  const exe = process.execPath
  const resDir = path.join(path.dirname(exe), 'resources')
  const cli = path.join(resDir, 'app.asar', 'dsh', 'node_modules',
    '@deepseek-ai', 'dsh-desktop-host', 'lib', 'cli.js')
  return { exe, cli }
}

/** Profile the current process booted, so the phone sees the same plugin set. */
function currentProfileName() {
  let name = ''
  const argv = process.argv
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--profile' && argv[i + 1]) { name = String(argv[i + 1]); break }
    const m = /[\\/]profiles[\\/]([^\\/]+)[\\/]?$/.exec(String(argv[i]))
    if (m) { name = m[1]; break }
  }
  // `desktop` is owned by the Electron app and refuses to boot from the CLI
  // ("profile is managed exclusively by the Electron application"); the `web`
  // profile ships the same bundle set, this plugin included.
  if (!name || name === 'desktop') return 'web'
  return name
}



/* -------------------------------------------------------------- approvals */

function approvalDir(jobId) { return path.join(dataRoot(), 'approvals', safeName(jobId)) }

async function prepareApproval(jobId, settings) {
  const dir = approvalDir(jobId)
  await fsp.mkdir(dir, { recursive: true })
  const token = randomUUID()
  const timeoutSec = Math.max(10, Math.min(600, Number(settings?.approval_timeout) || 120))
  const args = [path.join(import.meta.dirname, 'approval-mcp.js'),
    '--dir', dir, '--token', token, '--timeout', String(timeoutSec)]
  if (settings?.auto_approve_readonly) args.push('--auto-readonly', '1')
  const cfg = {
    mcpServers: {
      'ccp-approval': {
        command: process.execPath,
        args,
        env: {},
      },
    },
  }
  const cfgPath = path.join(dir, 'mcp-config.json')
  await writeJson(cfgPath, cfg)
  await writeJson(path.join(dir, 'meta.json'), { jobId, token, created: Date.now() })
  return { dir, cfgPath, token }
}

async function pendingApprovals(jobId) {
  const dir = approvalDir(jobId)
  const out = []
  try {
    const files = await fsp.readdir(dir)
    for (const f of files) {
      if (!f.startsWith('req-') || !f.endsWith('.json')) continue
      const req = await readJson(path.join(dir, f), null)
      if (!req) continue
      const decFile = path.join(dir, 'dec-' + req.id + '.json')
      const decided = await readJson(decFile, null)
      if (!decided) out.push({ ...req, jobId })
    }
  } catch (e) { /* no dir */ }
  return out
}

/* ------------------------------------------------------------- settings file */

async function writeClaudeSettings(sessionKey, port, model, values, target) {
  const dir = path.join(dataRoot(), 'uploads', safeName(sessionKey || 'default'))
  await fsp.mkdir(dir, { recursive: true })
  const file = path.join(dir, 'settings-runtime.json')
  const cfg = {
    env: {
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`,
      ANTHROPIC_AUTH_TOKEN: 'cc-bridge',
      ANTHROPIC_MODEL: model,
    },
    permissions: {
      defaultMode: values.permission_mode || 'acceptEdits',
      allow: [],
      deny: [],
    },
    model,
  }
  // Tool policy: `none` blocks every tool, `all` grants everything, and `auto`
  // defers to the per-family switches below.
  const allow = []
  const deny = []
  const policy = String(values.tool_policy || 'auto')
  if (policy === 'none') {
    deny.push('Read', 'Glob', 'Grep', 'Write', 'Edit', 'NotebookEdit',
      'Bash', 'PowerShell', 'WebFetch', 'WebSearch', 'Task', 'Agent')
  } else if (policy === 'all') {
    allow.push('Read', 'Glob', 'Grep', 'Write', 'Edit', 'NotebookEdit',
      'Bash', 'PowerShell', 'WebFetch', 'WebSearch', 'Task', 'Agent')
  } else {
    // Read and search are separate switches; `allow_read` used to cover both,
    // which silently ignored `allow_glob`.
    if (values.allow_read) allow.push('Read')
    else deny.push('Read')
    if (values.allow_glob) allow.push('Glob', 'Grep')
    else deny.push('Glob', 'Grep')
    if (values.allow_write) allow.push('Write', 'Edit', 'NotebookEdit')
    else deny.push('Write', 'Edit', 'NotebookEdit')
    if (values.allow_bash) allow.push('Bash', 'PowerShell')
    else deny.push('Bash', 'PowerShell')
    if (values.allow_web) allow.push('WebFetch', 'WebSearch')
    else deny.push('WebFetch', 'WebSearch')
  }
  cfg.permissions.allow = allow
  cfg.permissions.deny = deny
  if (values.auto_approve_readonly) {
    // Read-only families never prompt: Claude Code accepts them outright.
    for (const t of ['Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch']) {
      if (deny.includes(t)) continue
      if (!allow.includes(t)) allow.push(t)
    }
    cfg.permissions.allow = allow
  }
  await writeJson(file, cfg)
  return file
}

/* --------------------------------------------------------------- build argv */

async function buildArgv(values, model, settingsPath, params) {
  const cli = await findCli(resolvedConfig)
  if (!cli) throw new Error('claude CLI 未找到：请在设置里配置 cli_path')
  const argv = [cli, '-p']
  if (params.prompt) argv.push(params.prompt)
  argv.push(
    '--output-format', 'stream-json',
    '--verbose',
    '--settings', settingsPath,
    '--model', model,
    '--permission-mode', values.permission_mode || 'acceptEdits',
  )
  if (values.permission_prompts === 'host' && params.mcpConfig) {
    argv.push('--mcp-config', params.mcpConfig)
    argv.push('--permission-prompt-tool', 'mcp__ccp-approval__approve')
  }
  if (params.resumeId) argv.push('--resume', String(params.resumeId))
  // `system_prompt` is the user's own supplement; the identity block is ours.
  // Both ride the same flag so neither can silently cancel the other.
  const supplements = []
  if (values.append_identity && params.identityBlock) supplements.push(params.identityBlock)
  if (values.system_prompt && String(values.system_prompt).trim()) {
    supplements.push(String(values.system_prompt).trim())
  }
  if (supplements.length) argv.push('--append-system-prompt', supplements.join('\n\n'))
  if (values.extra_flags) {
    for (const f of String(values.extra_flags).split(/\s+/).filter(Boolean)) argv.push(f)
  }
  return argv
}

function identityBlock(target, model) {
  const local = Boolean(target.local)
  const verdict = local ? '禁止派子代理' : '允许并应当派子代理'
  const policy = local
    ? '当前是本地部署模型 → 不派生子代理，直接用 Read/Glob/Grep 完成检索。'
    : '当前是云端模型 → 允许并应当按需派生子代理。'
  return [
    `[Runtime] 模型类别=${local ? '本地部署模型' : '云端模型'}；${verdict}。${policy}`,
    `[Runtime] provider=${target.provider || 'unknown'} model=${model}。ANTHROPIC_BASE_URL 指向本地协议桥，不代表本地模型。`,
  ].join('\n')
}

/* -------------------------------------------------------------- job runner */

async function runJob(jobId, params, target) {
  const job = await getJob(jobId)
  if (!job) return
  const settings = params.settings || await loadSettings()
  const model = params.model
  let b = null
  let proc = null

  try {
    // 1) start / reuse the protocol bridge
    ACTIVE_JOB = jobId
    if (!bridge) bridge = createBridge(ctxRef, async (body) => {
      const s = await loadSettings().catch(() => ({}))
      return {
        provider: target.provider,
        model: body.model || target.model,
        // 0 means "use the provider default": it is the field's untouched value, not a choice.
        temperature: Number(s.temperature) > 0 ? Number(s.temperature) : undefined,
        maxTokens: Number(s.max_tokens) > 0 ? Number(s.max_tokens) : undefined,
        reasoningEffort: s.reasoning_effort || undefined,
        visionMode: s.vision_mode || 'auto',
        stripImagesOnError: s.strip_images_on_error !== false,
      }
    }, { ...resolvedConfig, onStats: onBridgeStats })
    const port = bridge.port || await bridge.start()

    // 2) approval setup
    let mcpConfig = null
    if (String(settings.permission_prompts || 'none') === 'host') {
      const ap = await prepareApproval(jobId, settings)
      mcpConfig = ap.cfgPath
    }

    // 3) settings + argv
    const settingsPath = await writeClaudeSettings(job.session_key, port, model, settings, target)
    const argv = await buildArgv(settings, model, settingsPath, {
      ...params,
      mcpConfig,
      identityBlock: identityBlock(target, model),
    })
    await patchJob(jobId, { argv, pid: null, status: 'running' })
    if (settings.debug) {
      logger().info?.(`[ccp][debug] ${jobId} argv=${JSON.stringify(argv)}`)
      logger().info?.(`[ccp][debug] ${jobId} cwd=${params.cwd || settings.default_cwd || process.cwd()}`)
    }

    // 4) spawn claude.exe
    const env = { ...process.env }
    for (const k of ['ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN']) delete env[k]
    Object.assign(env, bridgeEnv(port, model))
    env.PYTHONUTF8 = '1'
    env.PYTHONIOENCODING = 'utf-8'

    const cwd = params.cwd || settings.default_cwd || process.cwd()
    proc = spawn(argv[0], argv.slice(1), {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    JOBS.set(jobId, { proc, target })
    await patchJob(jobId, { pid: proc.pid, status: 'running' })

    let stderr = ''
    proc.stderr.on('data', (c) => { stderr = (stderr + c.toString('utf-8')).slice(-4000) })

    // 5) pump stdout line by line with idle watchdog
    const idleLimit = Math.max(180, Number(params.timeout || settings.timeout || 900)) * 1000
    let lastActivity = Date.now()
    let sawText = false
    let sessionId = null

    await new Promise((resolve) => {
      let buf = ''
      const tick = setInterval(async () => {
        if (Date.now() - lastActivity > idleLimit && !proc.killed) {
          proc.kill()
          await patchJob(jobId, {
            error: `模型 ${Math.round(idleLimit / 1000)} 秒无输出，已中止本轮；可在设置里调高 timeout 后重试`,
          })
        }
      }, 1000)

      proc.stdout.on('data', async (chunk) => {
        lastActivity = Date.now()
        buf += chunk.toString('utf-8')
        let nl
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim()
          buf = buf.slice(nl + 1)
          if (!line) continue
          let obj
          try { obj = JSON.parse(line) } catch (e) {
            await pushEvent(jobId, { kind: 'log', text: line.slice(0, 400) })
            continue
          }
          const norm = normalizeStreamJson(obj)
          for (const ev of flattenEvents(norm)) {
            if (ev.kind === 'init') {
              sessionId = ev.session_id || sessionId
              await patchJob(jobId, { session_id: sessionId })
            }
            if (ev.kind === 'delta' || (ev.kind === 'blocks' && ev.blocks?.some((b) => b.type === 'text'))) {
              if (!ev.parent) sawText = true
            }
            if (ev.kind === 'result') {
              sessionId = ev.session_id || sessionId
              if (!sawText && ev.text) {
                await pushEvent(jobId, { kind: 'blocks', blocks: [{ type: 'text', text: ev.text }] })
              }
              if (!ev.ok) await patchJob(jobId, { error: String(ev.error || 'Claude Code 报告错误') })
            }
            await pushEvent(jobId, ev)
          }
        }
      })

      const finish = async (code) => {
        clearInterval(tick)
        // Grace period: the bridge reports its usage stats in a `finally` block
        // right after the HTTP response ends, which can land a few ms after the
        // CLI process exits. Wait briefly so those stats are never lost.
        await new Promise((r) => setTimeout(r, 300))
        await patchJob(jobId, { exit_code: code, stderr: stderr.slice(-2000), status: 'done', done: true })
        JOBS.delete(jobId)
        resolve()
      }
      proc.on('close', (code) => finish(code))
      proc.on('error', async (e) => {
        await patchJob(jobId, { error: String(e && e.message || e), done: true, status: 'done' })
        JOBS.delete(jobId)
        resolve()
      })
    })
  } catch (e) {
    await patchJob(jobId, { error: String(e && e.message || e), done: true, status: 'done' })
  } finally {
    // Bridge is shared across jobs; do not stop it here.
    if (ACTIVE_JOB === jobId) ACTIVE_JOB = null
  }
}

/* ------------------------------------------------------------------- HTTP util */

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'access-control-allow-origin': '*',
  })
  res.end(body)
}

async function readBody(req) {
  const chunks = []
  let size = 0
  for await (const c of req) {
    size += c.length
    if (size > 32 * 1024 * 1024) throw new Error('request too large')
    chunks.push(c)
  }
  const text = Buffer.concat(chunks).toString('utf-8')
  return text ? JSON.parse(text) : {}
}

function route(ctx, pathname, handler) {
  return ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: pathname,
      handler: async (req, res) => {
        try { await handler(req, res) }
        catch (e) {
          logger().error?.(`[ccp] ${pathname} error: ${e && e.stack || e}`)
          if (!res.headersSent) sendJson(res, 500, { error: String(e && e.message || e) })
          else try { res.end() } catch (x) { /* ignore */ }
        }
      },
    }),
  )
}

const API = '/api/claude-code-parity'

/* --------------------------------------------------------------- plugin boot */

export function apply(ctx, config = {}) {
  ctxRef = ctx
  resolvedConfig = config || {}
  ensureDirs()

  // Shared protocol bridge: resolve model per request from the live DSH catalog.
  // `ensureSelection()` guarantees the pair actually exists in this profile.
  bridge = createBridge(ctx, async (body) => {
    const sel = await ensureSelection()
    const s = await loadSettings().catch(() => ({}))
    return {
      provider: (sel && sel.provider) || config.defaultProvider || '',
      model: body.model || (sel && sel.model) || config.defaultModel || '',
      // Sampling controls live on the settings surface but are applied here,
      // because the Anthropic request the CLI sends carries no temperature.
      // 0 means "use the provider default": it is the field's untouched value.
      temperature: Number(s.temperature) > 0 ? Number(s.temperature) : undefined,
      maxTokens: Number(s.max_tokens) > 0 ? Number(s.max_tokens) : undefined,
      reasoningEffort: s.reasoning_effort || undefined,
      visionMode: s.vision_mode || 'auto',
      stripImagesOnError: s.strip_images_on_error !== false,
    }
  }, { ...config, onStats: onBridgeStats })

  const disposers = []
  disposers.push(ctx.effect(() => bridge.start().catch((e) =>
    logger().warn?.(`[ccp] bridge start failed: ${e && e.message}`))))

  /* ---- official Claude logo asset ---- */
  disposers.push(route(ctx, `${API}/asset/logo`, async (req, res) => {
    try {
      const logo = path.join(import.meta.dirname, '..', 'assets', 'claude-logo.png')
      const buf = await fsp.readFile(logo)
      res.writeHead(200, { 'content-type': 'image/png', 'content-length': buf.length, 'cache-control': 'public, max-age=86400' })
      res.end(buf)
    } catch (e) {
      res.writeHead(404); res.end('not found')
    }
  }))

  /* ---- health ---- */
  disposers.push(route(ctx, `${API}/health`, async (req, res) => {
    sendJson(res, 200, {
      ok: true,
      plugin: name,
      version: '2.5.1',
      runtime: 'dsh',
      bridge: { port: bridge.port, baseURL: bridge.baseURL },
      cli: await findCli(config),
      pid: process.pid,
      bootedAt: Date.now(),
    })
  }))

  /* ---- workspaces (from DSH's own workspace storage) ---- */
  disposers.push(route(ctx, `${API}/workspaces`, async (req, res) => {
    const out = []
    // DSH stores workspace folders in ~/.dsh/storages/workspace.json ({tables:...})
    // Fall back to the profiles' configured default cwd.
    try {
      const store = await readJson(path.join(dshHome(), 'storages', 'workspace.json'), {})
      const tables = store.tables || {}
      const collect = (node) => {
        if (!node || typeof node !== 'object') return
        if (Array.isArray(node)) { node.forEach(collect); return }
        if (node.path && typeof node.path === 'string') {
          out.push({ path: node.path, name: node.name || path.basename(node.path) })
        }
        for (const k of Object.keys(node)) {
          if (k !== 'path' && k !== 'name') collect(node[k])
        }
      }
      collect(tables)
    } catch (e) { /* ignore */ }
    // Also include the known AI_Workspace roots under the primary workspace.
    const aiw = 'C:/AI_Workspace'
    if (fs.existsSync(aiw) && !out.some((w) => w.path === aiw)) {
      out.push({ path: aiw, name: 'AI_Workspace' })
    }
    sendJson(res, 200, { workspaces: out, defaultCwd: (await loadSettings()).default_cwd || '' })
  }))

  /* ---- models ---- */
  disposers.push(route(ctx, `${API}/models`, async (req, res) => {    const force = new URL(req.url, 'http://x').searchParams.get('force') === 'true'
    const models = await modelCatalog(force)
    const selected = await ensureSelection()
    sendJson(res, 200, { models, selected })
  }))

  disposers.push(route(ctx, `${API}/model/select`, async (req, res) => {
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'method-not-allowed' })
    const body = await readBody(req)
    selectedModel = { provider: body.provider, model: body.model }
    const settings = await loadSettings()
    settings.provider = body.provider
    settings.model = body.model
    await saveSettings(settings)
    sendJson(res, 200, { ok: true, selected: selectedModel })
  }))

  /* ---- settings ---- */
  disposers.push(route(ctx, `${API}/settings`, async (req, res) => {
    if (req.method === 'GET') {
      const values = await loadSettings()
      sendJson(res, 200, { groups: SETTING_GROUPS, items: SETTINGS_ITEMS, values })
      return
    }
    if (req.method === 'POST') {
      const body = await readBody(req)
      const current = await loadSettings()
      const next = { ...current }
      for (const it of SETTINGS_ITEMS) {
        if (Object.prototype.hasOwnProperty.call(body, it.key)) next[it.key] = coerce(it, body[it.key])
      }
      await saveSettings(next)
      // `cli_path` must reach the resolver immediately, not after a reload.
      resolvedConfig = { ...resolvedConfig, cliPath: next.cli_path || '' }
      if (next.debug) logger().info?.('[ccp] settings saved: ' + JSON.stringify(next))
      sendJson(res, 200, { ok: true, values: next })
      return
    }
    sendJson(res, 405, { error: 'method-not-allowed' })
  }))

  disposers.push(route(ctx, `${API}/settings/reset`, async (req, res) => {
    const def = defaultSettings()
    await saveSettings(def)
    sendJson(res, 200, { ok: true, values: def })
  }))

  /* ---- cli info ---- */
  disposers.push(route(ctx, `${API}/cli`, async (req, res) => {
    const cli = await findCli(config)
    let version = ''
    if (cli) {
      try {
        const { stdout } = await execFileAsync(cli, ['--version'], { timeout: 8000, windowsHide: true })
        version = stdout.trim().split(/\r?\n/)[0]
      } catch (e) { version = String(e && e.message || '') }
    }
    sendJson(res, 200, { path: cli, version, ok: Boolean(cli) })
  }))

  /* ---- title (LLM-generated) ---- */
  disposers.push(route(ctx, `${API}/title`, async (req, res) => {
    const body = await readBody(req)
    const text = String(body.text || '').slice(0, 2000)
    let title = text.replace(/\s+/g, ' ').slice(0, 24)
    try {
      const target = await resolveTarget(body)
      let out = ''
      for await (const chunk of ctx.llm.stream({
        provider: target.provider,
        model: target.model,
        messages: [{ role: 'user', content: [{ type: 'text', text: `为下面这段对话起一个不超过 20 字的中文标题，只输出标题本身：\n${text}` }] }],
        maxTokens: 64,
      })) {
        if (chunk.type === 'text-delta') out += chunk.text
      }
      // Accept the model's title only when it actually looks like a title.
      const candidate = out.trim().replace(/^["'「『]|["'」』]$/g, '').slice(0, 40)
      if (candidate.length >= 2 && /[\u4e00-\u9fa5A-Za-z]/.test(candidate)) title = candidate
    } catch (e) { /* fall back to trimmed text */ }
    sendJson(res, 200, { title })
  }))

  /* ---- chat (start a job) ---- */
  disposers.push(route(ctx, `${API}/chat`, async (req, res) => {
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'method-not-allowed' })
    const body = await readBody(req)
    const settings = await loadSettings()
    const target = await resolveTarget(body)
    const sessionKey = String(body.session_key || body.session_id || randomUUID())
    const job = await createJob({
      session_key: sessionKey,
      status: 'queued',
      target,
    })
    runJob(job.id, {
      ...body,
      prompt: String(body.text || body.prompt || ''),
      settings,
      model: target.model,
      session_key: sessionKey,
      resumeId: body.resume_id || body.resumeId || '',
      cwd: body.cwd || settings.default_cwd || '',
    }, target).catch((e) => logger().error?.(`[ccp] runJob ${job.id}: ${e && e.stack || e}`))
    sendJson(res, 200, { ok: true, job_id: job.id, session_key: sessionKey, model: target.model })
  }))

  /* ---- poll job events ---- */
  disposers.push(route(ctx, `${API}/poll`, async (req, res) => {
    const q = new URL(req.url, 'http://x').searchParams
    const jobId = q.get('job_id') || ''
    const cursor = Number(q.get('cursor') || 0)
    const job = await getJob(jobId)
    if (!job) return sendJson(res, 404, { error: 'job-not-found' })
    const events = (job.events || []).slice(cursor)
    sendJson(res, 200, {
      events,
      cursor: cursor + events.length,
      done: Boolean(job.done),
      error: job.error || null,
      session_id: job.session_id || null,
      exit_code: job.exit_code,
    })
  }))

  /* ---- cancel ---- */
  disposers.push(route(ctx, `${API}/cancel`, async (req, res) => {
    const body = req.method === 'POST' ? await readBody(req) : {}
    const jobId = body.job_id || new URL(req.url, 'http://x').searchParams.get('job_id')
    const entry = JOBS.get(jobId)
    if (entry && entry.proc && !entry.proc.killed) {
      entry.proc.kill()
      await patchJob(jobId, { done: true, status: 'cancelled', error: '已取消' })
    }
    sendJson(res, 200, { ok: true })
  }))

  /* ---- approvals ---- */
  disposers.push(route(ctx, `${API}/approvals`, async (req, res) => {
    const q = new URL(req.url, 'http://x').searchParams
    const jobId = q.get('job_id')
    const all = []
    if (jobId) all.push(...await pendingApprovals(jobId))
    else {
      for (const id of JOBS.keys()) all.push(...await pendingApprovals(id))
    }
    sendJson(res, 200, { approvals: all })
  }))

  disposers.push(route(ctx, `${API}/approvals/decide`, async (req, res) => {
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'method-not-allowed' })
    const body = await readBody(req)
    const { job_id, id, decision } = body // decision: allow | allow-always | deny
    if (!job_id || !id || !decision) return sendJson(res, 400, { error: 'missing-params' })
    const dir = approvalDir(job_id)
    await fsp.mkdir(dir, { recursive: true })
    await writeJson(path.join(dir, `dec-${id}.json`), {
      id,
      decision,
      decidedAt: Date.now(),
    })
    sendJson(res, 200, { ok: true })
  }))

  /* ---- upload ---- */
  disposers.push(route(ctx, `${API}/upload`, async (req, res) => {
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'method-not-allowed' })
    const body = await readBody(req)
    const name = safeName(body.name || 'attachment')
    const sessionKey = safeName(body.session_key || 'default')
    const uid = shortHash(name + Date.now())
    const dir = path.join(dataRoot(), 'uploads', sessionKey, uid)
    await fsp.mkdir(dir, { recursive: true })
    const data = String(body.data || '')
    let buf
    if (body.base64) {
      buf = Buffer.from(data.replace(/^data:[^;]+;base64,/, ''), 'base64')
    } else {
      buf = Buffer.from(data, 'utf-8')
    }
    const file = path.join(dir, name)
    await fsp.writeFile(file, buf)
    const text = body.text || ''
    sendJson(res, 200, { ok: true, path: file, name, uid, kind: body.kind || 'file', text })
  }))

  /* ---- serve uploaded file ---- */
  disposers.push(ctx.effect(() =>
    ctx.webServer.register({
      kind: 'prefix',
      path: `${API}/uploads/`,
      handler: async (req, res) => {
        try {
          const rel = decodeURIComponent((req.url || '').split('?')[0].slice(`${API}/uploads/`.length))
          const file = path.join(dataRoot(), 'uploads', rel)
          const resolved = path.resolve(file)
          const base = path.resolve(path.join(dataRoot(), 'uploads'))
          if (!resolved.startsWith(base + path.sep)) {
            res.writeHead(403); res.end('forbidden'); return
          }
          const buf = await fsp.readFile(resolved)
          const ext = path.extname(resolved).toLowerCase()
          const mime = {
            '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
            '.gif': 'image/gif', '.webp': 'image/webp', '.pdf': 'application/pdf',
            '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
          }[ext] || 'application/octet-stream'
          res.writeHead(200, { 'content-type': mime, 'content-length': buf.length })
          res.end(buf)
        } catch (e) {
          res.writeHead(404); res.end('not found')
        }
      },
    }),
  ))

  /* ---- catalog (providers/models/tables) ---- */
  disposers.push(route(ctx, `${API}/catalog`, async (req, res) => {
    sendJson(res, 200, { models: await modelCatalog(true) })
  }))

  /* ---- sessions (plugin-owned) ---- */
  disposers.push(route(ctx, `${API}/history`, async (req, res) => {
    const q = new URL(req.url, 'http://x').searchParams
    const cfg = await loadSettings()
    // `history_limit` is the list cap; an explicit ?limit= still wins.
    const limit = Number(q.get('limit') || cfg.history_limit || 300)
    const pluginSessions = await listSessions()
    const rawCli = await scanClaudeHistory(
      claudeProjectsDir(config.claudeProjectsDir),
      limit,
    )
    const cliSessions = await mergeCliMeta(await ensureCliTitles(
      rawCli, claudeProjectsDir(config.claudeProjectsDir),
    ))
    const seen = new Set(pluginSessions.map((s) => s.key || s.id))
    // A plugin-owned conversation and its Claude CLI transcript are the same
    // thread — hide the raw transcript entry so the list has no duplicates.
    for (const s of pluginSessions) if (s.cli_session_id) seen.add(s.cli_session_id)
    const merged = [
      ...[...EPHEMERAL.values()].map((s) => ({ ...s, source: 'plugin', ephemeral: true })),
      ...pluginSessions.filter((s) => !s.deleted).map((s) => ({ ...s, source: 'plugin' })),
      ...cliSessions.filter((s) => !seen.has(s.id) && !s.deleted),
    ].sort((a, b) => (b.updated || 0) - (a.updated || 0)).slice(0, limit)
    sendJson(res, 200, { sessions: merged, limit })
  }))

  disposers.push(route(ctx, `${API}/history/session`, async (req, res) => {
    const id = new URL(req.url, 'http://x').searchParams.get('id') || ''
    const ephemeral = EPHEMERAL.get(id)
    if (ephemeral) return sendJson(res, 200, { session: ephemeral, messages: ephemeral.messages || [] })
    const plugin = await getSession(id)
    if (plugin) return sendJson(res, 200, { session: plugin, messages: plugin.messages || [] })
    const cli = await scanClaudeHistory(claudeProjectsDir(config.claudeProjectsDir), 5000)
    const hit = cli.find((s) => s.id === id)
    if (!hit) return sendJson(res, 404, { error: 'session-not-found' })
    const meta = await getCliMeta(id)
    const messages = await readCliTranscript(hit.file)
    sendJson(res, 200, {
      session: { ...hit, ...meta, title: meta.title || '', cli_session_id: id },
      messages,
    })
  }))

  /** Merge a CLI transcript into a plugin-owned branch/session copy. */
  disposers.push(route(ctx, `${API}/history/branch`, async (req, res) => {
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'method-not-allowed' })
    const body = await readBody(req)
    const id = body.id || body.key
    if (!id) return sendJson(res, 400, { error: 'missing-id' })
    const plugin = await getSession(id)
    let messages = plugin?.messages || []
    let meta = {}
    if (!plugin) {
      const cli = await scanClaudeHistory(claudeProjectsDir(config.claudeProjectsDir), 5000)
      const hit = cli.find((s) => s.id === id)
      if (!hit) return sendJson(res, 404, { error: 'session-not-found' })
      messages = await readCliTranscript(hit.file)
      meta = await getCliMeta(id)
    }
    const key = body.new_id || ('branch-' + randomUUID())
    const sess = {
      key,
      id: key,
      title: body.title || `${(meta.title || plugin?.title || id)} · 分支`,
      messages,
      created: Date.now(),
      updated: Date.now(),
      pinned: false,
      archived: false,
      cwd: body.cwd || meta.cwd || '',
      cli_session_id: body.resume !== false ? id : '',
    }
    await putSession(sess)
    sendJson(res, 200, { ok: true, session: sess })
  }))

  disposers.push(route(ctx, `${API}/history/save`, async (req, res) => {
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'method-not-allowed' })
    const body = await readBody(req)
    const key = body.key || body.id || randomUUID()
    const id = body.id || body.session_id || key
    const prev = await getSession(id)
    const sess = {
      key,
      id,
      title: body.title || prev?.title || '',
      topic: body.topic || prev?.topic || '',
      messages: body.messages || [],
      updated: Date.now(),
      created: body.created || prev?.created || Date.now(),
      pinned: body.pinned !== undefined ? Boolean(body.pinned) : Boolean(prev?.pinned),
      archived: body.archived !== undefined ? Boolean(body.archived) : Boolean(prev?.archived),
      turn: body.turn || 0,
      // Extra fields used by the v2 UI (resume / grouping / workspace).
      cli_session_id: body.cli_session_id || prev?.cli_session_id || '',
      cwd: body.cwd || prev?.cwd || '',
      group: body.group || prev?.group || '',
    }
    const settings = await loadSettings()
    if (settings.keep_history === false) {
      // "不保留历史" keeps the thread alive for this process only.
      EPHEMERAL.set(id, sess)
      return sendJson(res, 200, { ok: true, session: sess, persisted: false })
    }
    EPHEMERAL.delete(id)
    await putSession(sess)
    sendJson(res, 200, { ok: true, session: sess, persisted: true })
  }))

  for (const action of ['rename', 'archive', 'delete', 'restore', 'purge', 'flags', 'move']) {
    disposers.push(route(ctx, `${API}/history/${action}`, async (req, res) => {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'method-not-allowed' })
      const body = await readBody(req)
      const id = body.id || body.key
      if (!id) return sendJson(res, 400, { error: 'missing-id' })
      const sess = await getSession(id)
      if (sess) {
        if (action === 'rename') sess.title = String(body.title || sess.title)
        else if (action === 'archive') sess.archived = body.archived !== false
        else if (action === 'restore') { sess.archived = false; sess.deleted = false }
        else if (action === 'flags') Object.assign(sess, body.flags || {})
        else if (action === 'move') {
          sess.project = body.project || body.group || sess.project
          sess.group = body.group || body.project || sess.group
        } else if (action === 'purge') {
          // Permanent removal is only reachable through the explicit purge action.
          await deleteSession(id)
          return sendJson(res, 200, { ok: true, source: 'plugin' })
        } else if (action === 'delete') {
          // "删除" moves the session into the recycle bin so it stays recoverable.
          sess.archived = true
        }
        sess.updated = Date.now()
        await putSession(sess)
        // The Claude CLI transcript of this thread is a separate record. Hide it
        // too, otherwise it pops back into the list under the same title and the
        // delete looks like it did nothing.
        if (sess.cli_session_id && (action === 'delete' || action === 'purge' || action === 'archive')) {
          await putCliMeta(sess.cli_session_id, { archived: true }).catch(() => {})
        }
        return sendJson(res, 200, { ok: true, session: sess, source: 'plugin' })
      }

      // CLI transcripts are read-only. Keep the .jsonl intact and store an
      // editable overlay (title/pin/archive/group/deleted) instead.
      const cli = await scanClaudeHistory(claudeProjectsDir(config.claudeProjectsDir), 5000)
      const hit = cli.find((s) => s.id === id)
      if (!hit) return sendJson(res, 404, { error: 'session-not-found' })
      const patch = {}
      if (action === 'rename') patch.title = String(body.title || '')
      else if (action === 'archive') patch.archived = body.archived !== false
      else if (action === 'restore') { patch.archived = false; patch.deleted = false }
      else if (action === 'flags') Object.assign(patch, body.flags || {})
      else if (action === 'move') patch.group = body.group || body.project || ''
      else if (action === 'delete') patch.archived = true
      else if (action === 'purge') patch.deleted = true
      const meta = await putCliMeta(id, patch)
      sendJson(res, 200, { ok: true, session: { ...hit, ...meta }, source: 'cli' })
    }))
  }

  disposers.push(route(ctx, `${API}/history/trash`, async (req, res) => {
    const all = await listSessions()
    const cli = await mergeCliMeta(await scanClaudeHistory(claudeProjectsDir(config.claudeProjectsDir), 300))
    // A plugin thread and its CLI transcript are one conversation: never list
    // the raw transcript twice (that is what made deletes look like no-ops).
    const twins = new Set()
    for (const s of all) if (s.cli_session_id) twins.add(s.cli_session_id)
    sendJson(res, 200, {
      sessions: [
        ...all.filter((s) => s.archived),
        ...cli.filter((s) => s.archived && !s.deleted && !twins.has(s.id)),
      ],
    })
  }))

  disposers.push(route(ctx, `${API}/history/terminal`, async (req, res) => {
    const body = req.method === 'POST' ? await readBody(req) : {}
    // Best-effort: open a terminal at the session's cwd via the host shell.
    const cwd = body.cwd || (await loadSettings()).default_cwd || process.cwd()
    sendJson(res, 200, { ok: true, cwd, note: '请在 DSH 终端面板中打开该目录' })
  }))

  disposers.push(route(ctx, `${API}/history/export`, async (req, res) => {
    const body = await readBody(req)
    const id = body.id || body.key
    let sess = await getSession(id)
    if (!sess) {
      // CLI transcripts have no plugin record; export them from the raw thread
      // instead of returning 404 (they are listed in the sidebar too).
      const cli = await scanClaudeHistory(claudeProjectsDir(config.claudeProjectsDir), 5000)
      const hit = cli.find((s) => s.id === id)
      if (!hit) return sendJson(res, 404, { error: 'session-not-found' })
      const meta = await getCliMeta(id)
      sess = {
        id,
        title: meta.title || hit.title || id,
        messages: await readCliTranscript(hit.file),
      }
    }
    const settings = await loadSettings()
    const format = String(body.format || settings.export_format || 'markdown') === 'txt' ? 'txt' : 'markdown'
    const lines = []
    if (format === 'markdown') lines.push(`# ${sess.title || sess.id}`, '')
    else lines.push(String(sess.title || sess.id), '='.repeat(24), '')
    for (const m of sess.messages || []) {
      lines.push(
        format === 'markdown' ? `## ${m.role === 'user' ? '用户' : '助手'}` : `[${m.role === 'user' ? '用户' : '助手'}]`,
        '', String(m.text || ''), '',
      )
    }
    const text = lines.join('\n')
    sendJson(res, 200, {
      ok: true,
      format,
      markdown: text,
      content: text,
      filename: safeName(sess.title || sess.id) + (format === 'txt' ? '.txt' : '.md'),
    })
  }))

  /* ---- upgrade: real registry lookup + real install ---- */
  const upgradeStateFile = path.join(dataRoot(), 'upgrade-state.json')

  disposers.push(route(ctx, `${API}/upgrade/check`, async (req, res) => {
    const cli = await findCli(config)
    if (!cli) {
      return sendJson(res, 200, {
        ok: false, current: '', latest: '', hasUpdate: false,
        error: '未找到 claude CLI，请先在「高级 → claude CLI 路径」里指定可执行文件',
        checkedAt: Date.now(),
      })
    }
    // Prefer package.json: `--version` prints "2.1.325 (Claude Code)" on some builds.
    let current = await installedCliVersion(cli).catch(() => '')
    if (!current) {
      try {
        const { stdout } = await execFileAsync(cli, ['--version'], { timeout: 15000, windowsHide: true })
        current = (stdout.trim().split(/\r?\n/)[0] || '').match(/\d+(?:\.\d+)+/)?.[0] || ''
      } catch (e) { /* leave blank */ }
    }
    let latest = ''
    let error = ''
    try {
      const meta = await httpGetJson('https://registry.npmjs.org/@anthropic-ai/claude-code/latest')
      latest = String(meta.version || '')
      if (!latest) error = 'registry 未返回 version 字段'
    } catch (e) {
      error = String(e && e.message || e)
    }
    const hasUpdate = Boolean(current && latest && compareVersions(latest, current) > 0)
    sendJson(res, 200, {
      ok: !error,
      current,
      latest,
      hasUpdate,
      upToDate: Boolean(current && latest && compareVersions(latest, current) <= 0),
      error,
      registry: 'https://registry.npmjs.org/@anthropic-ai/claude-code',
      cli,
      installRoot: cliInstallLayout(cli).root,
      checkedAt: Date.now(),
    })
  }))

  disposers.push(route(ctx, `${API}/upgrade/status`, async (req, res) => {
    const log = await readJson(upgradeStateFile, {})
    sendJson(res, 200, { ...log, running: Boolean(UPGRADE && UPGRADE.proc && !UPGRADE.proc.killed) })
  }))

  disposers.push(route(ctx, `${API}/upgrade`, async (req, res) => {
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'method-not-allowed' })
    const body = await readBody(req)
    if (UPGRADE && UPGRADE.proc && !UPGRADE.proc.killed) {
      return sendJson(res, 409, { error: '已有更新任务在运行，请稍候' })
    }
    const cli = await findCli(config)
    if (!cli) return sendJson(res, 500, { error: 'claude CLI 未找到' })
    const layout = cliInstallLayout(cli)
    const npmCmd = await findNpm()
    if (!npmCmd) return sendJson(res, 500, { error: '未找到 npm，请先安装 Node.js 或把 npm 加入 PATH' })

    const target = String(body.version || 'latest')
    const spec = `@anthropic-ai/claude-code@${target}`
    // A local install is owned by the package.json in its root; a global one
    // must be updated with -g. Running the wrong one is why "更新" did nothing.
    const local = await readJson(path.join(layout.root, 'package.json'), null)
    const isLocal = Boolean(local && (local.dependencies?.['@anthropic-ai/claude-code']
      || local.devDependencies?.['@anthropic-ai/claude-code']))
    const cwd = isLocal ? layout.root : os.homedir()
    const args = isLocal
      ? ['install', spec, '--no-audit', '--no-fund', '--save-exact=false']
      : ['install', '-g', spec, '--no-audit', '--no-fund']

    const before = await installedCliVersion(cli).catch(() => '')
    const started = Date.now()
    const state = {
      running: true, ok: null, mode: isLocal ? 'local' : 'global',
      cwd, command: `${npmCmd} ${args.join(' ')}`, before, target, log: '',
      started, finished: null, error: '',
    }
    await writeJson(upgradeStateFile, state)

    let proc
    try {
      proc = spawn(npmCmd, args, {
        cwd,
        // .cmd shims need a shell on Windows; the args contain no spaces.
        shell: process.platform === 'win32',
        windowsHide: true,
        env: { ...process.env, npm_config_yes: 'true', npm_config_fund: 'false' },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (e) {
      await writeJson(upgradeStateFile, { ...state, running: false, ok: false, error: String(e && e.message || e), finished: Date.now() })
      return sendJson(res, 500, { error: String(e && e.message || e) })
    }
    UPGRADE = { proc }

    let log = ''
    let lastFlush = 0
    const append = (chunk) => {
      log = (log + chunk.toString('utf-8')).slice(-20000)
      const now = Date.now()
      if (now - lastFlush < 400) return
      lastFlush = now
      writeJson(upgradeStateFile, { ...state, log }).catch(() => {})
    }
    proc.stdout.on('data', append)
    proc.stderr.on('data', append)

    proc.on('error', (e) => {
      writeJson(upgradeStateFile, {
        ...state, running: false, ok: false, log,
        error: String(e && e.message || e), finished: Date.now(),
      }).catch(() => {})
      UPGRADE = null
    })
    proc.on('close', async (code) => {
      const after = await installedCliVersion(cli).catch(() => '')
      let error = ''
      if (code !== 0) {
        error = log.includes('EBUSY') || log.includes('EPERM')
          ? '文件被占用：请先停止正在运行的 Claude Code 任务（或退出 DSH）后重试'
          : `npm 退出码 ${code}`
      }
      await writeJson(upgradeStateFile, {
        ...state, running: false, ok: code === 0, log, after,
        error, finished: Date.now(),
        changed: Boolean(after && before && compareVersions(after, before) > 0),
      }).catch(() => {})
      UPGRADE = null
    })

    sendJson(res, 200, { ok: true, started: true, mode: state.mode, cwd, command: state.command, before })
  }))

  /* ---- mobile: LAN-facing web instance on this machine's Wi-Fi address ---- */
  const mobileStateFile = path.join(dataRoot(), 'mobile-state.json')

  const mobileSnapshot = async () => {
    const saved = await readJson(mobileStateFile, {})
    const running = Boolean(MOBILE && MOBILE.proc && !MOBILE.proc.killed)
    return {
      ...saved,
      running,
      host: MOBILE?.host || saved.host || '',
      port: MOBILE?.port || saved.port || 0,
      url: running ? (MOBILE?.url || saved.url || '') : '',
      // The token URL is long; the short address only redirects to it.
      shortUrl: running ? (MOBILE?.shortUrl || saved.shortUrl || '') : '',
      pid: MOBILE?.proc?.pid || saved.pid || null,
    }
  }

  const stopMobile = async () => {
    if (MOBILE?.proc && !MOBILE.proc.killed) {
      try { MOBILE.proc.kill() } catch (e) { /* ignore */ }
    }
    if (MOBILE?.redirect) {
      try { MOBILE.redirect.close() } catch (e) { /* ignore */ }
    }
    MOBILE = null
    const saved = await readJson(mobileStateFile, {})
    await writeJson(mobileStateFile, { ...saved, running: false, stopped: Date.now() })
  }

  disposers.push(route(ctx, `${API}/mobile`, async (req, res) => {
    sendJson(res, 200, {
      enabled: true,
      interfaces: lanAddresses(),
      // DSH rejects the wildcard bind, so the phone must hit a concrete literal.
      note: '同一 Wi-Fi 下用手机打开下面的链接即可使用完整的 DSH 界面（含本插件）',
      profile: currentProfileName(),
      state: await mobileSnapshot(),
    })
  }))

  disposers.push(route(ctx, `${API}/mobile/start`, async (req, res) => {
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'method-not-allowed' })
    const body = await readBody(req)
    if (MOBILE && MOBILE.proc && !MOBILE.proc.killed) {
      return sendJson(res, 200, { ok: true, already: true, state: await mobileSnapshot() })
    }
    const list = lanAddresses()
    const host = String(body.host || list[0]?.address || '')
    if (!host) return sendJson(res, 400, { error: '本机没有可用的局域网 IPv4 地址（请确认已连上 Wi-Fi）' })
    const port = Number(body.port || 9240)
    const { exe, cli } = dshCliEntry()
    try { await fsp.access(cli) } catch (e) {
      return sendJson(res, 500, { error: '找不到 DSH 自带的 web 入口，无法启动手机访问实例' })
    }
    const profile = String(body.profile || currentProfileName())
    const args = ['--expose-internals', cli,
      '--profile', profile,
      '--host', host, '--port', String(port), '--no-open',
      '--trusted-host', `${host}:${port}`]

    let proc
    try {
      proc = spawn(exe, args, {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (e) {
      return sendJson(res, 500, { error: String(e && e.message || e) })
    }

    let out = ''
    let settled = false
    const url = await new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (!settled) { settled = true; resolve('') }
      }, 90000)
      const scan = () => {
        const m = /dsh web:\s*(https?:\/\/\S+)/.exec(out)
        if (m && !settled) { settled = true; clearTimeout(timer); resolve(m[1]) }
      }
      proc.stdout.setEncoding('utf-8')
      proc.stdout.on('data', (c) => { out = (out + c).slice(-8000); scan() })
      proc.stderr.setEncoding('utf-8')
      proc.stderr.on('data', (c) => { out = (out + c).slice(-8000); scan() })
      proc.on('error', (e) => {
        out += '\n' + String(e && e.message || e)
        if (!settled) { settled = true; clearTimeout(timer); resolve('') }
      })
      proc.on('close', () => {
        if (!settled) { settled = true; clearTimeout(timer); resolve('') }
      })
    })

    if (!url) {
      try { proc.kill() } catch (e) { /* ignore */ }
      const tail = out.trim().split(/\r?\n/).filter(Boolean).slice(-4).join(' | ')
      return sendJson(res, 500, {
        error: '手机访问实例未能启动' + (tail ? '：' + tail : '（60 秒内没有打印访问地址）'),
        log: tail,
      })
    }

    // Short, typeable address: the phone only needs host:shortPort, and this
    // listener 302s straight to the tokenised URL that mints the session cookie.
    const shortPort = Number(body.shortPort || (port + 1))
    let redirect = null
    let shortUrl = ''
    try {
      redirect = http.createServer((rq, rs) => {
        rs.writeHead(302, { location: url, 'cache-control': 'no-store' })
        rs.end()
      })
      await new Promise((resolve, reject) => {
        redirect.once('error', reject)
        // Our own listener is not bound by DSH's wildcard ban.
        redirect.listen(shortPort, '0.0.0.0', resolve)
      })
      shortUrl = `http://${host}:${shortPort}`
    } catch (e) {
      try { redirect?.close() } catch (x) { /* ignore */ }
      redirect = null
      shortUrl = ''
    }

    MOBILE = { proc, host, port, url, shortUrl, redirect }
    proc.on('close', () => {
      if (MOBILE?.proc !== proc) return
      try { MOBILE.redirect?.close() } catch (e) { /* ignore */ }
      MOBILE = null
    })
    await writeJson(mobileStateFile, {
      running: true, host, port, url, shortUrl, pid: proc.pid, profile, started: Date.now(),
    })
    sendJson(res, 200, { ok: true, state: await mobileSnapshot() })
  }))

  disposers.push(route(ctx, `${API}/mobile/stop`, async (req, res) => {
    await stopMobile()
    sendJson(res, 200, { ok: true, state: await mobileSnapshot() })
  }))

  /* ---- relay (kept for front-end compatibility; DSH uses its own webServer) ---- */
  disposers.push(route(ctx, `${API}/relay`, async (req, res) => {
    sendJson(res, 200, { enabled: false, note: 'DSH 原生插件走 webServer，无需 relay' })
  }))

  /* ---- catalog/probe kept as a no-op-compatible endpoint ---- */
  disposers.push(route(ctx, `${API}/probe`, async (req, res) => {
    sendJson(res, 200, { ok: true, providers: (ctxRef?.llm?.listProviders?.() || []) })
  }))

  return () => {
    for (const d of disposers.reverse()) {
      try { if (typeof d === 'function') d() } catch (e) { /* ignore */ }
    }
    for (const { proc } of JOBS.values()) {
      try { proc?.kill() } catch (e) { /* ignore */ }
    }
    JOBS.clear()
    try { if (MOBILE?.proc && !MOBILE.proc.killed) MOBILE.proc.kill() } catch (e) { /* ignore */ }
    try { MOBILE?.redirect?.close() } catch (e) { /* ignore */ }
    MOBILE = null
    try { if (UPGRADE?.proc && !UPGRADE.proc.killed) UPGRADE.proc.kill() } catch (e) { /* ignore */ }
    UPGRADE = null
    bridge?.stop?.().catch(() => {})
    bridge = null
  }
}

export default { name, inject, apply }
