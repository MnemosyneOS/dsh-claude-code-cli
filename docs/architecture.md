# Architecture

> Companion to the top-level [README](../README.md). Everything below was measured on a
> running instance, not inferred from the source.

## Topology

```
claude CLI  (claude.exe, -p --output-format stream-json --verbose)
      │  ANTHROPIC_BASE_URL=http://127.0.0.1:<bridgePort>   (47823-47828, first free)
      ▼
lib/bridge.js   Anthropic Messages  ⇄  DSH ctx.llm.stream()
      │
      ▼
DSH provider (deepseek-official / agnes / a local Qwen / any configured model)
```

The bridge binds loopback only and requires the fixed header `x-api-key: cc-bridge`. Every
job writes its own `settings-runtime.json` and injects `ANTHROPIC_BASE_URL` / `ANTHROPIC_MODEL`
into the child process environment, so the CLI never needs an Anthropic login.

## Module responsibilities

| File | Role |
| :- | :- |
| `lib/index.js` | Host entry: `export const name/inject/apply(ctx, config)`. Registers every route through `ctx.webServer.register()`, owns the job manager, spawns the CLI, runs approvals, upgrades and the mobile instance. |
| `lib/bridge.js` | Anthropic ⇄ DSH conversion. `Emitter` assembles SSE events and decides `stop_reason`. |
| `lib/common.js` | Data root, job read/write with a serial lock, CLI transcript scanning, `normalizeStreamJson`, the `cli-meta` overlay, the settings schema. |
| `lib/client.js` | Single-file front end: `window.__ModuleLoader__.load()` plus `ctx.slots`, rendered with `h()`, styles inline. |
| `lib/approval-mcp.js` | The MCP server the CLI calls (`--permission-prompt-tool mcp__ccp-approval__approve`). |
| `patches/bundle.yaml` | Bundle patch that mounts the plugin into a profile. |

## Request path of one turn

1. `POST /chat` creates `job-<id>.json` and returns `job_id` immediately.
2. `runJob()` resolves the CLI, writes `settings-runtime.json` and `mcp-config.json`, then
   spawns the CLI with the full argv (see `lib/index.js` `buildArgv`).
3. The CLI calls the bridge; the bridge calls `ctx.llm.stream()` and converts the chunks back.
4. `pushEvent()` appends events to the job file under `withJobLock`, so the poller never reads
   a half-written file.
5. `GET /poll?job_id&cursor` returns only events past `cursor`.

## StreamChunk mapping (DSH → Anthropic SSE)

| DSH chunk | Anthropic event |
| :- | :- |
| `block-start` | ignored (blocks open lazily) |
| `text-delta` | `content_block_delta{text_delta}` |
| `reasoning-delta` | `content_block_delta{thinking_delta}` |
| `tool-call-delta` | `content_block_start{tool_use}` + `input_json_delta` |
| `usage` | accumulates `input_tokens` / `output_tokens` |
| `finish{reason}` | `message_delta{stop_reason}`: `tool_use` if tools ran, else `end_turn` / `max_tokens` |

When `reason.kind === 'error'`, an extra `event: error` is emitted and `reason.failure.message`
is copied into the `stats` event's `failure` field, which is how the UI distinguishes
"finished with nothing" from "failed".

## Install-layout detection

```
<installRoot>/package.json                                       declares "@anthropic-ai/claude-code": "^x.y.z"
<installRoot>/node_modules/@anthropic-ai/claude-code/package.json  the real version lives here
<installRoot>/node_modules/@anthropic-ai/claude-code/bin/claude.exe
```

`cliInstallLayout(cli)` walks up from the executable
(`binDir → pkgDir → scopeDir(@anthropic-ai) → modulesDir(node_modules) → root`) and reports
whether the install is project-local. `installedCliVersion()` reads `pkgDir/package.json`
directly — faster than `claude --version` and unaffected by a running process.

This is the whole reason the upgrade button works: `npm update -g` cannot reach a
project-local install, which is the common layout for bundled distributions.

## Sampling parameters and vision fallback

| Parameter | Precedence | Special case |
| :- | :- | :- |
| `reasoningEffort` | CLI request > settings | settings value `auto` means **do not send it** — forwarding a level to a model that rejects it fails the turn |
| `maxTokens` | CLI request > settings | `0` / empty means do not send |
| `temperature` | settings | `0` is treated as "provider default", not sent |

Vision: `vision_mode = path_only` replaces images with a text placeholder; `image_url` converts
to a data URI; otherwise base64. Any request that fails with an image-related error records the
`provider/model` in `VISION_FAILED`, and later requests for the same pair drop images
automatically unless `strip_images_on_error` is off.

## Data directory

```
~/.dsh/ccp-data/
├── sessions/<key>.json     plugin sessions (full message list)
├── cli-meta/<cliId>.json   editable overlay for CLI transcripts (title/pinned/archived/group/deleted)
├── jobs/job-*.json         argv, events, exit_code, stderr
├── approvals/job-*/        per-job mcp-config.json and decision files
├── uploads/local-id-*/     attachments and settings-runtime.json (rewritten per run)
├── settings.json           provider/model/permission_mode/default_cwd/settings_version
├── upgrade-state.json      last upgrade: before/after/changed plus the npm log
└── mobile-state.json       LAN instance host/port/url/shortUrl
```

> The data root is **shared by every DSH profile**. Any code that writes settings from a
> read-only path pollutes another profile — `ensureSelection()` is therefore read-only by
> design and never writes back.

## Front-end invariants

- `window.__ModuleLoader__.load({ id })` must be **byte-identical** to `package.json` `name`.
  A mismatch produces a blank panel while every HTTP route stays green.
- Theme is applied by expanding `PALETTES[theme]` into CSS variables on `.ccp-root`.
- `viewPrefs = { showThinking, showToolOutput, transcriptView }` is threaded down to
  `renderMessage`; in `compact` mode a work row with no detail hides its chevron.
- Streaming cadence: `stream_speed` 0–100 maps to `max(60, 350 - speed × 2.9)` ms polling.
- Drafts are stored per session id in `localStorage.ccp.drafts`.
- `applyEvent()` is a pure function and `msgStoreRef` buckets by session key, so switching
  sessions cannot leak content.

## The plugin card name

The marketplace card title and subtitle come from **`locale/<lang>.json` → `meta.title` /
`meta.description`**, not from `package.json`. Editing `name`, `dsh.name` or `description` will
not change the card. Locale files are read at process start, so a restart is required.

## Stale-code detection

A DSH plugin is loaded into the host process once, at startup. Editing the source afterwards
changes nothing until the process restarts, and the symptom is indistinguishable from a broken
feature — this cost several debugging rounds before it was instrumented.

`GET /health` therefore reports:

```json
"build": { "file": "…/lib/index.js", "mtime": 1794916992786, "loadedAt": 1794917002963, "stale": false }
```

`loadedAt` is captured when the module is evaluated; `mtime` is read from disk on every health
call (deliberately uncached). `stale: true` means the file changed **after** this process
loaded it, so the running code is older than what is on disk. The settings page renders that as
a red banner, and shows the load time next to the current version so "which build am I on" is
answerable from the UI.

Verify it by touching the file while an instance runs:

```bash
touch lib/index.js && curl -s -b jar.txt http://127.0.0.1:<port>/api/claude-code-parity/health
# → "stale": true
```
