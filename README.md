# Flightdeck

A control tower for every Claude Code session on this machine, across both subscriptions.
Status: **it runs, and it is live.** A terminal slice is in (DECISIONS.md D30) — the deck lists
every session on both subscriptions, starts background sessions, and attaches a real Claude Code
session to a pane in the browser that you can type into.

```
flightdeck.cmd          # core + the deck + an Edge app window
flightdeck-stop.cmd     # stop both, and drop the token (the sessions they were attached to keep running)
```

**The deck updates itself.** Core reconciles both subscriptions every 10 s (P1-T4) and publishes
what changed on an SSE stream (P1-T9); the page subscribes, gets the whole picture as its first
frame, and takes deltas after that. Nothing polls, and `refresh` is now a deliberate re-sweep
rather than the only way to find out. Core restarting is handled without a reload — the deck says
`core down`, reconnects on its own, and comes back with a fresh replay.

**Both receivers are built; neither is connected yet.** `POST /hooks` (P1-T5) acks in about 2 ms
and asks the reconciler to sweep, so a session that goes blocked shows up in about a second rather
than in up to ten. `POST /statusline` (P1-T6) keeps the newest context percentage, cost and 5h/7d
quota for each session, and publishes only when one of them actually moves — the status line posts
on every repaint and almost none of those carry news.

Nothing points at either of them yet. Installing the hook handlers into `settings.json` and merging
the statusLine block into `~/.claude/hooks/statusline.py` is Connect (P1-T11) — hooks pointed at a
receiver that is down put an error banner in every interactive session, so that step refuses to run
unless core is up.

**What it does not do yet.** No quota gauges on the deck, no projects map, no search — the vitals
are collected but nothing draws them until P2-T3. One banner is still as old as your connection: a
subscription core could not read publishes no event, so `refresh` is what updates it.

**Only background sessions can be attached.** `claude attach` takes background sessions only, so
an interactive session — one you started in a terminal yourself — shows on the deck read-only,
with the reason on the row. Start one from the deck to get a pane you can type into.

> `npm run dev` currently renders the deck and never hydrates (RESEARCH.md G.3, open as P2-T6b).
> Use `flightdeck.cmd`, which builds and runs the production bundle. Editing the deck means
> rebuilding until that is fixed.

| Read this | For |
|---|---|
| [SPEC.md](SPEC.md) | what it is and why (rev 3) |
| [ROADMAP.yaml](ROADMAP.yaml) | phases, tasks, gates — `npm run roadmap` |
| [BUILD-PLAN.md](BUILD-PLAN.md) | repo shape, data model, API contract |
| [CODING-STANDARDS.md](CODING-STANDARDS.md) | OOP, readability, layering, tests — enforced by `npm run check` |
| [SECURITY.md](SECURITY.md) | threat model and controls (`SEC-*` ids) |
| [DECISIONS.md](DECISIONS.md) · [RESEARCH.md](RESEARCH.md) | why, with evidence |

## Working on it

```
fnm use            # Node 26 from .node-version
npm ci
npm run check      # lint · typecheck · format · roadmap · tests  (same as CI)
npm run roadmap    # where are we
flightdeck.cmd     # run the thing
```

Core alone, without the deck or a browser:

```
node scripts/flightdeck-core.ts     # binds 127.0.0.1:4950, prints the token path
```

`tests/e2e/deck-pane.spec.mjs` drives a real browser against a real core and is **not** part of
`npm run check` — it needs core running and a live background session. P2-T7 replaces it with a
Playwright smoke against a fixture stream that CI can run.

Branch from `main` as `feat/P1-T4-short-name`, commit with the task id
(`feat(core): reconciler sweep [P1-T4]`), open a PR — the template carries the checklist.
