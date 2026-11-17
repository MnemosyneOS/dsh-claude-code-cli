---
name: dsh-claude-bridge
description: Drive the Claude Code Desktop workspace that this repo ships for DeepSeek Harness — authenticate against the DSH web server, read the model catalogue, start a turn, poll its event stream, answer tool approvals, and talk to the loopback protocol bridge. Use when the user asks to run, script, or debug this workspace's backend, or when an agent needs to talk to it from outside the panel.
---

# Talking to the DSH Claude bridge

The workspace ships two separate HTTP surfaces. Do not confuse them:

| Surface | Where | Who talks to it |
| :- | :- | :- |
| **Plugin API** | `/api/claude-code-parity/*` on the DSH web server | the panel, your scripts, this skill |
| **Protocol bridge** | `127.0.0.1:47823-47828`, Anthropic wire format | the `claude` CLI only |

Everything in sections 1–6 targets the **plugin API**. Section 7 covers the bridge.

## 1. Get a session cookie

The plugin API sits behind DSH's own auth. A launch token is exchanged for a cookie:

```bash
curl -s -c jar.txt -o /dev/null -w '%{http_code}\n' \
  'http://127.0.0.1:<port>/?token=<launchToken>'
```

Expect `303`. The cookie is `dsh-auth-<hash>`, `HttpOnly`, `SameSite=Strict`, 30 days.
The launch token is regenerated on **every process start** and printed once:

```
dsh web: http://127.0.0.1:<port>/?token=<launchToken>
```

If you do not have it, you cannot mint a cookie — restart DSH and read stdout.

## 2. Check health first

```bash
curl -s -b jar.txt http://127.0.0.1:<port>/api/claude-code-parity/health
```

```json
{ "ok": true, "plugin": "DSH-Claude Code CLI", "version": "2.5.1",
  "runtime": "dsh", "bridge": { "port": 47823, "baseURL": "http://127.0.0.1:47823" },
  "cli": "C:\\...\\claude.exe", "pid": 12345, "bootedAt": 1763... }
```

`cli: null` means the CLI was not found — ask the user to set
**Settings → Advanced → claude CLI path**. `plugin` is the display name, not a stable id;
never assert on it.

## 3. List models

```bash
curl -s -b jar.txt http://127.0.0.1:<port>/api/claude-code-parity/models
```

Returns `{ models: [{provider, providerName, model, name, local}], selected: {provider, model} }`.

To change the selection:

```bash
curl -s -b jar.txt -H 'content-type: application/json' \
  -d '{"provider":"deepseek-official","model":"deepseek-flash"}' \
  http://127.0.0.1:<port>/api/claude-code-parity/model/select
```

> The selection lives in a **shared** data root (`~/.dsh/ccp-data/settings.json`), visible to
> every DSH profile. If you change it, change it back.

## 4. Run a turn

```bash
curl -s -b jar.txt -H 'content-type: application/json' \
  -d '{"text":"hello","session_key":"my-key","cwd":"C:\\work"}' \
  http://127.0.0.1:<port>/api/claude-code-parity/chat
```

Returns `{ ok: true, job_id: "job-..." }`. To continue an existing CLI conversation, add
`"resume_id": "<cli session id>"`. Omit it and you get a fresh session — that is the difference
between "new session" and "send another message".

## 5. Poll the event stream

```bash
curl -s -b jar.txt \
  'http://127.0.0.1:<port>/api/claude-code-parity/poll?job_id=job-...&cursor=0'
```

`{ events: [...], cursor: N, done: bool, error?: string }`. Pass `cursor` back to get only new
events. Event kinds:

| kind | payload |
| :- | :- |
| `init` | `session_id` — the CLI session id, use it as `resume_id` next turn |
| `stats` | `provider`, `model`, `inputTokens`, `outputTokens`, `prefillTps`, `decodeTps`, `stopReason`, `failure?` |
| `blocks` | `blocks: [{type:'text', text}]` |
| `delta` | `text` — incremental output |
| `thinking` | reasoning text |
| `tool` | tool call: name + input |
| `tool_result` | `text`, `isError` |
| `result` | `ok`, `text`, `error`, `usage`, `contextWindow`, `duration_ms`, `num_turns` |

`stats[].failure` carries the provider's own error verbatim (`Insufficient Balance`,
`429 ...`, `401 invalid auth token`). A `result` with `ok: false` is a failed turn, not an
empty one.

## 6. Answer tool approvals

When the model wants to run a tool, the job blocks until someone decides:

```bash
# list pending
curl -s -b jar.txt 'http://127.0.0.1:<port>/api/claude-code-parity/approvals?job_id=job-...'

# decide
curl -s -b jar.txt -H 'content-type: application/json' \
  -d '{"id":"<request id>","decision":"allow"}' \
  http://127.0.0.1:<port>/api/claude-code-parity/approvals/decide
```

`decision` is `allow`, `always` or `deny`. The default timeout is 120 s and ends in a denial.

## 7. The protocol bridge (for the CLI, and for debugging)

The bridge speaks the **Anthropic Messages** wire format on loopback and converts to
`ctx.llm.stream()`. It requires a fixed header:

```bash
curl -s -N -X POST "http://127.0.0.1:<bridgePort>/v1/messages" \
  -H 'content-type: application/json' \
  -H 'x-api-key: cc-bridge' \
  -H 'anthropic-version: 2023-06-01' \
  -d '{"model":"<model>","max_tokens":64,"stream":true,
       "messages":[{"role":"user","content":"say hi"}]}'
```

Expect `message_start` → `content_block_delta` → `message_stop`. If this works but the panel
fails, the problem is on the CLI side, not the bridge.

Two invariants worth knowing when you build requests by hand:

- assistant messages **must** carry `source` — DSH reads `message.source.replayState`
  unconditionally and throws without it;
- a user message that contains only `tool_result` blocks is rejected by OpenAI-shaped
  providers, so add at least one `text` block.

## 8. Diagnose an upgrade

```bash
curl -s -b jar.txt -X POST http://127.0.0.1:<port>/api/claude-code-parity/upgrade/check
curl -s -b jar.txt -X POST http://127.0.0.1:<port>/api/claude-code-parity/upgrade
curl -s -b jar.txt http://127.0.0.1:<port>/api/claude-code-parity/upgrade/status
```

`check` reports `current`, `latest`, `hasUpdate`, `installRoot`. `status` reports `running`
(whether the npm process is genuinely alive), `before`, `after`, `changed` and the full log.
The updater reads the install layout first: a project-local `node_modules` install is upgraded
in its own root, and only a real global install gets `-i -g`.
