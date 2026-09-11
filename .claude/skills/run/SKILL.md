---
name: run
description: Launch Flightdeck and confirm a change actually works in the running app. Use whenever asked to run, start, restart, or screenshot Flightdeck, or to verify a change end-to-end rather than only in tests. Covers flightdeck.cmd, the rebuild rule, the two ports, health checks and the logs.
---

# Running Flightdeck

Six real bugs shipped past a green unit suite and were only found by running the thing
(RESEARCH.md §G). A green `npm run check` is not evidence that a change works.

## Start it

Run it from **PowerShell**, not Git Bash:

```powershell
& .\flightdeck.cmd
```

Git Bash mangles `cmd //c` and the batch file is not found — verified, it fails with "is not
recognized as an internal or external command". Use the PowerShell tool for the two `.cmd`
scripts and Bash for everything else.

That is the only supported way to start it. The script builds the deck, starts core on
`127.0.0.1:4950` and the deck on `127.0.0.1:4949`, waits for each to bind **loopback
specifically**, then opens an Edge `--app` window on `/deck`. It exits once everything is up, so
it does not need a background shell.

**Never use `npm run dev`.** Under the SEC-UI-1 policy `next dev` serves a page that renders and
then does nothing at all — no button works, no fetch is issued, and the deck sits on "core down"
forever, because Turbopack's dev runtime needs `eval` and the CSP does not grant it (RESEARCH.md
G.3, open as P2-T6b). It fails silently and looks like a broken feature. `flightdeck.cmd` runs the
production build for exactly this reason.

**Any change under `app/` needs a rebuild.** The deck is served from `.next`, not from source, so
editing a component and refreshing shows the old bundle. Re-run `flightdeck.cmd` — it rebuilds
every time on purpose rather than serving a stale bundle. Changes under `core/` need core
restarted, which means stopping first.

## Stop it

```powershell
& .\flightdeck-stop.cmd
```

Kills whatever holds 4950 and 4949, on any bind address. Claude sessions that panes were attached
to **keep running** — killing an attach never stops a session (RESEARCH.md F.2.6). Core deletes
its token file on the way out.

Restarting is stop then start; `flightdeck.cmd` on its own will report "already running" and skip
the rebuild, which is the usual reason a change appears not to have landed.

## Verify it

Core authenticates every route, `/health` included. The token is per boot, in
`%LOCALAPPDATA%\flightdeck\token`:

```bash
TOKEN=$(cat "$LOCALAPPDATA/flightdeck/token")
curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:4950/health
curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:4950/sessions | head -c 400
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:4949/deck
```

`/health` answers `{status, version, pid, uptimeSeconds}` and deliberately nothing about sessions.

**A 401 with a token read fresh from that file means the file is stale, not that you read it
wrong.** `buildCore()` writes the token before `listen()` is attempted (`core/main.ts`), so a
second core started while one is already running clobbers the live token file and *then* fails to
bind — leaving the running core holding a token nothing can read. The deck reads the same file, so
it 401s on every request and shows "core down" forever. Observed, not theorised: the core log
carries `request_denied … bearer token absent or wrong` when this happens.

The fix is always stop-then-start, never a second start. Check for it with:

```bash
stat -c %y "$LOCALAPPDATA/flightdeck/token"          # token written
powershell -NoProfile -Command "(Get-Process -Id <corePid>).StartTime"
```

A token file **newer** than the running core process is the signature.

Confirm the bind addresses, because `next start` defaults to `0.0.0.0` and put the deck on the LAN
once already (RESEARCH.md G.6, SEC-NET-1):

```bash
netstat -ano -p TCP | grep -E 'LISTENING' | grep -E ':(4949|4950) '
```

Both must show `127.0.0.1`. Anything on `0.0.0.0` is a security regression, not a cosmetic one.

## When it does not start

| Symptom | Where to look |
| --- | --- |
| `core FAILED to bind` | `.flightdeck-core.log` |
| `deck FAILED to bind` | `.flightdeck-deck.log`; a `0.0.0.0` bind means the `-H` flag was lost |
| `deck BUILD FAILED` | run `npm run build` directly for the real error |
| Page renders, nothing works | you started it with `npm run dev` — see above |
| Change not visible | core or deck was already running, so no rebuild happened; stop, then start |

Ports are never chosen dynamically. A second core would issue a second token and answer with a
stale session list, which is worse than not starting (SECURITY.md §7 rule 1) — so a busy port is
a thing to resolve, never to work around.

## What is not a bug

Only background sessions are attachable. `claude attach` takes `--bg` sessions only, so an
interactive session is permanently read-only in a pane (SPEC.md §5.2). A pane that will not accept
keystrokes for an interactive session is the design, not a defect to chase.
