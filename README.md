# DSH-Claude Code CLI

A graphical Claude Code workspace that lives inside **DeepSeek Harness (DSH)** — no terminal,
no hand-edited `settings.json`, no lost sessions. It drives the real `claude` CLI as a child
process, so every flag and every `settings.json` key still works, and it routes the CLI at
whatever model you already have configured in DSH, local or remote.

**English** · [简体中文](README.zh-CN.md)

- 35 settings, generated from the CLI's own flags and `settings.json` keys
- Tool approvals inside the panel — or from your phone on the same Wi-Fi
- Attachments, a live thinking/tool chain, session history with archive and trash
- Every model DSH already has, in the composer's model picker
- One-click CLI upgrade that reads the real npm registry and respects how yours is installed
- English and Chinese UI, switchable in settings

---

## Contents

- [Why not just the terminal?](#why-not-just-the-terminal)
- [How it works](#how-it-works)
- [What you need](#what-you-need)
- [Install](#install)
- [Using it](#using-it)
- [Tool approvals](#tool-approvals)
- [Upgrading the CLI](#upgrading-the-cli)
- [Phone access](#phone-access)
- [Settings](#settings)
- [Security model](#security-model)
- [Troubleshooting](#troubleshooting)
- [Repository layout](#repository-layout)
- [Verification](#verification)
- [License and trademarks](#license-and-trademarks)

---

## Why not just the terminal?

The CLI is excellent and this plugin does not reimplement it. What it adds is the part a
terminal cannot give you:

| | Terminal | This plugin |
| :- | :- | :- |
| Every CLI flag | type them each time | one schema-driven settings page, remembered |
| `settings.json` keys | hand-edit JSON | generated from the official key names, injected with `--settings` |
| Tool approvals | `y` / `a` / `n` at the prompt | a card in the panel, or on your phone |
| Thinking and tool calls | interleaved text | a timeline you can collapse |
| Sessions | `--resume` and memory | a list with rename, pin, archive, restore, permanent delete |
| Attachments | paste a path | drag and drop, becomes an `@path` the CLI can read |
| Switching models | env vars and restarts | a picker in the composer |
| Upgrading | npm and luck | button, with the real version diff and the npm log |

## How it works

```
┌──────────────────────────────────┐
│ DeepSeek Harness (DSH)           │
│  ┌────────────────────────────┐  │
│  │ Claude Code Desktop panel  │  │   lib/client.js  (slots: sidebar + main)
│  └───────────┬────────────────┘  │
│              │ HTTP              │
│  ┌───────────▼────────────────┐  │
│  │ lib/index.js               │  │   ctx.webServer.register() — 30+ routes
│  └───────────┬────────────────┘  │
└──────────────┼───────────────────┘
               │ spawns one process per turn
      ┌────────▼─────────┐
      │ claude CLI       │   -p --output-format stream-json --settings <runtime file>
      └────────┬─────────┘
               │ ANTHROPIC_BASE_URL=http://127.0.0.1:<bridge>
      ┌────────▼─────────┐
      │ loopback bridge  │   Anthropic wire format  ⇄  DSH ctx.llm.stream()
      └────────┬─────────┘
               │
      ┌────────▼─────────┐
      │ your DSH model   │   whatever you authenticated: DeepSeek, a gateway,
      └──────────────────┘   a local Qwen on :8080, anything
```

Three consequences worth knowing:

1. **No Anthropic account is required.** The CLI is pointed at the bridge with
   `ANTHROPIC_BASE_URL` and `ANTHROPIC_MODEL`, so it never calls Anthropic unless your chosen
   model is an Anthropic one.
2. **One turn is one process.** MCP servers and background bash are rebuilt every turn.
   That is a cost, and it is why long-lived MCP connections are not reproduced here.
3. **The bridge speaks both wire formats.** The CLI talks Anthropic; almost every other
   provider talks OpenAI. The bridge converts per turn, including tool calls.

## What you need

| | |
| :- | :- |
| OS | Windows 10 1809+ — verified here. macOS / Linux should work (the plugin is pure Node) but we have not run it there. |
| DSH | **0.2.2-rc.3 or newer** (Node ≥ 24.9 ships with it) |
| Claude Code CLI | any recent version — the binary only, no login needed |
| A model | at least one already configured in DSH |
| Network | internet for the install and for update checks; none after that unless your model is remote |

## Install

### Step 1 — Install the Claude Code CLI

This plugin **does not** ship the Claude Code binary. It finds yours and runs it, so install
it first.

**Windows, native installer (recommended, no Node needed):**

```powershell
irm https://claude.ai/install.ps1 | iex
```

**Windows, npm (Node.js 22 or newer; never use `sudo`):**

```powershell
npm install -g @anthropic-ai/claude-code@latest
```

**macOS / Linux:**

```bash
curl -fsSL https://claude.ai/install.sh | bash
```

If you already have it, confirm with `claude --version`. The plugin also accepts an explicit
path in **Settings → Advanced → claude CLI path**, which is the field to use when the CLI
lives in a project-local `node_modules` (a common layout for bundled installs).

### Step 2 — Install the plugin into DSH

The plugin is a normal DSH package. Link it into a profile and add it to that profile's
bundle list:

```bash
cd ~/.dsh/profiles/<profile>
npm install "link:<path-to-this-repo>"
```

Then add `"@local/dsh-claude-code-cli"` to `dsh.profile.bundles` in
`~/.dsh/profiles/<profile>/package.json`, and restart DSH.

`<profile>` is `desktop` for the desktop app. Note that `desktop` is owned by the Electron
process and **cannot** be started from the CLI — that is expected, and the plugin handles it
by using the `web` profile (same bundle set) for its phone-access instance.

### Step 3 — Pick a model

Open DSH → sidebar → **Claude Code Desktop** → **Settings → Model**. Pick any model DSH
already has. Send a message.

## Using it

| Area | What you get |
| :- | :- |
| Composer | model picker (bottom right), permission mode, workspace picker, attachments, paste-anywhere |
| Per reply | model name, timestamp, token speed, cache hit rate, copy, branch into a new session |
| Context | a ring progress indicator in the composer, fed by the CLI's own `modelUsage` |
| History | rename, pin, archive, restore, permanent delete, batch operations, copy ID, groups |
| Thinking | a collapsible timeline, visually distinct from the answer, with a status icon per step |

Diagnostics live at `GET /api/claude-code-parity/health` (bridge port, CLI path, version),
plus `/cli`, `/models` and `/upgrade/status`.

## Tool approvals

The CLI is started with `--permission-prompt-tool mcp__ccp-approval__approve` and a generated
`mcp-config.json` that points at `lib/approval-mcp.js`. Every tool the model wants to run
becomes a card in the panel: **allow once**, **always allow**, or **deny**.

- Timeout defaults to 120 s (configurable, 10–600 s); on timeout the tool is denied.
- **Settings → Tool permissions** can auto-approve the read-only family
  (`Read`, `Glob`, `Grep`, `WebFetch`, `WebSearch`, `NotebookRead`, `TodoWrite`).
- The permission mode is passed straight through as `--permission-mode`, so
  `acceptEdits`, `plan`, `bypassPermissions` etc. behave exactly as in the CLI.

## Upgrading the CLI

**Settings → Advanced → Upgrade Claude CLI** does three real things:

1. Reads the installed version from the CLI's own `package.json` (falling back to
   `claude --version`), then fetches `https://registry.npmjs.org/@anthropic-ai/claude-code/latest`
   and compares them semantically. No hard-coded strings.
2. Determines **how** your CLI is installed by walking up from the binary to
   `node_modules/@anthropic-ai/claude-code`. A project-local install is upgraded in its own
   root; only a genuine global install gets `npm i -g`.
3. Streams npm's stdout/stderr into `upgrade-state.json` line by line, and reports
   `before → after` plus whether anything actually changed.

> This matters: `npm update -g @anthropic-ai/claude-code` silently does nothing for a
> project-local install, which is exactly why "the update button did nothing" is a common
> report. The plugin inspects the layout first.

## Phone access

**Settings → Mobile access** lists the machine's real LAN IPv4 interfaces. Pick one and press
**Start**. The plugin then:

- starts a second DSH web instance bound to that LAN address
  (`--host <LAN-IP> --trusted-host <host:port>`) — DSH **rejects** `0.0.0.0`, so a concrete
  literal is required;
- parses the tokenised URL from that instance's stdout;
- opens a tiny **short-address redirect** on `port + 1`, so you can type
  `http://192.168.1.103:9241` on the phone instead of the full token URL.

The phone gets the complete DSH UI including this plugin, sharing session data with the
desktop. **Stop** tears down both the instance and the redirect.

## Settings

35 items in six groups. Every one of them is wired into the run path — the full round-trip is
covered by the verification suite.

| Group | Items (schema key) |
| :- | :- |
| General (6) | `default_cwd`, `permission_mode`, `permission_prompts`, `timeout`, `tool_policy`, `language` |
| Appearance (5) | `theme`, `show_thinking`, `show_tool_output`, `transcript_view`, `stream_speed` |
| Tools & Permissions (7) | `allow_read`, `allow_write`, `allow_bash`, `allow_glob`, `allow_web`, `approval_timeout`, `auto_approve_readonly` |
| Model (6) | `model`, `provider`, `reasoning_effort`, `max_tokens`, `temperature`, `vision_mode` |
| Session (5) | `auto_title`, `keep_history`, `history_limit`, `paste_doc_limit`, `export_format` |
| Advanced (6) | `system_prompt`, `append_identity`, `strip_images_on_error`, `debug`, `cli_path`, `extra_flags` |

Full descriptions and defaults: [docs/configuration.md](docs/configuration.md).

`reasoning_effort` defaults to `auto` — meaning "do not send the parameter". Forwarding a
level to a model that does not support it fails the whole turn, so `auto` is the safe default
and the plugin migrates older configs to it once (`settings_version`).

## Security model

- The bridge listens on **loopback only** and requires the fixed header `x-api-key: cc-bridge`.
- DSH web access uses a launch token that is exchanged for an `HttpOnly`, `SameSite=Strict`
  cookie; the token is regenerated on every process start.
- Phone access requires you to press **Start**; nothing is exposed until you do, and the
  short address only 302-redirects to the tokenised URL — it never serves content itself.
- Credentials never enter this repository. The plugin reads whatever DSH already
  authenticated and passes provider errors through verbatim.

## Troubleshooting

| Symptom | Cause | Fix |
| :- | :- | :- |
| Panel is blank, backend works | `__ModuleLoader__.load({id})` does not match `package.json` `name` | they must be byte-identical |
| Second turn always fails | assistant messages missing `source` | fixed in 2.5.1; check you are not running an old build |
| `does not support reasoning effort "medium"` | a level was forwarded to a model that rejects it | set reasoning effort to `auto` |
| `message content cannot be empty` | tool-result-only user message | fixed in 2.5.1; 2.5.2 no longer needs a placeholder — such a message is simply not emitted |
| `profile "desktop" is managed exclusively by the Electron application` | CLI cannot start the desktop profile | use the `web` profile |
| Update button reports no change | CLI is installed project-locally, `-g` cannot reach it | fixed; the plugin detects the layout |
| Plugin card shows an old name | the card reads `locale/<lang>.json` `meta.title`, not `package.json` | update the locale files and restart |
| Every tool returns `No result provided` | tool results were packed as parts of a user message; DSH only reads text/image there | fixed in 2.5.2 — results travel as their own `role: 'tool'` message |
| The transcript jumps to the bottom while reading | auto-follow keyed on "new output" instead of "already at the bottom" | fixed in 2.5.2; the round arrow at the top right jumps back down |
| A reasoning model shows thinking but no answer | `blocks` merged into the streaming thinking row | fixed in 2.5.2; see the knowledge base entry ㉚ |
| The thinking chain appears all at once, never while it happens | the CLI was not asked for deltas, the panel appended whole messages, and the row was collapsed to one line | fixed in 2.5.3 — `--include-partial-messages` + a typing pump + a row that opens while live; see entry ㉝ |
| After an update the panel still behaves like the old build | the desktop process started before the files changed, so it runs the cached module | since 2.5.3 a notice above the transcript says the running code is old; closing the window is not quitting |
| `dsh: fatal load failure: EPERM ... rename` | two instances sharing `~/.dsh/ccp-data` renamed the same job file | fixed in 2.5.3 — writes retry and never escape as an unhandled rejection; see entry ㉞ |
| An image attachment returns `Cannot read properties of undefined (reading 'attachmentId')` / `Claude Code error` | Anthropic image blocks were forwarded with `source`, while DSH requires a durable `attachment` ref | fixed in 2.5.4 — images are admitted through `ctx.get('attachments')` and swapped in by reference; see entry ㉟ |
| A long thinking chain stops mid-sentence | the expanded detail was sliced to 8,000 characters and the typing pump capped at 400 chars/s | fixed in 2.5.5 — full detail is rendered and the pump scales with backlog; see entry ㊱ |
| A just-sent instruction vanishes once the model starts thinking | overlapping fire-and-forget history saves: a stale snapshot finished last and wrote a shorter message list | fixed in 2.5.6 — saves carry a monotonic revision and older writes are rejected; see entry ㊲ |
| `exceed_context_size_error` / `request (131770 tokens) exceeds the available context size` | `--resume` replays the whole transcript; a long Chinese session exceeds the local 131k window while the CLI's default compact threshold follows a reported 1M context | fixed in 2.5.7 — `--autocompact 100000`, a CJK-aware hard budget in the bridge, and an actionable Chinese hint; tune `设置 → 会话 → 自动压缩阈值（Token）` |
| Thinking stops appearing when the reply also runs tools | the typing pump counted text queued *behind* a tool marker, so the marker at the head was never released and later thinking was unreachable | fixed in 2.5.8 — head markers release immediately; backlog is measured only over the leading text run; see entry ㊴ |

More, with root causes and evidence, in [docs/architecture.md](docs/architecture.md) and the
knowledge base shipped alongside this plugin.

## Repository layout

```
├── package.json                 DSH manifest (dsh.bundle.patch + dsh.client.inject)
├── patches/bundle.yaml          loader patch — default config values
├── icon.svg  locale/{en,zh}.json
├── lib/
│   ├── index.js                 host: routes, job manager, CLI spawn, upgrade, mobile
│   ├── client.js                client: sidebar + main panel (single-file React)
│   ├── bridge.js                Anthropic ⇄ DSH LLM protocol bridge
│   ├── approval-mcp.js          the MCP server the CLI calls to ask for permission
│   └── common.js                persistence, settings schema, CLI history scan
├── docs/                        architecture, configuration, mobile, publishing
├── integrations/claude-code/    Claude Code plugin wrapper (marketplace entry)
├── tools/verify/                the CDP + HTTP verification harness
└── .claude-plugin/              marketplace manifest
```

## Verification

Nothing here is claimed without being run. The harness in `tools/verify/` drives a real DSH
instance and a real headless Chrome:

```bash
# start an isolated instance (note the token it prints)
dsh --profile <verify-profile> --port 39120 --host 127.0.0.1 --no-open

node tools/verify/_verify_all.mjs      "<token>"   # 21 backend assertions
node tools/verify/_verify_ui.mjs       "<token>"   # 9 real-browser assertions
node tools/verify/_verify_chat.mjs     "<token>"   # two real turns through CLI + bridge
node tools/verify/_verify_reply_unit.mjs            # 15 event-merge checks, no instance needed
node tools/verify/_verify_reply_ui.mjs "<token>"   # 13 — the answer must be painted
node tools/verify/_verify_reply_history.mjs "<token>" # 15 — damaged records recover
node tools/verify/_verify_scroll_ui.mjs "<token>"  # 22 — scroll position holds, arrow works
node tools/verify/_verify_tool.mjs     "<token>"   # 13 — the model reads real tool output
node tools/verify/_verify_image.mjs    "<token>"   # 8  — an uploaded image does not kill the turn
node tools/verify/_verify_thinking_full.mjs "<token>" # 7 — long chains render end to end
node tools/verify/_verify_split_ui.mjs "<token>"   # 12 — split view + Start pane
node tools/verify/_verify_send_ui.mjs  "<token>"   # 6  — 40 MB attachment round trip
node tools/verify/_verify_mobile_port.mjs "<token>" 9260  # 9 — port fallback
node tools/verify/_verify_typing_ui.mjs "<token>"   # 18 — the chain types itself out
node tools/verify/_verify_save_guard.mjs "<token>"  # 5  — stale history saves are rejected
node tools/verify/_verify_usermsg_persist.mjs "<token>" # 9 — sent messages survive later turns
node tools/verify/_verify_context_overflow.mjs "<token>" # 16 — autocompact argv, history trim, friendly error
node tools/verify/_verify_title_stable.mjs "<token>" # 9 — stable topic names, locked renames
node tools/verify/_verify_pump_interleave.mjs         # 8  — tools cannot freeze the thinking pump
```

Baseline at 2.5.8: **21/21**, **9/9**, **15/15**, **13/13**, **15/15**, **22/22**, **12/12**,
**12/12**, **6/6**, **9/9**, **13/13**, **18/18**, **8/8** (image), **10/10** (long thinking),
**5/5** (save guard), **9/9** (message persistence), **16/16** (context overflow), **9/9** (title),
**8/8** (pump interleave),
plus a two-turn conversation on one session id. The scroll check passed 22/22 on a clean rerun after
one flaky full-suite pass (18/22) caused by browser timing.

The typing check samples the real DOM every 200 ms: a one-shot render can produce at most one step
from zero to full, so the run requires many distinct intermediate lengths (measured: 95 steps between
0 and 928 characters for the chain, 36 for the answer). The chat harness pins a working text model and restores your previous selection
afterwards, so it never leaves your model picker moved.

## License and trademarks

MIT — see [LICENSE](LICENSE) and [NOTICE](NOTICE). **Claude** and **Claude Code** are
trademarks of Anthropic, PBC. This is an independent front end for a locally installed CLI,
not affiliated with or endorsed by Anthropic. **DeepSeek Harness** is a product of DeepSeek;
this is a third-party plugin for that host.
