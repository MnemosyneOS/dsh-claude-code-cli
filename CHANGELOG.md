# Changelog

All notable changes to **DSH-Claude Code CLI** are recorded here.
This project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed

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
