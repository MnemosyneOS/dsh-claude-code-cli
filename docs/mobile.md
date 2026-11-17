# Phone access over the same Wi-Fi

The plugin can expose the **complete DSH UI** — this panel included — to a phone on the same
network. Session data is shared with the desktop, so a conversation started on one device can
be continued on the other.

## Why it is not just "bind to 0.0.0.0"

DSH refuses the wildcard address:

```
error: --host must be a concrete IPv4 or IPv6 literal
```

So the plugin enumerates real interfaces and binds to one of them, then whitelists that
authority with `--trusted-host`. This is deliberate on DSH's side: a wildcard bind would
silently expose the panel on every interface, including VPN and container bridges.

## What "Start" actually does

1. `os.networkInterfaces()` is filtered to non-internal IPv4 addresses — these are the entries
   the settings page lists (`WLAN 192.168.1.103`, for example).
2. The DSH CLI is spawned as a **second instance**:

   ```
   dsh --profile web --host <LAN-IP> --port <p> --no-open --trusted-host <LAN-IP>:<p>
   ```

   `web` is used because the `desktop` profile is owned by the Electron process and refuses to
   boot from a CLI (`profile "desktop" is managed exclusively by the Electron application`).
   The bundle set is identical, so the panel is present.
3. The instance prints `dsh web: http://<LAN-IP>:<p>/?token=<token>`; the plugin parses that
   line out of stdout.
4. A tiny redirect server is started on `p + 1`. It answers `302` with the tokenised URL and
   serves nothing else.

State is written to `~/.dsh/ccp-data/mobile-state.json`.

## The two addresses

| Row in the panel | Example | Use |
| :- | :- | :- |
| Short address | `http://192.168.1.103:9241` | type this on the phone; it redirects |
| Full tokenised URL | `http://192.168.1.103:9240/?token=…` | share or bookmark; skips the redirect |

The first request to the tokenised URL answers `303` and sets the `dsh-auth-<hash>` cookie
(`HttpOnly`, `SameSite=Strict`, 30 days), after which the phone is a normal authenticated
client.

## Stopping

**Stop** kills the child instance and closes the redirect listener. Verify with:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://192.168.1.103:9241   # expect a connection error
```

Both listeners also go away if the DSH process exits, because the plugin kills the child in
its dispose hook.

## Things that bite

| Symptom | Cause |
| :- | :- |
| Phone cannot connect at all | Windows Firewall blocks the port; allow Node/DSH on the private network |
| Address works on the desktop, not the phone | the two devices are on different VLANs or one is on a guest network |
| `error: --host must be a concrete ...` | an interface address changed after the list was rendered; reopen the tab and pick again |
| Redirect answers but the page is blank | the tokenised instance died; check `/mobile` state and restart |
| LAN instance shows no plugins | it booted with a profile whose bundle list lacks this plugin — use `web` |

## Security notes

- Nothing is exposed until you press **Start**, and it stays exposed until you press **Stop**
  or DSH exits.
- The redirect server never serves content; it only issues a `302`.
- The launch token is regenerated on every process start, so a URL you wrote down stops
  working after a restart.
- Anyone on the same network who obtains the tokenised URL has the same access you do. Treat
  the short address as a convenience for your own device, not as a shareable link.
