# Changelog

All notable changes to **DSH-Claude Code CLI** are recorded here.
This project follows [Semantic Versioning](https://semver.org/).

## [2.5.9] - 2026-11-19

### Fixed

- **Scrolling up inside a live thinking chain now stays put.** `WorkRow` set `el.scrollTop =
  el.scrollHeight` on every thinking delta, so a long chain yanked the reader back to the newest line
  several times a second and the beginning was unreadable. Auto-follow is now conditional on the box
  already being at its bottom (`detailFollowsBottom`, 24 px tolerance); when it is not, a small
  ↓ button in the row header returns to the newest line. Covered by `_verify_thinking_scroll`
  (9 checks, including a reverse proof that the old rule yanked a parked box).

## [2.5.8] - 2026-11-19

### Fixed

- **Thinking no longer freezes when a turn also calls tools.** The typing pump counted every text
  fragment in its queue as backlog, including text queued *behind* a tool/result marker. Once the
  first text run was typed, the marker sat at the head but the backlog was still non-zero, so the
  pump never released it and never reached the later thinking text. A legal-document turn with 2,864
  thinking deltas and four tool calls therefore stalled with no visible thinking at all. The pump now
  releases head-of-queue markers immediately and measures backlog only over the leading contiguous
  text run, preserving order while keeping the stream moving. Covered by `_verify_pump_interleave`
  (8 checks, including a reverse proof that the old rule deadlocks on the same input).

## [2.5.7] - 2026-11-19

### Fixed

- **Long resumed sessions no longer die with `exceed_context_size_error`.** `--resume` makes Claude CLI
  replay its entire transcript; the legal-review session had grown to 1.79 MB and the local Qwen model
  received 131,770 prompt tokens against a 131,072 window. The CLI's own default auto-compact threshold
  followed a 1M-token value reported by the model catalog, so it never fired. Three layers now prevent
  the overflow: the CLI is launched with `--autocompact 100000` when the installed binary supports it;
  the protocol bridge trims replayed history to a hard budget before DSH sees it (15% headroom, newest
  messages always kept, with a system notice when older turns are omitted); and token estimation now
  weights CJK characters, since `chars / 4` measured a real 134k-token Chinese transcript as only 75k.
- **The raw provider JSON is no longer dumped into the chat.** `exceed_context_size_error` is translated
  into a Chinese hint that reports the actual token counts and points to the new
  `设置 → 会话 → 自动压缩阈值（Token）` control, or to starting a new session. The old "check your
  credentials/quota" advice is replaced for this specific failure.
- **Session names are now stable topic phrases.** A small local model kept returning a 24-character
  verbatim slice of the prompt instead of a topic, e.g. `请根据我上传的一审判决书和全部证据材料，独立完成`.
  Recognised domains (labour dispute/appeal, résumé, Python errors, contracts, papers) now use a
  deterministic short topic such as `劳动争议二审分析`; for other domains a model candidate is accepted
  only if it is ≤16 characters, has no sentence punctuation and is not a copy of the prompt.

### Added

- `设置 → 会话 → 自动压缩阈值（Token）` (default 100000). It drives both the CLI auto-compact flag and
  the bridge's history budget. Covered by `_verify_context_overflow` (16 checks); title behaviour is
  covered by `_verify_title_stable` (9 checks, previously 7/9).

## [2.5.6] - 2026-11-19

### Fixed

- **A just-sent instruction no longer disappears from the conversation.** Each turn wrote history in a
  fire-and-forget task that captured the session snapshot at turn start and had no ordering. When the
  title call (a local model, up to 15 s) was still running, a rapid follow-up or a second DSH instance
  sharing `~/.dsh/ccp-data` could finish a save last with a stale, shorter message list — silently
  dropping the newest user message while its reply stayed. Symptom: "I sent an instruction, the model
  started thinking, and my instruction was gone" — the prompt survived only in the job record and the
  session title. Saves now carry a monotonic revision ordered per session; the backend rejects any
  older revision, and the front end lets only the newest in-flight save write. Explicit edits
  (delete/prune/rename, which carry no revision) still apply.

## [2.5.5] - 2026-11-18

### Fixed

- **Long thinking chains are no longer cut off.** The expanded thinking row sliced its detail to
  8,000 characters, so a real 30,000-character chain silently lost everything after that mark
  while still looking like a complete row. The cap is gone. The typing pump also had a 400 chars/s
  ceiling: a long chain fell minutes behind the model and only appeared in full in the final flush.
  It now scales up to 6,000 chars/s for large backlogs (still typed in many frames), and consecutive
  1–3 character deltas are coalesced in the queue instead of creating tens of thousands of entries.
  Covered by `_verify_thinking_full` (7 checks on a 46,918-character chain, including its final
  marker); the old build fails 2/7 at exactly 8,000 characters. The existing typing check stays
  18/18 (134 distinct intermediate chain lengths).

## [2.5.4] - 2026-11-18

### Fixed

- **An image attachment no longer kills the turn.** Uploading a screenshot and sending it with `@path`
  made the model answer `（本轮未返回内容：Cannot read properties of undefined (reading 'attachmentId')）`,
  followed by `Claude Code error`. The bridge forwarded Anthropic's image block as
  `{ type:'image', source:{ type:'base64', ... } }`, but DSH content blocks require
  `{ type:'image', attachment: ImageAttachmentRef }`; the adapter dereferenced a missing attachment id
  and ended the stream with an error chunk. Images are now decoded and admitted once, in request order,
  through `ctx.get('attachments').saveImages()`, then swapped into durable references — including images
  replayed from CLI history and from tool results. A refused or unreadable image degrades to a text note
  instead of failing the turn. Tool messages also carry the required `source: { kind:'tool', callId }`.
  Request conversion errors now answer with a JSON 500 instead of taking down the DSH process.
  Covered by `_verify_image` (8 checks: real upload → chat → local model, no error stats, no placeholder,
  successful result), plus the existing tool and two-turn regressions.

## [2.5.3] - 2026-11-18

### Added

- **The thinking chain is now typed out while it happens.** It used to arrive as one finished block:
  the CLI was not asked for provider deltas, the panel appended whole messages, and the thinking row
  was collapsed to a single line anyway — so the process was invisible and only the result appeared.
  Three changes make it visible together: `--include-partial-messages` on the CLI, a typing pump in the
  panel that releases a few characters per frame (paced so a long chain still keeps up), and a thinking
  row that opens itself while it is live and scrolls its own detail box. Measured on a real local model:
  95 distinct intermediate lengths between 0 and 928 characters.
- **Archive and the recycle bin are now separate lists.** "Archive" and "delete" both only set
  `archived`, so the two were the same pile. Delete now also sets `deleted`, the sidebar footer offers
  archive / recycle bin / settings as three icon buttons, and records filed before the split are treated
  as binned (they all came from the old delete button). Bulk actions follow the open list: restore and
  purge inside the bin, pin/archive/delete on live conversations.
- Settings moved out of the `+` menu into the sidebar footer, next to the archive and bin it belongs with.
- **An update that never loaded now says so, at the top of the conversation.** The panel used to look
  and behave exactly like the build it had just replaced, which is how a fixed tool bug got reported as
  "still broken": the desktop process had started before the fix existed. The stale-build notice moved
  out of Settings → Advanced and onto the transcript, and clears itself once the running build is current.

### Fixed

- **A job write could take the whole plugin down.** `writeJson` renamed a temp file over the target,
  which on Windows fails with `EPERM` while another process holds the file open — the normal case when
  the desktop app, a phone-access instance and a verification instance share `~/.dsh/ccp-data`. The
  rejection escaped the stdout reader and surfaced as `dsh: fatal load failure`, killing the instance
  mid-turn. Writes now retry with backoff and fall back to writing through the handle, and the reader
  can no longer throw.

## [2.5.2] - 2026-11-17

### Fixed

- **Every tool call came back to the model as "No result provided".** The CLI ran the tools and the
  job log held their output, but the model insisted all five calls — including a bare `echo` — had
  returned nothing. The bridge packed tool results as `{type:'tool-result'}` parts inside a user
  message, while DSH's harness vocabulary only reads text/image out of a user message: the results
  were silently dropped, and DSH's `transformMessages()` answered each unanswered tool call with a
  synthetic `No result provided` + `isError`. Results now travel as their own `role: 'tool'`
  messages (`toolCallId` + `content` + `isError`), an empty result says `(no output)` instead of
  nothing, and a user message that carried only tool results no longer leaves a blank turn behind.
  Covered by `_verify_tool` (12 checks: three parallel commands with unpredictable `$RANDOM` output
  plus a follow-up turn that replays the whole tool history).
- **The transcript was yanked back to the bottom on every update.** Auto-follow keyed on "new
  message arrived" instead of "the reader is already at the bottom", so scrolling up during a long
  answer was impossible. Following now depends on scroll position, deliberate jumps (send, session
  switch) still force it, and a round jump-to-bottom button appears at the top right of the
  transcript whenever the view is not at the bottom. Covered by `_verify_scroll_ui` (22 checks).
- **The jump button rendered as a rounded square.** The host sets `corner-shape: superellipse(1.5)`
  globally, which turns `border-radius: 50%` into a squircle; the button now sets
  `corner-shape: round` explicitly.
- **A reasoning model showed only its thinking, never its answer.** The turn rendered as a
  single muted "思考" line and the reply was nowhere on screen, even though the job record
  held the full text. `applyEvent` merged incoming events on `role === 'assistant' &&
  streaming` alone, and a reasoning model emits `thinking` first — so the following `blocks`
  were appended *into* the thinking row. The message kept `kind: 'thinking'`, and
  `renderMessage` dispatches on `kind` first, so no branch could ever paint that text.
  Events now merge only into a row of their own kind (a plain text row is promoted to
  `blocks` instead of stacking a second answer box), abandoned rows are marked finished, and
  a turn whose body is missing falls back to `result.text` — which also repairs the records
  already stored in this shape. Covered by `_verify_reply_unit` (15 checks, 6 of which fail
  on the previous build), `_verify_reply_ui` (13 checks, real local model) and
  `_verify_reply_history` (15 checks, real polluted records).
- **A task with a large attachment could hang the composer forever.** The panel sat on
  "working…" with no error and no job created. Three faults stacked up:
  1. Every non-image attachment was base64'd into a JSON body. A 40 MB video became a 55 MB
     request, tripped the 32 MB `readBody` cap mid-stream, and the 413 sent while the client
     was still uploading left the keep-alive socket unusable — so the `/chat` request that
     actually starts the task never delivered its body. Attachments now use
     `POST /upload/raw`, streamed straight to disk with no base64 and a 512 MB ceiling.
  2. No request had a deadline, so a stuck fetch left the busy flag set forever (it is only
     cleared in a `finally`). Every call now has a timeout, the poll loop gives up after 15
     minutes of silence, and upload failures are reported instead of swallowed.
  3. Even on success the composer stayed locked, because title generation and the history
     write were awaited before the turn returned. Both now run in the background.
- **A reasoning model that spent its whole budget thinking produced a blank turn.** The
  response had an empty content array, which renders as nothing at all. Both paths now explain
  why the turn was empty and point at the max-tokens setting.

### Added

- **Split view.** Three layout states — single pane, side by side, stacked —
  picked from a segmented control in the top bar and remembered across reloads.
  The second pane is a **Start** surface whose cards are all wired to real
  endpoints:
  - *Workspace files* browses the session workspace (`GET /files`), drills into
    folders, and inserts `@<abs path>` into the prompt.
  - *New terminal* runs a command (`POST /exec`, host shell, 30 s default
    timeout) and shows stdout/stderr with exit code and duration.
  - *Browser* opens a URL in a new tab.
  - *Session diagnostics* (`GET /diagnostics`) reports pid, uptime, bridge port,
    CLI version/path, active model, permission mode, and session/job/upload
    counts, plus whether the loaded code is stale.
  - *More tools*: settings, refresh, copy the workspace path.
  Ctrl+P / Ctrl+` / Ctrl+T open the matching card while focus is inside the
  panel.
- `POST /upload/raw` — streams an attachment body to disk (`?name=&session_key=&kind=`),
  returning `{ path, name, uid, kind, size }`. This is what the UI uses for anything that can
  be large.
- `GET /health` now returns `build: { file, mtime, loadedAt, stale }`. When `mtime` is newer
  than `loadedAt`, the process is executing code from before the last edit — the single most
  confusing failure mode this plugin has. The settings page renders that as a red banner
  telling you to fully quit and reopen DSH, and shows the load time next to the version.

### Changed

- Oversized JSON bodies answer **413** with `connection: close` instead of a bare 500, so the
  socket is never reused with unread bytes on it.
- Media the CLI cannot read (mp4/mov/mp3/zip…) is still named in the prompt but is no longer
  advertised as "read this with Read", which only made the model try and fail.

### Fixed

- **"Start update" appeared to do nothing.** Two causes, both addressed:
  1. The upgrade block gave no durable feedback. A failed start only produced a transient
     toast, and a run that changed nothing was easy to miss. Failures now stay on screen next
     to the button, and while npm runs the button shows a live elapsed counter
     (`Updating… 12s`).
  2. When the installed version already *was* the latest, the button still said "Start
     update", so a successful no-op read as a failure. It now reads **Reinstall latest** and
     carries the hint that reinstalling will not change the version number.

### Added

- `GET /health` now returns `build: { file, mtime, loadedAt, stale }`. When `mtime` is newer
  than `loadedAt`, the process is executing code from before the last edit — the single most
  confusing failure mode this plugin has. The settings page renders that as a red banner
  telling you to fully quit and reopen DSH, and shows the load time next to the version.
- `tools/verify/_verify_upgrade.mjs` drives the real upgrade route end to end (immediate
  response, npm log, before/after, `changed`).
- `tools/verify/_verify_upgrade_ui.mjs` clicks through the panel in a real browser: check →
  relabel → start → elapsed counter → verdict → rendered npm log.

## [2.5.1] — 2026-11-17

First release of the DSH-native port, plus the fixes found while verifying it end to end.
Version numbers track the Hermes `claude-code-parity` release this port started from.

### Added

- Native DSH plugin (`@local/dsh-claude-code-cli`) — host routes via `ctx.webServer.register()`,
  panel via `ctx.slots`, protocol bridge via `ctx.llm.stream()`. No Python, no FastAPI.
- **Real CLI upgrade.** `POST /upgrade/check` reads the installed version from the CLI's own
  `package.json` and compares it against `registry.npmjs.org`. `POST /upgrade` inspects the
  install layout and runs npm in the right root, streaming the log to `upgrade-state.json`.
- **Phone access over the same Wi-Fi.** `/mobile` enumerates real LAN interfaces,
  `/mobile/start` boots a LAN-bound DSH instance plus a short-address 302 redirect.
- 35 settings wired into the run path: theme palettes, thinking/tool visibility, compact
  transcript, stream polling speed, auto-title, keep-history, history limit, export format,
  paste-to-document threshold, tool policy, per-family allow flags, read-only auto-approve,
  approval timeout, sampling parameters, vision mode and image-strip fallback.
- Claude Code marketplace wrapper under `integrations/claude-code/`.

### Fixed

- **The whole panel rendered blank** because `__ModuleLoader__.load({id})` did not match
  `package.json` `name`. Backend stayed green the entire time; only a real browser exposed it.
- **Every second turn failed** — assistant messages were built without `source`, and DSH reads
  `message.source.replayState` unconditionally.
- **`reasoning_effort` was forwarded blindly**, killing any model that rejects the parameter
  (`does not support reasoning effort "medium"`). Default is now `auto` (send nothing) with a
  one-shot migration keyed on `settings_version`.
- **Tool-result-only user messages were rejected** by OpenAI-shaped providers
  (`message content cannot be empty`); a placeholder text block is now added.
- **`npm update -g` could not reach a project-local CLI**, which is why "update" appeared to
  do nothing.
- **The plugin card kept the old name** — it reads `locale/<lang>.json` `meta.title`, not
  `package.json`.
- Settings labels rendered as raw keys (`show_thinking`) because the schema stores plain
  strings while the renderer expected `{zh,en}` objects; enum values are now localised too.
- Deleting a session cleared the list but not the reading pane; CLI transcripts needed a
  `cli-meta` overlay to be editable at all.
- Export returned 404 for CLI-only sessions; it now falls back to the raw transcript.

### Verified

- `tools/verify/_verify_all.mjs` — **20/20** (settings round-trip for all 35 items, coercion of
  invalid values, reset, no-drift restore, registry lookup, install root, LAN interfaces,
  mobile start/stop, short-address 302, cookie mint 303, LAN shell 200, plugin API 200,
  export formats, history limit).
- `tools/verify/_verify_ui.mjs` — **9/9** in headless Chrome over CDP (panel mounts, 7 settings
  tabs, real `2.1.326` version string, 37 human-readable labels, LAN address rendered).
- `tools/verify/_verify_chat.mjs` — two turns through the real CLI and bridge on one session id.
- Zero browser console errors.
- CLI upgraded 2.1.325 → 2.1.326 in place (`changed=true`).

## [2.5.1-hermes]

The Hermes Desktop release this port derives its feature set and version number from.
