#!/usr/bin/env node
/**
 * Claude Code Parity for DSH — approval MCP bridge.
 *
 * Claude Code calls this MCP server via --permission-prompt-tool when a tool
 * needs approval. It writes a req-*.json file, then blocks (up to timeout)
 * waiting for the front-end to write a dec-*.json file with the user's choice
 * (allow / allow-always / deny), and returns the result to Claude Code.
 *
 * This is the DSH port of Hermes' _prepare_approval + _approval_watcher file
 * exchange. The only protocol the front-end needs is:
 *   req: { id, tool, input, created }
 *   dec: { id, decision: 'allow'|'allow-always'|'deny' }
 */

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import readline from 'node:readline'
import { randomUUID } from 'node:crypto'

const argv = process.argv.slice(2)
function arg(name, fallback) {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
}
const DIR = path.resolve(arg('--dir', path.join(process.cwd(), 'approvals')))
const TOKEN = arg('--token', '')
const TIMEOUT_MS = Math.max(10, Number(arg('--timeout', '120'))) * 1000
// settings.auto_approve_readonly: read-only families never bother the user.
const AUTO_READONLY = arg('--auto-readonly', '') === '1'
const READONLY_TOOLS = new Set(['Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'NotebookRead', 'TodoWrite'])

fs.mkdirSync(DIR, { recursive: true })

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n')
}

async function waitDecision(id) {
  const decFile = path.join(DIR, `dec-${id}.json`)
  const deadline = Date.now() + TIMEOUT_MS
  while (Date.now() < deadline) {
    try {
      const raw = await fsp.readFile(decFile, 'utf-8')
      const dec = JSON.parse(raw)
      return dec.decision || 'deny'
    } catch (e) {
      await new Promise((r) => setTimeout(r, 200))
    }
  }
  return 'deny' // timeout -> deny, matching 2.5.1 behavior
}

/** MCP tool handler: approve a tool use. */
async function approve(input) {
  const toolName = input.tool_name || input.tool || 'tool'
  if (AUTO_READONLY && READONLY_TOOLS.has(String(toolName))) {
    return {
      behavior: 'allow',
      message: '只读工具按设置自动批准',
      updatedInput: input.input || input.arguments || {},
    }
  }
  const id = 'req-' + randomUUID().replace(/-/g, '').slice(0, 12)
  const req = {
    id,
    tool: toolName,
    input: input.input || input.arguments || {},
    description: input.description || '',
    created: Date.now(),
    token: TOKEN,
  }
  await fsp.writeFile(path.join(DIR, `${id}.json`), JSON.stringify(req, null, 2), 'utf-8')
  const decision = await waitDecision(id)
  const allowed = decision === 'allow' || decision === 'allow-always'
  return {
    behavior: allowed ? 'allow' : 'deny',
    message: allowed
      ? (decision === 'allow-always' ? '用户批准（本次会话始终允许）' : '用户批准')
      : '用户拒绝',
    updatedInput: input.input || input.arguments || {},
  }
}

/* --------------------------------------------------- minimal MCP stdio server */

const TOOL = {
  name: 'approve',
  description: 'Request user approval for a Claude Code tool call inside the DSH parity panel.',
  inputSchema: {
    type: 'object',
    properties: {
      tool_name: { type: 'string', description: 'Name of the tool requesting approval' },
      input: { type: 'object', description: 'The tool input arguments' },
      description: { type: 'string', description: 'Human-readable description' },
    },
    required: ['tool_name'],
  },
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })

rl.on('line', async (line) => {
  let msg
  try { msg = JSON.parse(line) } catch (e) { return }
  const { id, method, params } = msg

  if (method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: params?.protocolVersion || '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'ccp-approval', version: '2.5.1' },
      },
    })
    return
  }
  if (method === 'notifications/initialized' || method === 'initialized') return
  if (method === 'tools/list') {
    send({ jsonrpc: '2.0', id, result: { tools: [TOOL] } })
    return
  }
  if (method === 'tools/call') {
    const name = params?.name
    if (name === 'approve') {
      try {
        const result = await approve(params.arguments || {})
        send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(result) }] } })
      } catch (e) {
        send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: 'approval error: ' + (e && e.message || e) }], isError: true } })
      }
      return
    }
    send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'unknown tool: ' + name } })
    return
  }
  if (method === 'ping') {
    send({ jsonrpc: '2.0', id, result: {} })
    return
  }
  if (id !== undefined) {
    send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'method not found: ' + method } })
  }
})

rl.on('close', () => process.exit(0))
