/**
 * Claude Code Parity for DSH — shared helpers: paths, settings schema,
 * persistence, JSONL session scanning, and Claude stream-json normalization.
 *
 * Data layout (under DSH_HOME/ccp-data/, or HOME/.dsh/ccp-data/):
 *   settings.json          full 107-key settings surface (CLI flags + extras)
 *   sessions/<key>.json    plugin-owned conversations
 *   cli-meta/<id>.json     editable metadata over read-only CLI transcripts
 *   jobs/<id>.json         live job state + event queue
 *   approvals/<job>/...    tool approval request/response files
 *   uploads/<key>/<uid>/   attachments
 *   upgrade.log
 */

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { randomUUID, createHash } from 'node:crypto'

/* ------------------------------------------------------------------ paths */

export function dshHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
}

export function dataRoot() {
  return path.join(dshHome(), 'ccp-data')
}

export function ensureDirs() {
  const root = dataRoot()
  for (const sub of ['sessions', 'cli-meta', 'jobs', 'approvals', 'uploads']) {
    fs.mkdirSync(path.join(root, sub), { recursive: true })
  }
  return root
}

export function safeName(name) {
  return String(name || '').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120) || 'item'
}

export async function readJson(file, fallback) {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf-8'))
  } catch (e) {
    return fallback
  }
}

export async function writeJson(file, obj) {
  await fsp.mkdir(path.dirname(file), { recursive: true })
  const tmp = file + '.tmp-' + process.pid + '-' + Math.random().toString(36).slice(2, 8)
  await fsp.writeFile(tmp, JSON.stringify(obj, null, 2), 'utf-8')
  // On Windows, renaming onto a file that another process has open fails with
  // EPERM/EBUSY — and that is the normal case here: the desktop app, a phone
  // access instance and a verification instance all share ~/.dsh/ccp-data, so a
  // poll can be reading a job at the very moment it is written. The lock clears
  // within milliseconds, so retry rather than let a transient share violation
  // abort the whole turn (it surfaced as "dsh: fatal load failure").
  for (let i = 0; i < 12; i++) {
    try {
      await fsp.rename(tmp, file)
      return
    } catch (e) {
      if (e.code !== 'EPERM' && e.code !== 'EBUSY' && e.code !== 'EACCES') {
        await fsp.unlink(tmp).catch(() => {})
        throw e
      }
      await new Promise((r) => setTimeout(r, 20 + i * 20))
    }
  }
  // Still locked: write through the handle instead of replacing the file. This
  // is not atomic, but losing one job snapshot beats failing the request.
  try {
    await fsp.writeFile(file, JSON.stringify(obj, null, 2), 'utf-8')
  } finally {
    await fsp.unlink(tmp).catch(() => {})
  }
}

/* --------------------------------------------------------------- settings */

/** The settings surface is declared as groups of items; each item maps a
 *  settings.json dotted path (and optionally a CLI flag) to a typed value.
 *  Keep the count in docs/configuration.md in sync — the verification suite
 *  asserts every item round-trips. */
const I = (key, group, label, typ, def, opts = {}) => ({
  key, group, label, type: typ, default: def, ...opts,
})

export const SETTING_GROUPS = [
  { id: 'general', label: { zh: '常规', en: 'General' } },
  { id: 'appearance', label: { zh: '外观', en: 'Appearance' } },
  { id: 'tools', label: { zh: '工具与权限', en: 'Tools & Permissions' } },
  { id: 'model', label: { zh: '模型', en: 'Model' } },
  { id: 'session', label: { zh: '会话', en: 'Session' } },
  { id: 'advanced', label: { zh: '高级', en: 'Advanced' } },
]

export const SETTINGS_ITEMS = [
  // --- general
  I('default_cwd', 'general', '默认工作目录', 'path', ''),
  I('permission_mode', 'general', '权限模式', 'enum', 'acceptEdits', { options: ['acceptEdits', 'auto', 'manual', 'plan', 'dontAsk', 'bypassPermissions'] }),
  I('permission_prompts', 'general', '工具审批', 'enum', 'host', { options: ['none', 'host'] }),
  I('timeout', 'general', '单轮超时（秒）', 'number', 900, { min: 60, max: 7200 }),
  I('tool_policy', 'general', '工具策略', 'enum', 'auto', { options: ['auto', 'all', 'none'] }),
  I('language', 'general', '界面语言', 'enum', 'zh', { options: ['zh', 'en'] }),
  // --- appearance
  I('theme', 'appearance', '主题配色', 'enum', 'claude', { options: ['claude', 'dark', 'light'] }),
  I('show_thinking', 'appearance', '显示思考链', 'boolean', true),
  I('show_tool_output', 'appearance', '显示工具输出', 'boolean', true),
  I('transcript_view', 'appearance', '对话视图', 'enum', 'verbose', { options: ['verbose', 'compact'] }),
  I('stream_speed', 'appearance', '流式速度', 'number', 0, { min: 0, max: 100 }),
  // --- tools & permissions
  I('allow_read', 'tools', '允许 Read', 'boolean', true, { flag: 'Read' }),
  I('allow_write', 'tools', '允许 Write/Edit', 'boolean', true, { flag: 'Write' }),
  I('allow_bash', 'tools', '允许 Bash', 'boolean', true, { flag: 'Bash' }),
  I('allow_glob', 'tools', '允许 Glob/Grep', 'boolean', true, { flag: 'Glob' }),
  I('allow_web', 'tools', '允许 WebFetch/WebSearch', 'boolean', true, { flag: 'WebFetch' }),
  I('approval_timeout', 'tools', '审批超时（秒）', 'number', 120, { min: 10, max: 600 }),
  I('auto_approve_readonly', 'tools', '自动批准只读工具', 'boolean', false),
  // --- model
  I('model', 'model', '默认模型', 'string', ''),
  I('provider', 'model', '默认提供方', 'string', ''),
  I('reasoning_effort', 'model', '推理强度', 'enum', 'auto', { options: ['auto', 'minimal', 'low', 'medium', 'high'] }),
  I('max_tokens', 'model', '最大输出 Token', 'number', 0, { min: 0, max: 262144 }),
  I('temperature', 'model', '温度', 'number', 0, { min: 0, max: 2 }),
  I('vision_mode', 'model', '视觉模式', 'enum', 'auto', { options: ['auto', 'image_url', 'path_only'] }),
  // --- session
  I('auto_title', 'session', '自动生成标题', 'boolean', true),
  I('keep_history', 'session', '保留历史会话', 'boolean', true),
  I('history_limit', 'session', '历史会话上限', 'number', 300, { min: 20, max: 5000 }),
  I('paste_doc_limit', 'session', '长文本转文档阈值', 'number', 10000, { min: 1000, max: 100000 }),
  I('export_format', 'session', '导出格式', 'enum', 'markdown', { options: ['markdown', 'txt'] }),
  // --- advanced
  I('system_prompt', 'advanced', '系统提示词补充', 'textarea', ''),
  I('append_identity', 'advanced', '注入模型身份声明', 'boolean', true),
  I('strip_images_on_error', 'advanced', '视觉失败时降级为路径', 'boolean', true),
  I('debug', 'advanced', '调试模式', 'boolean', false),
  I('cli_path', 'advanced', 'claude CLI 路径', 'path', ''),
  I('extra_flags', 'advanced', '附加 CLI 参数', 'string', ''),
]

export function defaultSettings() {
  const out = {}
  for (const it of SETTINGS_ITEMS) out[it.key] = it.default
  out.settings_version = 2
  return out
}

export function settingsFile() {
  return path.join(dataRoot(), 'settings.json')
}

export async function loadSettings() {
  ensureDirs()
  const saved = await readJson(settingsFile(), {})
  const merged = { ...defaultSettings(), ...(saved || {}) }
  // `reasoning_effort` was declared but never applied before settings_version 2,
  // so a stored "medium" is the old inert default rather than a user choice —
  // and forwarding it breaks providers that reject the parameter. Migrate once.
  if (Number(saved?.settings_version || 1) < 2 && merged.reasoning_effort === 'medium') {
    merged.reasoning_effort = 'auto'
  }
  return merged
}

export async function saveSettings(values) {
  ensureDirs()
  const merged = { ...defaultSettings(), ...(values || {}), settings_version: 2 }
  await writeJson(settingsFile(), merged)
  return merged
}

export function coerce(item, value) {
  if (value === undefined || value === null) return item.default
  switch (item.type) {
    case 'boolean': return value === true || value === 'true' || value === 1 || value === '1'
    case 'number': {
      const n = Number(value)
      if (!Number.isFinite(n)) return item.default
      return Math.min(item.max ?? Infinity, Math.max(item.min ?? -Infinity, n))
    }
    case 'enum': return item.options.includes(value) ? value : item.default
    default: return String(value)
  }
}

/* ------------------------------------------------------------------- jobs */

export function jobFile(id) { return path.join(dataRoot(), 'jobs', safeName(id) + '.json') }

export async function createJob(meta) {
  ensureDirs()
  const id = 'job-' + randomUUID().replace(/-/g, '').slice(0, 16)
  const job = {
    id,
    created: Date.now(),
    done: false,
    error: null,
    events: [],
    ...meta,
  }
  await writeJson(jobFile(id), job)
  return job
}

export async function getJob(id) { return readJson(jobFile(id), null) }

/**
 * Per-job serialization.
 *
 * pushEvent()/patchJob() are read-modify-write cycles on the same JSON file and
 * are called concurrently (CLI stdout reader, bridge usage callback, job
 * lifecycle). Without a lock the last writer wins and events such as usage
 * stats are silently dropped.
 */
const JOB_LOCKS = new Map()
function withJobLock(id, fn) {
  const prev = JOB_LOCKS.get(id) || Promise.resolve()
  const next = prev.then(fn, fn)
  JOB_LOCKS.set(id, next.then(() => {}, () => {}))
  next.finally(() => {
    if (JOB_LOCKS.get(id) === next) JOB_LOCKS.delete(id)
  })
  return next
}

export async function pushEvent(id, event) {
  return withJobLock(id, async () => {
    const job = await getJob(id)
    if (!job) return
    job.events.push({ seq: job.events.length, ts: Date.now(), ...event })
    await writeJson(jobFile(id), job)
  })
}

export async function patchJob(id, patch) {
  return withJobLock(id, async () => {
    const job = await getJob(id)
    if (!job) return
    Object.assign(job, patch)
    await writeJson(jobFile(id), job)
  })
}

/* ------------------------------------------------------------ conversations */

export function sessionFile(key) { return path.join(dataRoot(), 'sessions', safeName(key) + '.json') }

export async function listSessions() {
  ensureDirs()
  const dir = path.join(dataRoot(), 'sessions')
  const files = (await fsp.readdir(dir)).filter((f) => f.endsWith('.json'))
  const out = []
  for (const f of files) {
    try { out.push(JSON.parse(await fsp.readFile(path.join(dir, f), 'utf-8'))) } catch (e) { /* skip */ }
  }
  return out.sort((a, b) => (b.updated || 0) - (a.updated || 0))
}

export async function getSession(key) { return readJson(sessionFile(key), null) }
export async function putSession(sess) {
  ensureDirs()
  await writeJson(sessionFile(sess.key || sess.id), sess)
  return sess
}
export async function deleteSession(key) {
  try { await fsp.unlink(sessionFile(key)) } catch (e) { /* ignore */ }
}

/* ------------------------- metadata overlay for read-only CLI transcripts */

export function cliMetaFile(id) { return path.join(dataRoot(), 'cli-meta', safeName(id) + '.json') }
export async function getCliMeta(id) { return readJson(cliMetaFile(id), {}) }
export async function putCliMeta(id, patch) {
  ensureDirs()
  const prev = await getCliMeta(id)
  const next = { id, ...prev, ...patch, updated: Date.now() }
  await writeJson(cliMetaFile(id), next)
  return next
}
export async function deleteCliMeta(id) {
  try { await fsp.unlink(cliMetaFile(id)) } catch (e) { /* ignore */ }
}
export async function listCliMeta() {
  ensureDirs()
  const dir = path.join(dataRoot(), 'cli-meta')
  const out = {}
  for (const f of (await fsp.readdir(dir)).filter((x) => x.endsWith('.json'))) {
    try {
      const m = JSON.parse(await fsp.readFile(path.join(dir, f), 'utf-8'))
      if (m && m.id) out[m.id] = m
    } catch (e) { /* skip */ }
  }
  return out
}
/** Merge CLI transcript index with editable metadata + generated topic title. */
export async function mergeCliMeta(sessions) {
  const metas = await listCliMeta()
  return sessions.map((s) => {
    const m = metas[s.id] || {}
    return {
      ...s,
      title: m.title || s.title || '',
      pinned: Boolean(m.pinned),
      archived: Boolean(m.archived),
      group: m.group || '',
      deleted: Boolean(m.deleted),
      cli_session_id: s.id,
      turn: m.turn || 0,
    }
  })
}

/** Derive a short topic title from a transcript's first user message. */
export function titleFromMessages(messages, max = 24) {
  for (const m of messages || []) {
    if (m.role !== 'user') continue
    const raw = String(m.text || '').replace(/^【[^】]*】/, '').replace(/\s+/g, ' ').trim()
    if (!raw) continue
    let t = raw.slice(0, max)
    if (/[。！？!?\n]/.test(raw)) t = raw.split(/[。！？!?\n]/)[0].slice(0, max)
    return t || raw.slice(0, max)
  }
  return ''
}

/** Ensure CLI sessions carry a generated topic title, cached in cli-meta. */
export async function ensureCliTitles(sessions, projectsDir) {
  const metas = await listCliMeta()
  const out = []
  for (const s of sessions) {
    const m = metas[s.id] || {}
    if (m.title) { out.push({ ...s, title: m.title }); continue }
    try {
      const msgs = await readCliTranscript(s.file, 60)
      const title = titleFromMessages(msgs)
      if (title) await putCliMeta(s.id, { title })
      out.push({ ...s, title: title || s.title || '' })
    } catch (e) {
      out.push(s)
    }
  }
  return out
}

/* --------------------------------------------------- Claude CLI history scan */

export function claudeProjectsDir(configured) {
  if (configured && fs.existsSync(configured)) return configured
  return path.join(os.homedir(), '.claude', 'projects')
}

function decodeProject(slug) {
  // Claude stores project paths as C--AI-Workspace-... with dashes.
  return slug.replace(/^([A-Za-z])--/, '$1:\\').replace(/--/g, '\\')
}

/** Scan the Claude CLI projects tree (.jsonl files) into a session index. */
export async function scanClaudeHistory(projectsDir, limit = 300) {
  const out = []
  if (!fs.existsSync(projectsDir)) return out
  let slugs
  try { slugs = await fsp.readdir(projectsDir) } catch (e) { return out }
  for (const slug of slugs) {
    const dir = path.join(projectsDir, slug)
    let stat
    try { stat = await fsp.stat(dir) } catch (e) { continue }
    if (!stat.isDirectory()) continue
    let files
    try { files = (await fsp.readdir(dir)).filter((f) => f.endsWith('.jsonl')) } catch (e) { continue }
    for (const f of files) {
      const full = path.join(dir, f)
      try {
        const st = await fsp.stat(full)
        const id = path.basename(f, '.jsonl')
        out.push({
          id,
          source: 'cli',
          project: decodeProject(slug),
          projectSlug: slug,
          file: full,
          title: '',
          updated: st.mtimeMs,
          size: st.size,
        })
      } catch (e) { /* skip */ }
    }
  }
  return out.sort((a, b) => b.updated - a.updated).slice(0, limit)
}

/** Read a Claude CLI jsonl transcript into normalized messages. */
export async function readCliTranscript(file, maxRows = 4000) {
  const text = await fsp.readFile(file, 'utf-8')
  const lines = text.split(/\r?\n/).filter(Boolean)
  const msgs = []
  for (let i = 0; i < lines.length && i < maxRows; i++) {
    let obj
    try { obj = JSON.parse(lines[i]) } catch (e) { continue }
    const type = obj.type
    if (type === 'user' || type === 'assistant') {
      const msg = obj.message || {}
      const role = type === 'user' ? 'user' : 'assistant'
      let textOut = ''
      const content = msg.content
      if (typeof content === 'string') textOut = content
      else if (Array.isArray(content)) {
        textOut = content
          .filter((b) => b && (b.type === 'text' || typeof b.text === 'string'))
          .map((b) => b.text)
          .join('\n')
      }
      if (textOut.trim()) {
        msgs.push({ id: obj.uuid || randomUUID(), role, text: textOut, ts: obj.timestamp || '' })
      }
    }
  }
  return msgs
}

/* ------------------------------------------------ stream-json normalization */

/**
 * Normalize one Claude CLI stream-json line into a front-end event.
 * Produces kinds: init | delta | blocks | thinking | tool | result | log.
 */
export function normalizeStreamJson(obj) {
  if (!obj || typeof obj !== 'object') return null
  const t = obj.type
  if (t === 'system' && obj.subtype === 'init') {
    return {
      kind: 'init',
      session_id: obj.session_id,
      model: obj.model,
      tools: obj.tools || [],
      cwd: obj.cwd,
    }
  }
  const parent = obj.parent_tool_use_id || '' // non-empty => this event is inside a sub-agent

  // `--include-partial-messages` makes the CLI forward the provider's SSE deltas
  // as `stream_event` lines. Without them the whole thinking chain arrives as one
  // finished `assistant` message, so the panel could only paint it after the model
  // had already finished thinking — the user saw a single jump, never the process.
  if (t === 'stream_event') {
    const inner = obj.event || {}
    if (inner.type === 'content_block_delta') {
      const d = inner.delta || {}
      if (d.type === 'thinking_delta' && d.thinking) {
        return { kind: 'thinking', text: d.thinking, parent, partial: true }
      }
      if (d.type === 'text_delta' && d.text) {
        return { kind: 'delta', text: d.text, parent, partial: true }
      }
      // input_json_delta / signature_delta build a tool call or a signature;
      // the finished `assistant` message carries both, so they are dropped here.
    }
    return null
  }

  if (t === 'assistant') {
    const msg = obj.message || {}
    const content = msg.content || []
    const blocks = []
    const events = []
    for (const b of content) {
      if (!b || typeof b !== 'object') continue
      if (b.type === 'text' && b.text) blocks.push({ type: 'text', text: b.text })
      else if (b.type === 'thinking' && b.thinking) events.push({ kind: 'thinking', text: b.thinking, parent })
      else if (b.type === 'tool_use') {
        const tname = b.name || 'tool'
        const isAgent = /^(Task|Agent|delegate|subagent)/i.test(tname)
        events.push({
          kind: isAgent ? 'agent_start' : 'tool',
          id: b.id || randomUUID(),
          name: tname,
          input: b.input || {},
          parent,
          // Extract the delegated prompt/task description so the UI can label the card.
          label: String((b.input && (b.input.description || b.input.prompt || b.input.task)) || '').slice(0, 120),
        })
      }
    }
    const out = []
    if (blocks.length) out.push({ kind: 'blocks', blocks, model: msg.model, parent })
    out.push(...events)
    return out.length ? { kind: 'group', items: out } : null
  }
  if (t === 'user') {
    // tool_result arrives as a user message; surface it to update the tool card.
    const msg = obj.message || {}
    const content = msg.content || []
    const results = []
    for (const b of content) {
      if (b && b.type === 'tool_result') {
        let text = ''
        if (typeof b.content === 'string') text = b.content
        else if (Array.isArray(b.content)) {
          text = b.content.map((c) => (c && typeof c.text === 'string' ? c.text : '')).join('\n')
        }
        results.push({ kind: 'tool_result', id: b.tool_use_id, text, isError: Boolean(b.is_error), parent })
      }
    }
    return results.length ? { kind: 'group', items: results } : null
  }
  if (t === 'result') {
    // The CLI reports the model's real context window in modelUsage; keep it so
    // the UI can show a truthful context gauge instead of guessing a limit.
    let contextWindow = 0
    let maxOutputTokens = 0
    const mu = obj.modelUsage || {}
    for (const k of Object.keys(mu)) {
      const w = Number(mu[k]?.contextWindow || 0)
      if (w > contextWindow) { contextWindow = w; maxOutputTokens = Number(mu[k]?.maxOutputTokens || 0) }
    }
    return {
      kind: 'result',
      ok: obj.is_error !== true,
      text: obj.result || '',
      session_id: obj.session_id,
      error: obj.error || (obj.is_error ? (obj.result || 'Claude Code error') : null),
      usage: obj.usage || {},
      contextWindow: contextWindow || undefined,
      maxOutputTokens: maxOutputTokens || undefined,
      duration_ms: obj.duration_ms,
      num_turns: obj.num_turns,
    }
  }
  return null
}

/** Flatten a normalize result (which may be a group) into a flat event list. */
export function flattenEvents(norm) {
  if (!norm) return []
  if (norm.kind === 'group') return norm.items.flatMap(flattenEvents)
  return [norm]
}

export function shortHash(s) {
  return createHash('sha1').update(String(s)).digest('hex').slice(0, 12)
}

export { randomUUID }
