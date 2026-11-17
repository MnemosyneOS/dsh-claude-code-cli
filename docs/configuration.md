# Configuration reference

35 items in six groups, declared once in `lib/common.js` (`SETTINGS_ITEMS`) and rendered by the
settings page. Defaults below are the declared defaults, and every item is exercised by
`tools/verify/_verify_all.mjs` (write → read back → coerce → restore).

Stored at `~/.dsh/ccp-data/settings.json`. That path is **shared by every DSH profile**.

## General

| Key | Type | Default | Effect |
| :- | :- | :- | :- |
| `default_cwd` | path | `""` | Working directory for a turn when the request does not specify one. Empty means the DSH process cwd. |
| `permission_mode` | enum | `acceptEdits` | Passed through as `--permission-mode`. Values: `acceptEdits`, `auto`, `manual`, `plan`, `dontAsk`, `bypassPermissions`. |
| `permission_prompts` | enum | `host` | `host` routes tool permission requests to the panel; `none` disables the approval MCP entirely. |
| `timeout` | number 60–7200 | `900` | Wall-clock limit for one turn, in seconds. |
| `tool_policy` | enum | `auto` | `auto` uses the per-family switches below; `all` allows every tool; `none` denies every tool. |
| `language` | enum | `zh` | UI language, `zh` or `en`. |

## Appearance

| Key | Type | Default | Effect |
| :- | :- | :- | :- |
| `theme` | enum | `claude` | Palette: `claude`, `dark`, `light`. Expanded into CSS variables on `.ccp-root`. |
| `show_thinking` | boolean | `true` | Render the reasoning timeline. Off hides it entirely. |
| `show_tool_output` | boolean | `true` | Render tool call rows and their results. |
| `transcript_view` | enum | `verbose` | `compact` collapses rows that have no detail and hides their chevron. |
| `stream_speed` | number 0–100 | `0` | Polling cadence: `max(60, 350 − speed × 2.9)` ms. `0` keeps the historic 350 ms. |

## Tools & Permissions

These feed `permissions.allow` / `permissions.deny` in the generated `settings-runtime.json`,
and `--auto-readonly` on the approval MCP.

| Key | Type | Default | Effect |
| :- | :- | :- | :- |
| `allow_read` | boolean | `true` | `Read` |
| `allow_write` | boolean | `true` | `Write`, `Edit`, `NotebookEdit` |
| `allow_bash` | boolean | `true` | `Bash`, `PowerShell` |
| `allow_glob` | boolean | `true` | `Glob`, `Grep` |
| `allow_web` | boolean | `true` | `WebFetch`, `WebSearch` |
| `approval_timeout` | number 10–600 | `120` | Seconds before a pending approval is denied. Passed to the MCP as `--timeout`. |
| `auto_approve_readonly` | boolean | `false` | Read-only family (`Read`, `Glob`, `Grep`, `WebFetch`, `WebSearch`, `NotebookRead`, `TodoWrite`) is allowed without prompting. |

## Model

| Key | Type | Default | Effect |
| :- | :- | :- | :- |
| `model` | string | `""` | Selected model id. Usually set through the composer picker. |
| `provider` | string | `""` | Selected provider id. |
| `reasoning_effort` | enum | `auto` | `auto` sends nothing. Otherwise `minimal` / `low` / `medium` / `high` are forwarded — only choose one if your model accepts it. |
| `max_tokens` | number 0–262144 | `0` | `0` lets the provider decide. |
| `temperature` | number 0–2 | `0` | `0` means "provider default" and is not sent. |
| `vision_mode` | enum | `auto` | `auto` inlines images as base64; `image_url` uses data URIs; `path_only` replaces images with a text placeholder. |

## Session

| Key | Type | Default | Effect |
| :- | :- | :- | :- |
| `auto_title` | boolean | `true` | Generate a title from the first message via `/title`. |
| `keep_history` | boolean | `true` | When off, sessions live in memory only and die with the process. |
| `history_limit` | number 20–5000 | `300` | Maximum sessions returned by `/history`. |
| `paste_doc_limit` | number 1000–100000 | `10000` | Pasted text longer than this becomes a document attachment instead of inline text. |
| `export_format` | enum | `markdown` | `markdown` or `txt`, used by `/history/export` when the request omits a format. |

## Advanced

| Key | Type | Default | Effect |
| :- | :- | :- | :- |
| `system_prompt` | textarea | `""` | Appended to `--append-system-prompt` after the identity block. |
| `append_identity` | boolean | `true` | Inject a short `[Runtime]` block describing the model class and provider. |
| `strip_images_on_error` | boolean | `true` | After an image-related failure for a provider/model pair, drop images automatically. |
| `debug` | boolean | `false` | Log the full argv and cwd of every job to the DSH log. |
| `cli_path` | path | `""` | Explicit path to the `claude` binary. Empty means auto-detect in the usual locations. |
| `extra_flags` | string | `""` | Extra arguments appended verbatim to the CLI command line. |

## Non-obvious behaviour

- **Coercion, not rejection.** An invalid number is clamped into range (`timeout = "abc"` →
  `900`), an unknown enum falls back to its default (`permission_mode = "nonsense"` →
  `acceptEdits`). The stored value is always valid.
- **`settings_version`.** Bumped to `2` when `reasoning_effort` became meaningful. Loading a
  v1 file with the old inert `medium` rewrites it to `auto` once; user-chosen values on a v2
  file are left alone.
- **`cli_path` takes effect immediately.** Saving settings updates the in-memory resolver, so
  you do not need to reload the panel for a new CLI path to be used.
- **Reset** (`POST /settings/reset`) restores the declared defaults for all 35 items.
