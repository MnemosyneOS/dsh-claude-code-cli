/**
 * Claude Code Parity for DSH — Anthropic ⇄ DSH LLM protocol bridge.
 *
 * Claude Code (claude.exe) speaks the Anthropic Messages API and refuses to run
 * unless ANTHROPIC_BASE_URL points at an Anthropic-compatible server. This
 * module starts a loopback HTTP server that implements just enough of that API
 * (/v1/messages, streaming + non-streaming, and /v1/messages/count_tokens),
 * translating each request into a DSH `ctx.llm.stream()` call against a model
 * that is already configured and authenticated inside DSH.
 *
 * The net effect: Claude Code runs unmodified and uses any DSH provider/model,
 * with no Claude login required. This is the DSH port of Hermes claude-code-
 * parity's `_Bridge` + `_AnthropicStream` (plugin_api.py), rewritten from
 * Python/httpx/OpenAI-chunks to Node/http/DSH-chunks.
 *
 * DSH chunk vocabulary consumed here (dsh-llm StreamChunk):
 *   block-start { index, blockType } | text-delta { index, text }
 *   reasoning-delta { index, text } | tool-call-delta { index, id, name?, argumentsDelta }
 *   block-end { index, block } | usage { usage } | finish { reason }
 */

import http from 'node:http'
import { randomUUID } from 'node:crypto'

const PORT_CANDIDATES = [47823, 47824, 47825, 47826, 47827, 47828]

/**
 * provider/model pairs that rejected an image at least once. Remembering the
 * failure lets the next turn send a text placeholder instead of failing again
 * (settings: 视觉失败时降级为路径).
 */
const VISION_FAILED = new Set()

function looksLikeVisionError(message) {
  return /image|vision|multimodal|unsupported.?content|invalid.?content/i.test(String(message || ''))
}

/**
 * Turn the provider's raw context-overflow JSON into an actionable Chinese
 * message. Raw `exceed_context_size_error` text is both unreadable in the chat
 * panel and hides the one fix that actually works: compact the long session.
 */
export function friendlyProviderFailure(raw) {
  const s = String(raw || '').trim()
  if (!s) return ''
  if (/exceed_context_size_error|exceeds the available context size/i.test(s)) {
    const used = (s.match(/request \((\d+)\s*tokens\)/i) || [])[1]
    const limit = (s.match(/context size \((\d+)\s*tokens\)/i) || [])[1]
    const nums = (n) => Number(n).toLocaleString('zh-CN')
    const detail = used && limit
      ? `（本次约 ${nums(used)} tokens，模型上限 ${nums(limit)} tokens）`
      : ''
    return '会话历史过长，已超过当前模型的上下文窗口' + detail + '。请在「设置 → 会话 → 自动压缩阈值（Token）」调低阈值后重试，或新建会话；旧会话内容不会被删除。'
  }
  if (/connection error|连接.*(断开|中断)|ECONNRESET|socket hang up|terminated/i.test(s)) {
    return '模型服务连接中断（常见于任务被取消、切换任务或模型服务重启）。这不是账号配置问题，也不需要切换模型；请稍后重试，或确认当前模型服务仍在运行。'
  }
  return s
}

function json(res, status, obj) {
  const body = JSON.stringify(obj)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'access-control-allow-origin': '*',
  })
  res.end(body)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      if (size > 32 * 1024 * 1024) {
        reject(new Error('request too large'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}'))
      } catch (e) {
        reject(e)
      }
    })
    req.on('error', reject)
  })
}

/**
 * Estimate input tokens. chars/4 badly underestimates Chinese legal text:
 * a real 131k-token transcript measured only ~245k JSON characters, because
 * CJK characters often cost close to one token each. Weight CJK explicitly.
 */
function estimateTextTokens(text) {
  const s = String(text ?? '')
  if (!s) return 0
  const cjk = (s.match(/[\u3400-\u9fff\uf900-\ufaff]/g) || []).length
  const rest = s.length - cjk
  return Math.ceil(cjk * 1.1 + rest / 3.6)
}
function estimateInputTokens(messages) {
  return Math.max(1, estimateTextTokens(JSON.stringify(messages || [])))
}

const textTokens = (s) => estimateTextTokens(s)

/** One line of readable text from a message's content (string or block list). */
function messageText(m) {
  if (!m) return ''
  const c = m.content
  if (typeof c === 'string') return c
  if (!Array.isArray(c)) return ''
  return c
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n')
}

/** Trim to a single line and a bounded length, so a digest stays compact. */
function oneLine(text, max = 150) {
  const s = String(text || '').replace(/\s+/g, ' ').trim()
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}

/**
 * A structured digest of the messages a trim is about to drop.
 *
 * Simply telling the model "N older messages were omitted" throws away every
 * fact those messages carried: the task, the files already read, the numbers
 * already checked. This extracts that instead — deterministically, with no
 * model call, because the bridge answers the CLI synchronously and a second
 * round-trip here would add latency and a new failure mode.
 *
 * The digest is intentionally extractive: user asks, tools already run, and
 * the opening line of each conclusion. It is bounded by `maxChars` so it can
 * never grow into the very overflow it exists to prevent.
 */
export function summarizeDroppedMessages(messages, opts = {}) {
  const list = Array.isArray(messages) ? messages : []
  if (!list.length) return ''
  const maxChars = Number(opts.maxChars) > 0 ? Number(opts.maxChars) : 1600
  const asks = []
  const actions = []
  const findings = []
  const files = new Set()

  for (const m of list) {
    const text = messageText(m)
    const blocks = Array.isArray(m && m.content) ? m.content : []
    if (m && m.role === 'user') {
      // A tool_result-only user turn is plumbing, not an instruction.
      const isToolOnly = blocks.length > 0 && blocks.every((b) => b && b.type === 'tool_result')
      if (text && !isToolOnly) {
        asks.push(oneLine(text, 120))
        for (const hit of String(text).matchAll(/[A-Za-z]:\\[^\s"'）)，。]+/g)) files.add(hit[0])
      }
      continue
    }
    if (m && m.role === 'assistant') {
      for (const b of blocks) {
        if (b && b.type === 'tool_use') {
          const arg = b.input && (b.input.file_path || b.input.path || b.input.command || b.input.query || b.input.pattern || '')
          actions.push(oneLine(`${b.name || 'tool'}${arg ? ' · ' + String(arg) : ''}`, 100))
          if (arg && /[\\/]/.test(String(arg))) files.add(String(arg))
        }
      }
      if (text) findings.push(oneLine(text, 120))
    }
  }

  // Keep the newest of each kind — the older a line, the less it still steers.
  const tail = (arr, n) => (arr.length > n ? arr.slice(-n) : arr)
  const parts = []
  if (asks.length) parts.push('早期用户诉求：\n' + tail(asks, 4).map((s) => '- ' + s).join('\n'))
  if (actions.length) parts.push('已执行的操作：\n' + tail(actions, 6).map((s) => '- ' + s).join('\n'))
  if (findings.length) parts.push('此前的结论要点：\n' + tail(findings, 3).map((s) => '- ' + s).join('\n'))
  if (files.size) parts.push('涉及的文件：\n' + [...files].slice(-6).map((s) => '- ' + oneLine(s, 110)).join('\n'))

  let out = parts.join('\n\n')
  if (out.length > maxChars) out = out.slice(0, maxChars - 1) + '…'
  return out
}

/**
 * Keep the newest messages inside a hard token budget. Claude CLI replays its
 * whole transcript on `--resume`; a long session eventually sends 131k+ tokens
 * to a 131k model and gets `exceed_context_size_error`. Trimming the tail here
 * (in the protocol bridge, not the CLI transcript) keeps old sessions usable
 * without deleting anything from disk. A 15% headroom absorbs tokenizer
 * differences and the answer budget.
 */
export function trimMessagesToBudget(messages, budget, system = '', tools = []) {
  const list = Array.isArray(messages) ? messages : []
  const toolsCost = textTokens(JSON.stringify(tools || []))
  const overhead = textTokens(system) + toolsCost
  if (!Number.isFinite(budget) || budget <= 0 || list.length === 0) {
    return { messages: list, dropped: 0, inputTokens: Math.max(1, estimateInputTokens(list) + overhead) }
  }
  const room = Math.max(1000, Math.floor(budget * 0.85) - overhead)
  const kept = []
  let total = 0
  for (let i = list.length - 1; i >= 0; i--) {
    const m = list[i]
    const cost = estimateInputTokens([m])
    // Always keep at least the newest message, even if it alone is oversized.
    if (kept.length && total + cost > room) break
    kept.unshift(m)
    total += cost
  }
  return {
    messages: kept,
    dropped: list.length - kept.length,
    // The dropped slice, so the caller can summarize what it removes instead
    // of only counting it.
    droppedMessages: list.slice(0, list.length - kept.length),
    inputTokens: Math.max(1, total + overhead),
  }
}

/**
 * Decode an Anthropic image source into bytes DSH's attachment store accepts.
 *
 * DSH content blocks do NOT carry `source` — an image block is
 * `{ type: 'image', attachment: ImageAttachmentRef }`. Passing the Anthropic
 * shape through made the adapter read `block.attachment.attachmentId` on an
 * undefined ref, which surfaced in the UI as
 * "Cannot read properties of undefined (reading 'attachmentId')".
 */
async function imageInputFromSource(source) {
  if (!source || typeof source !== 'object') return null
  const mediaType = String(source.media_type || source.mediaType || 'image/png')
  if (source.type === 'base64' && source.data) {
    const data = Buffer.from(String(source.data), 'base64')
    return data.length ? { data, mediaType, name: 'image' } : null
  }
  if (source.type === 'url' && source.url) {
    try {
      const r = await fetch(String(source.url), { signal: AbortSignal.timeout(10000) })
      if (!r.ok) return null
      const data = Buffer.from(await r.arrayBuffer())
      return data.length ? { data, mediaType, name: 'image' } : null
    } catch (e) {
      return null
    }
  }
  return null
}

/** Durably admit every image in the request, in order; null means "omit". */
async function admitImages(inputs, ctx) {
  if (!inputs.length) return []
  let store = null
  // Cordis contexts reject a direct `ctx.attachments` read unless the service
  // was injected at construction; `ctx.get()` is the supported lookup here.
  try {
    if (ctx && typeof ctx.get === 'function') store = ctx.get('attachments')
  } catch (e) { store = null }
  if (!store && ctx) {
    try { store = ctx.attachments } catch (e) { store = null }
  }
  if (!store || typeof store.saveImages !== 'function') return inputs.map(() => null)
  try {
    const refs = await store.saveImages(inputs)
    return inputs.map((_, i) => refs[i] || null)
  } catch (e) {
    // A rejected image batch must not kill the turn; degrade to text below.
    return inputs.map(() => null)
  }
}

/** Replace one Anthropic message's image placeholders with durable refs. */
async function settleImages(holders, ctx) {
  if (!holders.length) return
  const refs = await admitImages(holders.map((h) => h._input), ctx)
  holders.forEach((holder, i) => {
    const ref = refs[i]
    if (ref && typeof ref.attachmentId === 'string') {
      holder.type = 'image'
      holder.attachment = ref
    } else {
      holder.type = 'text'
      holder.text = '[图片已省略：当前部署未接收该图像。请改用文字描述或提供文件路径]'
    }
    delete holder._input
  })
}

/**
 * Convert an Anthropic Messages request into DSH GenerateOptions pieces.
 * Returns { messages, system, tools, model, reasoningEffort }.
 *
 * Anthropic content blocks may be strings or arrays of
 * { type: 'text' | 'image' | 'tool_use' | 'tool_result', ... }.
 */
async function toDshRequest(body, resolved, ctx) {
  const rawMessages = Array.isArray(body.messages) ? body.messages : []
  // Vision policy: `path_only` never sends pixels, and a provider that already
  // rejected an image is remembered so the next turn degrades instead of failing.
  const visionKey = `${resolved?.provider || ''}/${resolved?.model || ''}`
  const visionMode = resolved?.visionMode || 'auto'
  const dropImages = visionMode === 'path_only'
    || (resolved?.stripImagesOnError !== false && VISION_FAILED.has(visionKey))
  let system
  if (typeof body.system === 'string') system = body.system
  else if (Array.isArray(body.system)) {
    system = body.system
      .filter((b) => b && (b.type === 'text' || typeof b.text === 'string'))
      .map((b) => b.text)
      .join('\n')
  }

  const messages = []
  for (const m of rawMessages) {
    const role = m.role === 'assistant' ? 'assistant' : 'user'
    const parts = []
    // One Anthropic message is one admission batch, which matches the store's
    // per-message image limits. Placeholders are swapped for durable refs
    // before this message is handed to DSH.
    const pendingImages = []
    // Anthropic returns tool output as `tool_result` blocks inside a *user*
    // message, but DSH's harness vocabulary carries it in its own `role: 'tool'`
    // message and only reads text/image out of a user message — a `tool-result`
    // part there is silently dropped. DSH then sees a tool call with no matching
    // result and answers the model with a synthetic "No result provided"
    // (isError), which is exactly the "every tool returns nothing" failure.
    const toolMessages = []
    const content = m.content
    if (typeof content === 'string') {
      parts.push({ type: 'text', text: content })
    } else if (Array.isArray(content)) {
      for (const b of content) {
        if (!b || typeof b !== 'object') continue
        if (b.type === 'text' || typeof b.text === 'string') {
          parts.push({ type: 'text', text: String(b.text ?? '') })
        } else if (b.type === 'image' && b.source) {
          const mediaType = String(b.source.media_type || b.source.mediaType || 'image/png')
          if (dropImages) {
            parts.push({
              type: 'text',
              text: `[图片已省略：${mediaType}。当前模型按设置不接收图像输入，请改用文字描述或提供文件路径]`,
            })
          } else {
            const input = await imageInputFromSource(b.source)
            if (input) {
              const holder = { type: 'image', _input: input }
              parts.push(holder)
              pendingImages.push(holder)
            } else {
              parts.push({ type: 'text', text: `[图片已省略：无法读取 ${mediaType} 图像数据]` })
            }
          }
        } else if (b.type === 'tool_use') {
          parts.push({
            type: 'tool-call',
            id: String(b.id || randomUUID()),
            name: String(b.name || 'tool'),
            arguments: typeof b.input === 'string' ? b.input : JSON.stringify(b.input ?? {}),
          })
        } else if (b.type === 'tool_result') {
          const toolUseId = String(b.tool_use_id || '')
          // Keep text and images; anything else has no harness representation.
          const out = []
          if (typeof b.content === 'string') {
            out.push({ type: 'text', text: b.content })
          } else if (Array.isArray(b.content)) {
            for (const c of b.content) {
              if (!c || typeof c !== 'object') continue
              if (typeof c.text === 'string') out.push({ type: 'text', text: c.text })
              else if (c.type === 'image' && c.source) {
                const mediaType = String(c.source.media_type || c.source.mediaType || 'image/png')
                if (dropImages) out.push({ type: 'text', text: `[工具返回的图片已省略：${mediaType}]` })
                else {
                  const input = await imageInputFromSource(c.source)
                  if (input) {
                    const holder = { type: 'image', _input: input }
                    out.push(holder)
                    pendingImages.push(holder)
                  } else {
                    out.push({ type: 'text', text: `[工具返回的图片已省略：无法读取 ${mediaType} 图像数据]` })
                  }
                }
              }
            }
          }
          if (!out.length) out.push({ type: 'text', text: '' })
          // An empty result is legal, but an empty *string* reads to the model as
          // "the tool said nothing at all" — name it instead.
          const joined = out.map((c) => c.text || '').join('')
          if (!joined.trim() && out.every((c) => c.type === 'text')) {
            out.length = 0
            out.push({ type: 'text', text: '(no output)' })
          }
          toolMessages.push({
            role: 'tool',
            toolCallId: toolUseId,
            source: { kind: 'tool', callId: toolUseId },
            content: out,
            isError: Boolean(b.is_error),
          })
        }
      }
    }
    await settleImages(pendingImages, ctx)
    // Results first: they answer the preceding assistant turn, and any text the
    // user wrote alongside them belongs after that exchange.
    if (toolMessages.length) messages.push(...toolMessages)
    if (!parts.length) {
      // A user message that carried nothing but tool results has already been
      // delivered above; pushing an empty one would add a blank turn.
      if (toolMessages.length) continue
      parts.push({ type: 'text', text: '' })
    }
    // DSH requires every assistant message to carry its provider metadata
    // (`source.replayState` is read unconditionally); omitting it makes any
    // request that replays history crash with "Cannot read properties of
    // undefined (reading 'replayState')" — i.e. the second turn always failed.
    if (role === 'assistant') {
      messages.push({
        role,
        content: parts,
        source: { kind: 'model', provider: resolved?.provider || '', model: resolved?.model || '' },
      })
    } else {
      messages.push({ role, content: parts })
    }
  }

  // Anthropic tools -> DSH ToolSchema (JSON schema).
  const tools = (Array.isArray(body.tools) ? body.tools : [])
    .filter((t) => t && t.name)
    .map((t) => ({
      name: String(t.name),
      description: String(t.description || ''),
      parameters: t.input_schema && typeof t.input_schema === 'object'
        ? t.input_schema
        : { type: 'object', properties: {} },
    }))

  // A resumed CLI session replays every old turn. Trim to the configured hard
  // budget before DSH sees the request; otherwise long sessions die with
  // exceed_context_size_error even though the transcript is still on disk.
  const trimmed = trimMessagesToBudget(messages, resolved?.contextBudget, system, tools)
  if (trimmed.dropped > 0) {
    // Replace the dropped history with a digest of what it contained. A bare
    // "N messages were omitted" left the model blind to the task, the files
    // already read and the numbers already checked — it restarted work it had
    // done. The digest keeps those facts inside a bounded budget.
    //
    // Its size scales with the budget: a small window cannot afford a 1600-char
    // digest, and a digest that big would recreate the overflow it prevents.
    const budgetNow = Number(resolved?.contextBudget) > 0 ? Number(resolved.contextBudget) : 0
    const digestChars = budgetNow > 0
      ? Math.max(200, Math.min(1600, Math.floor(budgetNow * 0.10)))
      : 1600
    const digest = summarizeDroppedMessages(trimmed.droppedMessages, { maxChars: digestChars })
    const head = `[上下文已自动压缩：为控制在模型窗口内，省略了前 ${trimmed.dropped} 条历史消息。以下是从这些消息中提取的摘要，请据此继续，不要重复已完成的工作。]`
    const note = digest ? `${head}\n\n${digest}` : `${head}请依据保留的最近对话继续完成任务。`
    system = system ? system + '\n\n' + note : note
    trimmed.inputTokens += textTokens(note)
  }

  const reasoningEffort = body.thinking && body.thinking.type === 'enabled'
    ? (body.thinking.budget_tokens > 8000 ? 'high' : 'medium')
    : undefined

  return {
    messages: trimmed.messages,
    system,
    tools,
    model: resolved.model,
    provider: resolved.provider,
    reasoningEffort,
    maxTokens: typeof body.max_tokens === 'number' ? body.max_tokens : undefined,
    inputTokens: trimmed.inputTokens,
    compacted: trimmed.dropped,
  }
}

/**
 * Turn DSH StreamChunks into Anthropic SSE events. Mirrors Hermes'
 * _AnthropicStream but fed by DSH chunk types instead of OpenAI deltas.
 */
class AnthropicStreamEmitter {
  constructor(model, inputTokens) {
    this.model = model
    this.inputTokens = inputTokens
    this.outputTokens = 0
    this.msgId = 'msg_' + randomUUID().replace(/-/g, '').slice(0, 24)
    this.nextIndex = 0
    this.textIndex = null
    this.reasoningIndex = null
    this.toolIndexes = new Map() // dsh chunk index -> anthropic block index
    this.toolIds = new Map()
    this.openBlocks = []
    this.sawTool = false
    this.sawText = false
    this.finished = false
    this.finishKind = 'stop'
  }

  _open(kind) {
    if (kind === 'text' && this.textIndex !== null) return []
    if (kind === 'reasoning' && this.reasoningIndex !== null) return []
    const index = this.nextIndex++
    if (kind === 'text') this.textIndex = index
    if (kind === 'reasoning') this.reasoningIndex = index
    this.openBlocks.push(index)
    const block = kind === 'reasoning'
      ? { type: 'thinking', thinking: '', signature: '' }
      : { type: 'text', text: '' }
    return [{ event: 'content_block_start', data: { type: 'content_block_start', index, content_block: block } }]
  }

  start() {
    return [{
      event: 'message_start',
      data: {
        type: 'message_start',
        message: {
          id: this.msgId,
          type: 'message',
          role: 'assistant',
          model: this.model,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: {
            input_tokens: this.inputTokens,
            output_tokens: 0,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
        },
      },
    }]
  }

  push(chunk) {
    const out = []
    if (!chunk || typeof chunk !== 'object') return out
    switch (chunk.type) {
      case 'block-start':
        // DSH announces blocks; we open lazily on the first delta so block
        // types line up with the deltas we actually emit.
        break
      case 'text-delta': {
        if (typeof chunk.text !== 'string' || !chunk.text) break
        this.sawText = true
        out.push(...this._open('text'))
        this.outputTokens += Math.max(1, Math.ceil(chunk.text.length / 3))
        out.push({
          event: 'content_block_delta',
          data: {
            type: 'content_block_delta',
            index: this.textIndex,
            delta: { type: 'text_delta', text: chunk.text },
          },
        })
        break
      }
      case 'reasoning-delta': {
        if (typeof chunk.text !== 'string' || !chunk.text) break
        out.push(...this._open('reasoning'))
        out.push({
          event: 'content_block_delta',
          data: {
            type: 'content_block_delta',
            index: this.reasoningIndex,
            delta: { type: 'thinking_delta', thinking: chunk.text },
          },
        })
        break
      }
      case 'tool-call-delta': {
        this.sawTool = true
        const dshIndex = chunk.index
        let blockIndex = this.toolIndexes.get(dshIndex)
        if (blockIndex === undefined) {
          blockIndex = this.nextIndex++
          this.toolIndexes.set(dshIndex, blockIndex)
          this.openBlocks.push(blockIndex)
          const id = String(chunk.id || ('toolu_' + randomUUID().replace(/-/g, '').slice(0, 12)))
          this.toolIds.set(dshIndex, id)
          out.push({
            event: 'content_block_start',
            data: {
              type: 'content_block_start',
              index: blockIndex,
              content_block: { type: 'tool_use', id, name: String(chunk.name || 'tool'), input: {} },
            },
          })
        }
        if (chunk.argumentsDelta) {
          out.push({
            event: 'content_block_delta',
            data: {
              type: 'content_block_delta',
              index: blockIndex,
              delta: { type: 'input_json_delta', partial_json: chunk.argumentsDelta },
            },
          })
        }
        break
      }
      case 'usage': {
        const u = chunk.usage || {}
        if (typeof u.inputTokens === 'number') this.inputTokens = u.inputTokens
        else if (typeof u.promptTokens === 'number') this.inputTokens = u.promptTokens
        if (typeof u.outputTokens === 'number') this.outputTokens = u.outputTokens
        else if (typeof u.completionTokens === 'number') this.outputTokens = u.completionTokens
        break
      }
      case 'finish': {
        const kind = chunk.reason && (chunk.reason.kind || chunk.reason)
        if (kind) this.finishKind = kind
        // Keep the provider's real failure text so the CLI/user sees why it stopped.
        const failure = chunk.reason && chunk.reason.failure
        if (failure) {
          const raw = failure.message || failure.code || JSON.stringify(failure)
          // Keep the actionable translation, not the raw provider JSON, in
          // both the chat marker and the stats line.
          this.failure = friendlyProviderFailure(raw)
        }
        break
      }
      case 'block-end':
      default:
        break
    }
    return out
  }

  finish() {
    if (this.finished) return []
    this.finished = true
    const out = []
    for (const index of this.openBlocks) {
      out.push({ event: 'content_block_stop', data: { type: 'content_block_stop', index } })
    }
    const stopReason = this.sawTool
      ? 'tool_use'
      : this.finishKind === 'max-tokens' ? 'max_tokens' : 'end_turn'
    out.push({
      event: 'message_delta',
      data: {
        type: 'message_delta',
        delta: { stop_reason: stopReason, stop_sequence: null },
        usage: { output_tokens: this.outputTokens },
      },
    })
    out.push({ event: 'message_stop', data: { type: 'message_stop' } })
    return out
  }
}

function sseWrite(res, events) {
  for (const { event, data } of events) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }
}

/**
 * Create the loopback bridge. `resolveModel(body)` -> { provider, model }.
 * Uses ctx.llm.stream(); injects an AbortController + hard timeout because
 * DSH's stream has no built-in timeout.
 */
export function createBridge(ctx, resolveModel, config = {}) {
  const reportStats = typeof config.onStats === 'function' ? config.onStats : null
  const server = http.createServer(async (req, res) => {
    let body
    try {
      body = await readBody(req)
    } catch (e) {
      json(res, 400, { type: 'error', error: { type: 'invalid_request_error', message: String(e && e.message) } })
      return
    }

    const path = req.url || ''

    if (path.includes('count_tokens')) {
      json(res, 200, { input_tokens: estimateInputTokens(body.messages) })
      return
    }

    if (!path.includes('/v1/messages')) {
      json(res, 404, { type: 'error', error: { type: 'not_found_error', message: path } })
      return
    }

    // Resolve which DSH provider/model this turn targets. Prefer an explicit
    // model hint sent by the front-end; fall back to the configured default.
    let resolved
    try {
      // resolveModel may be async (the host validates against the live catalog).
      resolved = (await resolveModel(body)) || {}
    } catch (e) {
      resolved = {}
    }
    if (!resolved.provider || !resolved.model) {
      json(res, 400, {
        type: 'error',
        error: { type: 'invalid_request_error', message: 'no DSH provider/model resolved for this turn' },
      })
      return
    }

    let reqSpec
    try {
      reqSpec = await toDshRequest(body, resolved, ctx)
    } catch (e) {
      // Never let request conversion take down the whole DSH process.
      json(res, 500, {
        type: 'error',
        error: { type: 'api_error', message: String(e && e.message || e) },
      })
      return
    }
    const emitter = new AnthropicStreamEmitter(resolved.model, reqSpec.inputTokens || estimateInputTokens(reqSpec.messages))
    const controller = new AbortController()
    const timeoutMs = Math.max(60, Number(config.runTimeoutSec) || 1800) * 1000
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    const streamOpts = {
      provider: resolved.provider,
      model: resolved.model,
      messages: reqSpec.messages,
      signal: controller.signal,
    }
    if (reqSpec.system) streamOpts.system = reqSpec.system
    if (reqSpec.tools && reqSpec.tools.length) streamOpts.tools = reqSpec.tools
    // Precedence: what the CLI asked for, then the user's settings defaults.
    // "auto" means "let the provider decide" — forwarding a level to a model
    // that rejects it fails the whole turn.
    const effort = reqSpec.reasoningEffort
      || (resolved.reasoningEffort && resolved.reasoningEffort !== 'auto' ? resolved.reasoningEffort : '')
    if (effort) streamOpts.reasoningEffort = effort
    const maxTok = reqSpec.maxTokens || resolved.maxTokens
    if (maxTok) streamOpts.maxTokens = maxTok
    if (typeof resolved.temperature === 'number' && Number.isFinite(resolved.temperature)) {
      streamOpts.temperature = resolved.temperature
    }

    if (!body.stream) {
      // Non-streaming: accumulate then return a single Anthropic message object.
      try {
        const textParts = []
        let toolUses = []
        let inputTokens = emitter.inputTokens
        let outputTokens = 0
        let stopReason = 'end_turn'
        let finishKind = ''
        let failureText = ''
        let reasoningChars = 0
        const t0 = Date.now()
        let tFirst = 0
        for await (const chunk of ctx.llm.stream(streamOpts)) {
          if (chunk.type === 'text-delta' && chunk.text) {
            if (!tFirst) tFirst = Date.now()
            textParts.push(chunk.text)
          } else if (chunk.type === 'reasoning-delta' && chunk.text) {
            if (!tFirst) tFirst = Date.now()
            reasoningChars += chunk.text.length
          } else if (chunk.type === 'tool-call-delta') { toolUses = true }
          else if (chunk.type === 'usage') {
            const u = chunk.usage || {}
            inputTokens = u.inputTokens ?? u.promptTokens ?? inputTokens
            outputTokens = u.outputTokens ?? u.completionTokens ?? outputTokens
          } else if (chunk.type === 'finish') {
            const kind = chunk.reason && (chunk.reason.kind || chunk.reason)
            if (kind) finishKind = kind
            const failure = chunk.reason && chunk.reason.failure
            if (failure) {
              const raw = failure.message || failure.code || String(failure)
              failureText = friendlyProviderFailure(raw)
            }
            stopReason = kind === 'tool-calls' ? 'tool_use' : 'end_turn'
          }
        }
        const tEnd = Date.now()
        if (reportStats) {
          const prefillMs = tFirst ? (tFirst - t0) : 0
          const decodeMs = tFirst ? (tEnd - tFirst) : (tEnd - t0)
          const outTok = outputTokens || Math.max(1, Math.ceil(textParts.join('').length / 3))
          try {
            reportStats({
              provider: resolved.provider,
              model: resolved.model,
              inputTokens,
              outputTokens: outTok,
              reasoningChars,
              prefillMs,
              decodeMs,
              prefillTps: prefillMs > 0 ? (inputTokens / (prefillMs / 1000)) : 0,
              decodeTps: decodeMs > 0 ? (outTok / (decodeMs / 1000)) : 0,
              totalMs: tEnd - t0,
              stopReason,
            }, body)
          } catch (e) { /* stats callback must never break the bridge */ }
        }
        const content = []
        const textOut = textParts.join('')
        if (textOut) content.push({ type: 'text', text: textOut })
        else if (!toolUses) {
          // An empty content array is a legal-looking reply that renders as
          // nothing at all. Say why the turn came back empty instead.
          const why = finishKind === 'error'
            ? '（本轮未返回内容：' + (failureText || '提供方未返回内容') + '）'
            : finishKind === 'max-tokens' && reasoningChars > 0
              ? '（模型把全部输出预算用在了思考链上，正文为空。请到「设置 → 模型 → 最大 token」调大数值，或关闭该模型的思考模式。）'
              : '（本轮未返回内容）'
          content.push({ type: 'text', text: why })
        }
        json(res, 200, {
          id: emitter.msgId,
          type: 'message',
          role: 'assistant',
          model: resolved.model,
          content,
          stop_reason: stopReason,
          stop_sequence: null,
          usage: { input_tokens: inputTokens, output_tokens: outputTokens },
        })
      } catch (e) {
        if (looksLikeVisionError(e && e.message)) VISION_FAILED.add(`${resolved.provider}/${resolved.model}`)
        json(res, 500, {
          type: 'error',
          error: { type: 'api_error', message: String(e && e.message || e) },
        })
      } finally {
        clearTimeout(timer)
      }
      return
    }

    // Streaming: Anthropic SSE.
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'access-control-allow-origin': '*',
    })
    const t0 = Date.now()
    let tFirst = 0
    let reasoningChars = 0
    try {
      sseWrite(res, emitter.start())
      for await (const chunk of ctx.llm.stream(streamOpts)) {
        if (!tFirst && (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta')) tFirst = Date.now()
        if (chunk.type === 'reasoning-delta' && chunk.text) reasoningChars += chunk.text.length
        sseWrite(res, emitter.push(chunk))
      }
      if (!emitter.sawText && !emitter.sawTool) {
        // A turn with zero visible content poisons the CLI transcript: the next
        // `--resume` fails with "error_during_execution / last_content_type=none".
        // Emit a visible marker so the thread stays resumable.
        // Reasoning models spend the budget on the thinking chain first, so a
        // max-tokens stop with reasoning but no text is the most common cause of
        // "the model said nothing" — name it instead of leaving a blank turn.
        const why = emitter.finishKind === 'error'
          ? '（本轮未返回内容：' + (emitter.failure || '提供方未返回内容') + '）'
          : emitter.finishKind === 'max-tokens' && reasoningChars > 0
            ? '（模型把全部输出预算用在了思考链上，正文为空。请到「设置 → 模型 → 最大 token」调大数值，或关闭该模型的思考模式。）'
            : '（本轮未返回内容）'
        sseWrite(res, emitter.push({ type: 'text-delta', text: why }))
      }
      if (emitter.finishKind === 'error') {
        // Surface the provider failure instead of silently ending the turn.
        sseWrite(res, [{
          event: 'error',
          data: {
            type: 'error',
            error: { type: 'api_error', message: emitter.failure || 'provider stream failed' },
          },
        }])
      }
      sseWrite(res, emitter.finish())
    } catch (e) {
      if (looksLikeVisionError(e && e.message)) VISION_FAILED.add(`${resolved.provider}/${resolved.model}`)
      const events = emitter.finish()
      sseWrite(res, events)
    } finally {
      const tEnd = Date.now()
      if (reportStats) {
        const prefillMs = tFirst ? (tFirst - t0) : 0
        const decodeMs = tFirst ? (tEnd - tFirst) : (tEnd - t0)
        const outTok = emitter.outputTokens || Math.max(1, Math.ceil(reasoningChars / 3))
        try {
          reportStats({
            provider: resolved.provider,
            model: resolved.model,
            inputTokens: emitter.inputTokens,
            outputTokens: outTok,
            reasoningChars,
            prefillMs,
            decodeMs,
            // Sub-20ms windows produce absurd rates (10000 tok/s); report "unknown".
            prefillTps: prefillMs > 20 ? (emitter.inputTokens / (prefillMs / 1000)) : 0,
            decodeTps: decodeMs > 20 ? (outTok / (decodeMs / 1000)) : 0,
            totalMs: tEnd - t0,
            stopReason: emitter.finishKind,
            // Real provider message, so the UI never has to say a bare "error".
            failure: emitter.failure || (emitter.finishKind === 'error' ? 'provider stream failed' : ''),
          }, body)
        } catch (e) { /* ignore */ }
      }
      clearTimeout(timer)
      res.end()
    }
  })

  let listeningPort = null

  return {
    async start() {
      for (const port of PORT_CANDIDATES) {
        const ok = await new Promise((resolve) => {
          const onError = () => { server.removeListener('listening', onListen); resolve(false) }
          const onListen = () => { server.removeListener('error', onError); resolve(true) }
          server.once('error', onError)
          server.once('listening', onListen)
          try {
            server.listen(port, '127.0.0.1')
          } catch (e) {
            resolve(false)
          }
        })
        if (ok) {
          listeningPort = port
          ctx.logger?.info?.(`[ccp] bridge listening on 127.0.0.1:${port}`)
          return port
        }
      }
      // Fall back to an OS-assigned ephemeral port.
      const port = await new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(0, '127.0.0.1', () => resolve(server.address().port))
      })
      listeningPort = port
      return port
    },
    get port() { return listeningPort },
    get baseURL() { return listeningPort ? `http://127.0.0.1:${listeningPort}` : '' },
    stop() {
      return new Promise((resolve) => {
        if (!listeningPort) return resolve()
        server.close(() => { listeningPort = null; resolve() })
      })
    },
  }
}

/**
 * Environment variables injected into the claude CLI child process so it
 * talks to our bridge instead of the real Anthropic API. Ported from Hermes
 * `_bridge_env()`.
 */
export function bridgeEnv(port, model) {
  const base = `http://127.0.0.1:${port}`
  return {
    ANTHROPIC_BASE_URL: base,
    ANTHROPIC_AUTH_TOKEN: 'cc-bridge',
    ANTHROPIC_MODEL: model,
    ANTHROPIC_SMALL_FAST_MODEL: model,
    ANTHROPIC_DEFAULT_SONNET_MODEL: model,
    ANTHROPIC_DEFAULT_OPUS_MODEL: model,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: model,
    DISABLE_AUTOUPDATER: '1',
    DISABLE_AUTOUPDATE: '1',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    CLAUDE_CODE_DISABLE_SELF_NAMED_CERT_DROP: '1',
  }
}

export { toDshRequest, AnthropicStreamEmitter, estimateInputTokens }
