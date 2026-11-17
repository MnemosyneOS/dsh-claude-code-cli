# Publishing and installation

Two different audiences install this repository, and they need different things.

| Audience | What they install | Entry point |
| :- | :- | :- |
| DeepSeek Harness users | the plugin itself | `package.json` (`dsh.bundle.patch`, `dsh.client.inject`) |
| Claude Code users | a skill that teaches Claude Code to drive the panel's API | `.claude-plugin/marketplace.json` → `integrations/claude-code` |

## Installing into DeepSeek Harness

The plugin is not published to npm; it is linked from a checkout. A profile's `package.json`
carries both the dependency and the bundle entry:

```json
{
  "dependencies": {
    "@local/dsh-claude-code-cli": "link:C:/path/to/dsh-plugin-claude-code-parity"
  },
  "dsh": {
    "profile": {
      "bundles": ["@local/dsh-claude-code-cli", "...other bundles"]
    }
  }
}
```

```bash
cd ~/.dsh/profiles/<profile> && npm install
```

`node_modules/@local/dsh-claude-code-cli` becomes a symlink to the checkout, which means
**editing the source is editing production** — restart DSH to load changes.

### The one rule that breaks silently

`lib/client.js` ends with:

```js
window.__ModuleLoader__.load({ id: '@local/dsh-claude-code-cli', factory(require) { ... } })
```

That `id` must be **byte-identical** to `package.json` `name`. If it is not, DSH cannot resolve
the client entry and the panel renders blank — while every HTTP route keeps answering `200`.
There is no error in the panel; only the browser console shows
`client-modules: could not load "…"`.

### Display name lives in the locale files

The plugin list card reads `locale/<lang>.json`:

```json
{ "meta": { "title": "DSH-Claude Code CLI", "description": "…" } }
```

`package.json` `name`, `dsh.name` and `description` do **not** change the card. Locale files are
read at process start, so restart after editing them.

## Installing into Claude Code

```bash
/plugin marketplace add MnemosyneOS/dsh-claude-code-cli
/plugin install dsh-claude-code-cli@mnemosyneos
```

That installs `integrations/claude-code/skills/dsh-claude-bridge/SKILL.md`, which documents the
plugin API (`/chat`, `/poll`, `/models`, `/approvals`, `/upgrade/*`) and the loopback bridge.
It does **not** install the DSH plugin — that half is linked into a DSH profile as above.

## Versioning

`package.json` `version`, `locale` content and `CHANGELOG.md` move together. The version tracks
the Hermes `claude-code-parity` release this port started from, so `2.5.1` here and `2.5.1`
there describe the same feature surface, not the same code.

When cutting a release:

1. bump `package.json` `version`;
2. add a `CHANGELOG.md` section;
3. `git tag -a vX.Y.Z -m "..."` and push the tag;
4. create the GitHub release from the changelog section.

## Verifying a release before publishing

```bash
node tools/verify/_verify_all.mjs  "<token>"   # backend
node tools/verify/_verify_ui.mjs   "<token>"   # real browser over CDP
node tools/verify/_verify_chat.mjs "<token>"   # two real turns
```

All three expect a running instance:

```bash
dsh --profile <verify-profile> --port 39120 --host 127.0.0.1 --no-open
```

Do not publish on a green HTTP suite alone — the blank-panel class of bug is invisible to it.

## Repository hygiene

`tools/verify/` is development-only. It is excluded from `package.json` `files`, so it never
ships inside the plugin, but it does live in the repository because the verification claims in
the README should be reproducible.
