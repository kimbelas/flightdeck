# Flightdeck — a control tower for every Claude Code session

**Status:** spec / not built · **Created:** 2026-09-10 · **Revised:** 2026-09-10 (**rev 3**)
**Location:** `C:\Users\dev\Documents\development\flightdeck`
**Companions:** `RESEARCH.md` (evidence, with dates), `DECISIONS.md` (D1–D19), `BUILD-PLAN.md`
(repo shape, data model, API, phases and gates), `ROADMAP.yaml` (task tracking — `npm run roadmap`),
`CODING-STANDARDS.md` (OOP, layering, tests — enforced by `npm run check`), `SECURITY.md`
(threat model and `SEC-*` controls).
**Repo:** `git@github.com:kimbelas/flightdeck.git` · CI in `.github/workflows/`.

> One local page that shows every Claude Code session running on this machine — across
> **both subscriptions** — what each one is doing, which are waiting on me, how much quota
> each subscription has left, and lets me run all my projects from it without opening a
> single terminal window.

**What rev 3 changed, and why.** Every claim in rev 2 §2 was re-verified on the machine and
against the official docs (RESEARCH.md). Five findings changed the design:

1. **Claude Code can push events to Flightdeck.** Hooks have an `http` handler type and a
   `statusLine` payload that already carries cost, context size, model and rate limits per
   session. Flightdeck no longer needs to *discover* state by tailing transcripts; sessions
   *tell* it. Transcripts become an enrichment source (§4.2, D3).
2. **That needs a receiver that is always on.** So the "PTY sidecar" grows into
   **`flightdeck-core`**, a headless service started at logon; the Next.js UI is a viewer that
   can be closed at will (§4.1, D2). It also solves notifications-without-a-browser.
3. **`node-pty` runs on Node 26 with zero compilation** (spike passed). The Node-20 sidecar
   requirement is gone (D6).
4. **Background sessions are not eternal.** The daemon retires idle ones (observed at 32–61 min);
   only one terminal may attach at a time; `--bg` needs a prompt; `logs` needs the daemon alive.
   The lifecycle in §4.3 now models all of that (D7, D8).
5. **Desktop vs web is answered** (the owner's question, §3.3 and D1): the app is a local web app;
   the *window* becomes a Tauri shell when the terminal grid ships, because Chromium never hands
   a page Ctrl+W. Electron is rejected.

Also new: a security model for a localhost service that spawns processes (§7), cost read from
Claude Code's own `cost-state` instead of token maths (D5), and a routing drift between the bash
and PowerShell launchers that must be fixed before the launcher phase (D4).

---

## 1. Definition of done

The eight things this must do, in the owner's words, with the section that covers each:

| # | Want | Section |
|---|---|---|
| F1 | Import folders; see what Claude does there, the agentic workflow, and whatnot | §5.1 |
| F2 | A button to update / get latest results from Claude Code, choosing which subscription | §5.2 |
| F3 | A full dashboard of terminals | §5.3 |
| F4 | UI very techy — terminal-like, but better UX for actual development | §5.4 |
| F5 | Check progress of each terminal, its state and whatnot | §5.5 |
| F6 | A dev dashboard across multiple imported projects | §5.6 |
| F7 | One browser; never open multiple terminals on the PC/laptop again | §5.7 |
| F8 | Does Claude Code actually work well and fast in a browser? | §3 |

Plus the owner's follow-up: **web app or desktop app?** → §3.3.

---

## 2. What already exists on this machine (verified 2026-09-10, Claude Code 2.1.267)

Condensed; every row has evidence in RESEARCH.md §A–§D.

### 2.1 Two subscriptions = two config dirs

| Launcher | `CLAUDE_CONFIG_DIR` | Routing |
|---|---|---|
| `claude-365` | `~\.claude-365` | subscription A; `settings.json` model `claude-fable-5-1[1m]`, effort xhigh |
| `claude-isg` | `~\.claude-isg` | subscription B; `settings.json` model `opus[1m]`, effort xhigh, permissions `defaultMode: auto` |
| `claude-isg-ticket` | `~\.claude-isg` | `opusplan[1m]` with env pins → plan on Fable 5.1, execute on Opus 5 |
| `claude-isg-orch` | `~\.claude-isg` | `claude-sonnet-5 --agent orchestrator -n orchestrator` |
| `claude-isg-agents` | `~\.claude-isg` | the `agents` view (FleetView) with opus/high defaults |

These are PowerShell profile functions. **`~\.bashrc` carries a second, diverging copy** (its
`claude-365` pins `--model claude-fable-5`, and it adds `claude-isg-bg` and `-1m` variants).
Flightdeck follows the PowerShell set, as `open-tab.mjs` already does; the bash drift is fixed
before Phase 4 (D4). `~\.claude` is legacy — shared `hooks/` and `CLAUDE.md`, an empty
`sessions/`.

### 2.2 The live session surface (documented, supported)

- **`claude agents --json`** — active sessions of one config dir as JSON, no TTY, ~760 ms per
  call, does its own liveness filtering. Interactive rows: `pid, cwd, kind, startedAt, sessionId,
  name, status: busy|idle`. Background rows: `id` (short), `state: working|blocked|done|failed|
  stopped`, `status: busy|waiting|idle`, `waitingFor`. `--all` adds finished ones, `--cwd` filters.
- **`claude --bg '<prompt>'`** — detached session under a per-config-dir **daemon**; prints a
  short id. `attach <id>` (exclusive: one terminal at a time), `logs <id>` (needs the daemon),
  `stop`, `rm`, `respawn [--all]`, `daemon status|stop`.
- **Hooks** (`settings.json`): events `SessionStart/End, UserPromptSubmit, Stop, StopFailure,
  PreToolUse, PostToolUse, Notification, PreCompact, PostCompact, SubagentStart/Stop,
  PreModelSwitch/PostModelSwitch`; handler types `command` (with `async`), **`http`**, `mcp_tool`,
  `prompt`, `agent`. Notification types: `idle_prompt, permission_prompt, agent_needs_input,
  agent_completed, auth_success, elicitation_*`.
- **statusLine** (`~\.claude\hooks\statusline.py`, shared by both configs): receives per render
  `session_id, transcript_path, cwd, model, version, cost.*, context_window.{used_percentage,
  context_window_size,…}, rate_limits.{five_hour, seven_day, spend_limit}, prompt_cache, effort,
  agent, pr, worktree, workspace.repo`. Debounced 300 ms; optional `refreshInterval`.
- **`claude agents`** (no `--json`) is the built-in fleet TUI — internal name **FleetView** —
  with peek & reply, dispatch defaults, stop/respawn. One subscription, in a terminal, no
  project context, no quota, no history. Flightdeck is the cross-subscription, browser, project
  version; it never re-implements peek & reply on the undocumented pipe.
- **Claude desktop app is installed** (`Claude 1.30096.5.0`). It runs parallel sessions for one
  account, separate from CLI sessions. It cannot show two subscriptions (§3.3).

### 2.3 Files worth reading (internal, best-effort)

| Path | Use |
|---|---|
| `$CFG/sessions/<pid>.json` | enrichment: `version, nameSource: user\|derived, agent, procStart, statusUpdatedAt`. Sibling `<pid>.<sha>.key` — **never read.** |
| `$CFG/jobs/<short>/state.json` | background job: `state, respawnFlags, providerEnv.CLAUDE_CONFIG_DIR, intent, name, nameSource: auto` |
| `$CFG/daemon/`, `daemon.log` | supervisor lifecycle: spawns, **idle retirement**, exit |
| `$CFG/projects/<slug>/<id>.jsonl` | transcripts (up to 51 MB; 647 MB + 509 MB total). Record types in RESEARCH §C. Standouts: **`cost-state`** (per-model cost, computed by Claude Code), `away_summary` (plain-English recap), `ai-title`, `last-prompt`, `compact_boundary`, `turn_duration`, `scheduled_task_fire`, `file-history-*`. Deleted after `cleanupPeriodDays` (30). |
| `$CFG/history.jsonl` | last prompt per session with project path — cheapest subtitle |
| `$CFG/stats-cache.json` | daily counts, computed lazily (10 days stale) — not live |

### 2.4 Prior art in this repo — reuse, don't rewrite

- **claude-coach** (`127.0.0.1:4747`, `coach.cmd`) owns config *quality* via coach-core and
  per-repo `gates.json`. **groundwork** (`4848`, `groundwork.cmd`, vitest + playwright).
  Both: Next.js 16.2 + React 19.2 + Tailwind 4. Flightdeck is the third: **4949** (UI) + **4950**
  (core).
- **`app-next/.claude/scripts/open-tab.mjs`** — profile-function launching, the `wt.exe`
  AppX-alias fix (`(Get-AppxPackage Microsoft.WindowsTerminal).InstallLocation`, cached), and
  `lib/tree.mjs` for worktree/main resolution and the **never-touch-4201** rule.
- **`statusline.py`** — cached git status per repo, `until()` for reset countdowns, chip
  priorities. Lift, don't rewrite.
- **`app-next/.claude`** is the workflow-map stress test: 3 agents, 3 commands, 10 skills, 17
  hook scripts wired to `SessionStart/PreCompact/PreToolUse/PostToolUse/Stop` (with `if:` and
  `async:`), 6 rules, 8 specs, 2 worktrees, `soul.md`, `.mcp.json` (chrome-devtools).

### 2.5 Toolchain facts that constrain the build

Node 26.3.0 default (fnm; 20.19.5 and 16 available). **No MSVC toolset** despite a BuildTools
folder → native modules must ship prebuilds. `node-pty` 1.1.0 does (N-API; installed and passed a
ConPTY round trip on Node 26 and 20). `node:sqlite` on Node 26 has **FTS5** (verified in-process).
Edge, Chrome, Windows Terminal 1.24 present. Ports 4949/4950 free; 4200/4201 belong to app-core
and sibling-app.

---

## 3. F8 — does Claude Code actually work well in a browser? And: web or desktop?

### 3.1 Performance: identical, because it is the same process

Flightdeck runs *the real `claude.exe`* in a real Windows pseudo-terminal (ConPTY via
`node-pty`) and streams bytes to xterm.js. Model, speed, tools, hooks, plugins, MCP, statusline —
byte-for-byte the same as your terminal. Only the terminal *emulator* changes, and xterm.js with
the WebGL renderer is what VS Code ships. Keystroke → loopback WebSocket → ConPTY is
sub-millisecond. Alt-screen (`tui: fullscreen`), 24-bit colour and resize were exercised in the
spike.

### 3.2 What genuinely degrades in a browser

1. **Browser-reserved keys — the one real loss.** Chromium never delivers **Ctrl+W, Ctrl+T,
   Ctrl+N, Ctrl+Shift+N, Ctrl+Tab** to page JavaScript, so no `preventDefault` can save them.
   Ctrl+W is delete-word in Claude Code's input; Ctrl+T is its todo toggle. The Keyboard Lock
   API can reclaim them **only in fullscreen** (hard platform gate, confirmed 2026). An installed
   PWA or Edge `--app` window still closes on Ctrl+W. VS Code for the Web and code-server both
   gave up and remap. Mitigations that work: `keybindings.json` remaps in both config dirs (a
   one-click helper, §5.3), xterm's `attachCustomKeyEventHandler` for everything else. The
   *fix* is a native shell — §3.3.
2. **Image paste** — intercept `paste`, write the image to a temp file, inject the path. ~50
   lines, needs a clipboard permission grant.
3. **Drag-and-drop a file to insert its path** — custom handling.
4. **`/ide`** does not apply to a browser pane.
5. **WebGL context cap** — Chromium allows ~16 WebGL contexts per page and evicts the oldest.
   The renderer budget in §5.3 keeps live WebGL under 10 panes and falls back to the DOM renderer
   on `onContextLoss`.

**What gets strictly better:** sessions are `--bg`, so closing the window, restarting core, or a
Next dev reload never kills work. Today a closed terminal loses the session.

### 3.3 Web app or desktop app? (owner, 2026-09-10 — double-checked)

**Both, in this order. The *application* is a local web app; the *window* becomes a Tauri
desktop shell in Phase 5b, the moment the terminal grid ships. Electron is rejected.** Full
reasoning and comparison table: DECISIONS D1. The short version:

- Everything Flightdeck *does* runs in local servers (`core` on 4950, Next UI on 4949). A browser
  tab, an Edge `--app` window, a Tauri window and an Electron window all load the same app.
  Changing the shell changes ~zero application code, so this is a low-regret sequence.
- Phases 1–4 involve no typing into terminals; the keyboard problem does not exist yet; the
  browser is the fastest path and matches coach/groundwork.
- Phase 5 adds terminal panes and the Ctrl+W problem with them. Tauri 2 (stable 2.10.1,
  2026-03) renders in WebView2 with no tabs, so Ctrl+W has no browser action to fight; it adds a
  tray badge, native toasts and a global "show the deck" hotkey; installer ~5–10 MB using the
  WebView2 already on Windows 11. Cost: a one-time Rust toolchain install. Caveat to verify in
  5b: WebView2 has no blanket "disable accelerators" switch, so the page still `preventDefault`s
  (RESEARCH §E.3).
- Electron would give the same keyboard win at ~120–150 MB and an ABI it would have to rebuild
  `node-pty` against if anything native ran in-process. Nothing gained.
- The installed Claude desktop app is one account at a time and does not see CLI sessions —
  prior art, not a substitute.

---

## 4. Architecture

### 4.1 Shape

```
Claude Code sessions (both $CFG)          flightdeck-core · 127.0.0.1:4950            Flightdeck UI · 127.0.0.1:4949
                                          Node 26 · always on (logon task)             Next.js 16 · React 19 · Tailwind 4
 http hooks ──── POST /hooks ───────────▶ feeds/hooks ─────┐                            on demand · hot-reloadable
 statusline.py ─ POST /statusline ──────▶ feeds/statusline ┤
 agents --json ◀─ every 10 s ─────────── reconciler ───────┼─▶ session model ─▶ SQLite  ─▶ GET /stream (SSE) ──▶ browser (via Next rewrite)
 transcripts  ◀─ tail from byte offset ── transcript-tail ─┘   (derived flags)  (events,     WS /pty ◀────────────── browser (direct, Origin+token)
 claude attach <id> in ConPTY ◀────────── pty host                               vitals,
 powershell -c "<profile fn> --bg …" ◀── launcher                                 index)      msedge --app  →  Tauri shell (Phase 5b)
 wt.exe … claude attach <id> ◀────────── popout
 Windows toasts ◀──────────────────────── notify
```

Two processes on purpose (D2): hooks fire whenever any session does anything, so the receiver
must outlive the browser; and Next's dev server re-evaluates modules on edit, so watchers, PTYs
and the SQLite handle must not live inside it. Route handlers also cannot upgrade WebSockets and
a custom Next server forfeits Turbopack — a separate core process avoids both (RESEARCH §E.2).

### 4.2 Event feeds, ranked (D3)

| Rank | Feed | Latency | What it gives | Documented |
|---|---|---|---|---|
| 1 | **`http` hooks** installed in both `$CFG/settings.json` | ms | exact transitions: session start/end, prompt submitted, `Stop`, notifications (`idle_prompt`, `permission_prompt`, `agent_needs_input`, `agent_completed`), `PostToolUse` (= "doing now"), compaction, subagents | yes |
| 2 | **statusLine heartbeat** — `statusline.py` POSTs its stdin JSON (≤150 ms timeout, errors swallowed, render unchanged) | per render (300 ms debounce) + optional `refreshInterval` | cost, context % and window size, model, effort, **5h/7d/spend quota**, PR, worktree, cache | yes |
| 3 | **`agents --json` × 2 dirs every 10 s** | 10 s | authoritative liveness; `state`/`waitingFor`/short `id` for background sessions | yes |
| 4 | **transcript tail** (stored byte offset, partial-line buffer, truncation check) | ~1 s | `away_summary`, `cost-state`, `ai-title`, `last-prompt`, `compact_boundary`, `turn_duration`, files touched | **no** — best-effort |
| 5 | `fs.watch` on `sessions/`, `jobs/` + 2 s stat poll | nudge | triggers an early reconcile | n/a |

Feeds 1–3 alone are enough for liveness, attention and vitals. A schema change in feed 4 must
degrade one card's extras, never the deck. Fixture tests pin every observed shape.

### 4.3 Session lifecycle — the key idea, now with the real states

1. **Launch** — the deck runs `powershell -NoLogo -Command "<profile fn> --bg -n <name> '<prompt>'"`
   for the chosen subscription. `--bg` **requires a prompt** (presets carry one) and returns a
   short id. The `SessionStart` hook makes the row appear within a second.
2. **Observe** — feeds 1–5. State vocabulary is Claude Code's own (`working|blocked|done|failed|
   stopped`, `busy|waiting|idle`) plus derived flags: **needs-you, wedged, context-pressure,
   retired, errored, unnamed, attached** (D7).
3. **Interact** — focusing a pane makes core spawn `claude attach <id>` in a ConPTY and stream it.
   **Attach is exclusive** (one terminal at a time); the deck tracks who holds it and detaches
   before a pop-out. Closing a pane detaches only.
4. **Rest** — the daemon **retires idle background sessions** (observed: 32 min under memory
   pressure, 61 min when empty) → `state: done`. The conversation is kept. The deck shows
   *retired*, not *dead*, with one-click **resume** (`--bg --resume <sessionId>`). `logs` stops
   working once the daemon exits; the preview falls back to the transcript tail.
5. **Control** — `stop`, `rm`, `respawn`, rename, resume, fork-into-worktree as buttons, each run
   under the right `$CFG`.

**Sessions started outside Flightdeck** (a plain `claude-isg` in a terminal) are visible with full
vitals but **read-only** — interactive sessions cannot be attached. When one exits, the deck
offers to adopt it (`--bg --resume`). This is the migration path to F7, not a limitation to hide.

### 4.4 Browser now, Tauri at 5b — see §3.3 and D1.

### 4.5 Launch routing stays in the PowerShell profile (D4)

Every spawn goes through `claude-365`, `claude-isg`, `claude-isg-ticket`, `claude-isg-orch` —
never a hand-built `CLAUDE_CONFIG_DIR` + flag string. Model routing changes in one file. The bash
aliases must be made identical or delegated before the launcher ships.

---

## 5. Feature spec

### 5.1 F1 — Import folders, and see how Claude works there

**Import** registers a folder as a tracked project (a path reference; nothing is copied). Two
views result.

**(a) The Workflow Map** — "what does Claude do in this repo?", from the repo's own config:

| Source | Rendered as |
|---|---|
| `CLAUDE.md`, `AGENTS.md`, `.claude/soul.md`, user `CLAUDE.md` of both configs | the instruction stack in resolution order, with byte sizes |
| `.claude/agents/*.md` | subagent roster — name, description, model, tools |
| `.claude/commands/*.md`, `.claude/skills/*/SKILL.md` | slash commands and skills with trigger text |
| `.claude/settings.json → hooks` | **a trigger timeline**: event → matcher → `if:` → script, `async`/`timeout` badges (app-next has 17 scripts across 5 events) |
| `.mcp.json`, `enabledPlugins`, `extraKnownMarketplaces` | MCP servers, plugins (`claude-kit`) |
| `permissions.allow/deny/defaultMode` | counts, full list on expand |
| `.claude/rules/ specs/ state/ maps/ reference/ prompts/` | conventions and in-flight work, file counts |
| `.claude/worktrees/*` (+ `git worktree list`) | worktrees as launch targets, via the `lib/tree.mjs` logic |
| `package.json`, `angular.json`, `next.config.*`, `*.csproj`, `Dockerfile` | detected stack |
| git | branch, dirty, ahead/behind (lifted from `statusline.py`) |
| `.claude/gates.json` (coach-core) | show its verdict, **deep-link to coach :4747** — never re-score (D12) |

**(b) Observed behaviour** — what Claude *actually* did here, from both subscriptions'
transcripts for that path slug: sessions per week, which subscription it usually runs under,
most-used tools and subagents, skills triggered, files touched most, median context reached,
**cost per week from `cost-state`**, compaction count, scheduled tasks (`scheduled_task_fire`).
The contrast — configured vs observed — is the part nothing else shows.

**Enhancements:** config-change detection (snapshot the map; diff when hooks/agents/permissions
change); a cross-project table (which repos lack a `CLAUDE.md`, have no hooks, allow the most).

### 5.2 F2 — The action button: Connect, Refresh, Ask, Dispatch

"Update and get latest results, choosing which subscription" is four actions:

- **Connect subscription** (once per config dir, D13) — shows the exact JSON it will merge into
  `$CFG/settings.json` (the `http` hooks block + the statusLine POST), backs the file up, merges.
  Running sessions pick it up on their next start; the UI says so. Nothing is edited by hand.
- **Refresh now** — reconcile both subscriptions, re-read quota, re-scan projects. No model call.
- **Ask** — a headless run whose answer lands in the deck: `<profile fn> -p "<prompt>"
  --output-format stream-json --include-partial-messages [--json-schema] --max-budget-usd <cap>`,
  streamed into a result panel. Controls: subscription (quota-aware), model, effort, cwd (any
  project), permission mode, budget cap. For *"summarise what changed in this repo today"*.
- **Dispatch** — `--bg` for real work; appears as a row at once; attachable when you want to steer.

**The subscription picker is quota-aware**: both 5h/7d gauges from the statusLine heartbeat, the
one with more headroom pre-selected, override allowed. This is the daily question nothing answers
today. **Also here:** the Claude Code version chip (2.1.267 shared by both subs), `claude update`,
`respawn --all`, and `claude doctor` output.

### 5.3 F3 — The terminal grid

- **Layouts** 1 / 2 / 4 / 6 / 9-up plus focus mode (one large + thumbnail strip); saved per
  project; keyboard to rearrange.
- **Panes are views** (§4.3). Close = detach. Attach is exclusive; a pane shows "held by Windows
  Terminal" when a pop-out owns the session.
- **Renderer budget** — Chromium's ~16 WebGL contexts per page is the hard limit:
  focused/visible panes get a live PTY + WebGL renderer (cap 8–10); other panes get **no PTY** —
  a text preview from `claude logs <id>` when the daemon is up, else the transcript tail,
  refreshed every few seconds; `onContextLoss` → dispose WebGL, fall back to the DOM renderer.
- **Per-pane controls:** interrupt (Esc / Ctrl+C when no selection), stop, respawn, resume,
  rename, mute, **pop out to Windows Terminal** (`wt.exe -w 0 nt --title … -d … powershell
  -NoExit -Command "<profile fn> attach <id>"`, AppX path resolved as `open-tab.mjs` does).
- **Keyboard helper:** one click writes the Ctrl+W / Ctrl+T remaps into both config dirs'
  `keybindings.json` (with a diff and backup), and the shortcut sheet lists which keys the
  browser still owns until the Tauri shell.
- **Scrollback** capped (5 000 lines); full history is the transcript, searchable (§5.8).

### 5.4 F4 — The UI: techy, but a real dev tool

Density and keyboard-first feel of **k9s / lazygit**, GUI ergonomics.

- **Type:** JetBrains Mono / Cascadia Code everywhere, ~13 px, tight leading.
- **Palette:** dark, derived from the ANSI 16 so terminal output and chrome agree; one accent
  (Claude orange `#d97757`); semantic colours only for busy / needs-you / retired / errored.
- **Density:** **one dense row per session, expandable inline** (D15). Twenty sessions fit on
  1080p. No card grid, no marketing whitespace, no modal dialogs for routine actions.
- **Keyboard first:** `Ctrl+K` palette (launch, switch project, jump to session, run Ask, change
  layout, connect); `j`/`k`/arrows + `Enter`/`Esc`; `1`–`9` jump to pane; `/` search; `?`
  shortcut sheet with the browser-owned keys called out.
- **Data, not decoration:** sparklines for token burn, inline diffs for touched files, one-line
  collapsed tool calls (name + first 60 chars), ANSI-faithful log rendering, quota gauges with
  `resets_at` countdowns.
- **Glanceable status:** a colour-coded left border per row so the wall reads from across the room.

### 5.5 F5 — Progress and state per terminal

Every signal below now has a documented source; transcript-derived rows are marked ◇.

| Signal | Source |
|---|---|
| **Doing right now** — "PowerShell: `git log --oneline …`" | `PostToolUse` hook: `tool_name` + `tool_input` (◇ fallback: last `tool_use`) |
| Waiting for you | `Notification: idle_prompt` / `permission_prompt` / `agent_needs_input`; background `state: blocked`, `waitingFor`; `Stop` followed by idle |
| Turn elapsed | `UserPromptSubmit` → now (◇ `turn_duration` for history) |
| **Context used %** and window size | statusLine `context_window.used_percentage`, `context_window_size` (200k or 1M — never inferred from the model name) |
| Tokens (input / output / thinking / cache) | statusLine `context_window.current_usage` ◇ `cost-state.modelUsage` |
| **Cost** | statusLine `cost.total_cost_usd` ◇ `cost-state.totalCostUSD` per model. **Never recomputed** (D5) |
| Lines added / removed | statusLine `cost.total_lines_*` |
| Current task / title / recap | ◇ `last-prompt`, `ai-title`/`custom-title`, **`away_summary`** |
| Permission mode, effort, model, agent | hook `permission_mode`, `effort.level`; statusLine `model.id`, `agent.name` |
| PR / MR for the branch | statusLine `pr.{number,url,review_state}` |
| Compactions | `PreCompact`/`PostCompact` hooks ◇ `compact_boundary` (pre/post tokens) |
| Files touched | ◇ `file-history-snapshot/delta` |
| Subagents running | `SubagentStart`/`SubagentStop` |
| Scheduled tasks (loops, crons) | ◇ `scheduled_task_fire` |

**Derived alerts:** **needs-you** (sorted first); **wedged** (working, no events for N min);
**context-pressure** (≥ 80 %: compaction coming); **burn rate** (tokens/min projected against
the 5h quota); **errored** (`StopFailure`, `failed`, repeated tool errors); **retired** (daemon
idle-retirement — normal; one-click resume); **completed** → Windows toast (per-session mute).
The toast is what actually kills alt-tabbing: you stop *checking*.

### 5.6 F6 — Multi-project dev dashboard

- **By project** (default): one row per imported project — sessions there across both subs, git
  branch + dirty, last activity, today's cost, workflow-map link, launch button pre-loaded with
  the project's usual subscription and preset.
- **By session:** the flat attention-sorted list.
- **Global header:** both subscriptions' 5h/7d gauges with reset countdowns, live session count,
  spend today, Claude Code version, core health.
- **Project groups** (`app-core` + `app-next` + worktrees). **Worktree-aware** launch targets.
- **Duplicate warning:** same cwd under both subscriptions.
- **Launch presets** per project: subscription + profile fn + model + agent + effort + opening
  prompt + name — encodes `claude-isg-ticket` / `claude-isg-orch` and the plan-first ticket prompt
  from `open-tab.mjs` as one click. **Preset groups** ("morning") launch several (D17).

### 5.7 F7 — One browser, zero terminals

1. **Sessions survive everything** — `--bg`; the daemon retires idle ones but keeps the
   conversation; resume is one click.
2. **The launcher covers every way you start Claude today** — all five profile functions, every
   imported project, every worktree, forced naming (no more `development-63`).
3. **A plain PowerShell pane** in the same grid for `git`, `npm`, `pnpm` — or the goal fails at the
   first `git status`.
4. **Pop-out to Windows Terminal** as a deliberate escape hatch, exclusivity-aware.
5. **Startup:** `flightdeck.cmd` — core if not running, Next dev, `msedge --app=…`; core also
   registered as a logon task so hooks always have a receiver.
6. **Adopt** externally started sessions when they exit (§4.3).

### 5.8 Cross-cutting: search and history

Search every transcript, both subscriptions, all projects — *"where did I do that Cloudflare
Workers deploy?"* **SQLite FTS5 via `node:sqlite`** (FTS5 verified on Node 26; fallback
`better-sqlite3` 13.x prebuilds), built by a background indexer that reuses the tailer's byte
offsets. Filters: project, subscription, date, tool, session. Because `cleanupPeriodDays` deletes
transcripts after 30 days, the index is also the only durable history. Phase 7.

---

## 6. Enhancements beyond the original list (ranked by how much they change the day)

1. **Push-based state via hooks** — sub-second, exact, documented. The deck reacts; it never polls
   for attention.
2. **Quota-aware launch routing** — invisible today, asked several times a day.
3. **Completion / needs-you toasts from core**, with no browser needed.
4. **Away recap** — `away_summary` already writes "what happened while you were away" in plain
   English; show it on the row.
5. **Name the unnamed** — force a name at launch; flag `nameSource: derived`.
6. **Retired-session resume** — turns the daemon's idle retirement into a feature.
7. **PR/MR chip** per session from the statusLine feed.
8. **Session handoff** — resume in a new worktree with `--resume --fork-session`.
9. **Cost dashboard** from `cost-state`, per project / subscription / week.
10. **Config-change detection** on the workflow map ("who added this hook?").
11. **Scheduled-task visibility** — `/loop` and cron tasks firing inside sessions.
12. **Read-only wallboard mode** for a second monitor.
13. **Daemon visibility** — roster, spare workers, retire events per subscription.

**Explicitly out of scope for v1:** remote/phone access (Remote Control), cloud sessions,
multi-machine aggregation, config scoring (claude-coach), anything on the undocumented
messaging pipe.

---

## 7. Security model (new in rev 3)

Flightdeck reads every transcript on the machine and spawns processes on request. "Bind
127.0.0.1" is necessary, not sufficient: any website open in the same browser can send a
no-preflight `POST` or open a WebSocket to a loopback port (the browser blocks *reading* the
response, not *sending* the request), and DNS rebinding turns "127.0.0.1 only" into "any page".
This exact shape produced **CVE-2025-49596** (MCP Inspector, CVSS 9.4, RCE despite loopback
binding; fixed with session tokens + Origin validation). Chrome 142+ prompts for
public→loopback requests (Local Network Access); other browsers may not. So (D10):

1. Bind `127.0.0.1` only, both ports; fail if taken. Never a host flag.
2. **Validate `Host`** (`127.0.0.1:4950` / `localhost:4950`) on every request — defeats DNS
   rebinding.
3. **Validate `Origin`** (exactly the UI origin, later the Tauri origin) on every mutating request
   and **every WebSocket upgrade**.
4. **Per-boot random bearer token** in `%LOCALAPPDATA%\flightdeck\token`; required on mutating
   routes, to Claude Code hooks via the `headers` field, to `statusline.py` by reading the file.
   **It is never delivered to the page** (rev 4, D32): the deck reaches core through the
   same-origin Next rewrite, which attaches the token server-side, and the WebSocket handshake —
   which cannot carry a header — takes a short-lived single-use **ticket** minted by
   `POST /pty-ticket` and bound to one PTY target. An XSS in the deck is then worth one pane for a
   few seconds, not the machine.
5. **No CORS headers.** Browser HTTP goes through a same-origin Next rewrite. `Sec-Fetch-Site`
   must be `same-origin` or `none`.
6. Never read, log or serve `sessions/*.key`, `daemon/*.key`, or credentials. Transcript text
   never leaves the machine; fixtures are scrubbed.
7. Launch only via the four profile functions with an allowlisted flag set; prompt text is passed
   as a single quoted argument, never interpolated into a shell string.

---

## 8. Risks and constraints

| # | Risk | Mitigation |
|---|---|---|
| R1 | ~~node-pty won't build on Node 26~~ | **Retired.** N-API prebuilds, verified on Node 26 and 20 (RESEARCH §A.1). |
| R2 | Internal file formats change with any Claude Code update | Feeds 1–3 are documented and primary; transcript parsing is best-effort behind fixtures; `scripts/doctor.mjs` diffs captured shapes after `claude update`. |
| R3 | `http` hook behaviour when the receiver is down (per-session error noise) | Core is a logon task (D2). Spike 0.3 measures the exact UX before hooks are installed permanently; fallback is `command` + `async: true`. |
| R4 | statusLine hook is on the render path | ≤150 ms POST, try/except, output byte-identical; measured in spike 0.5. |
| R5 | `agents --json` costs ~760 ms × 2 | every 10 s, never per second; hooks give the sub-second path. |
| R6 | 50 MB transcripts | byte-offset tail, partial-line buffer, truncation detection, 2 s stat poll; indexing off the hot path. |
| R7 | `fs.watch` unreliable on Windows (dropped/duplicate events, junctions) | nudge only; stat poll + reconciler are the truth. |
| R8 | Localhost CSRF / DNS rebinding / WebSocket hijack | §7 in full; tested in spike 0.7. |
| R9 | ~16 WebGL contexts per page | renderer budget §5.3; `onContextLoss` fallback. |
| R10 | Browser steals Ctrl+W / T / N / Tab | `keybindings.json` helper now; Tauri shell at 5b (D1). |
| R11 | Port 4949/4950 collision; 4200/4201 are neighbours | verify free at start, fail loudly; never probe or kill 4200/4201. |
| R12 | Duplicating claude-coach / claude-kit | describe and link, never score (D12). |
| R13 | Daemon idle-retirement mistaken for failure | modelled as *retired* with resume (D7); retire timing measured in spike 0.4. |
| R14 | Attach exclusivity conflicts (pane vs Windows Terminal vs `claude agents` TUI) | core tracks the holder; pop-out detaches first; the "held elsewhere" state is shown, not hidden. |
| R15 | Bash vs PowerShell routing drift | fixed before Phase 4 (D4). |
| R16 | ~~Next rewrite may buffer SSE~~ | **Retired.** It does not; both transports streamed unbuffered in dev and `next start` (RESEARCH §F.6.1). What buffers is gzip on the proxied response, fixed by `Cache-Control: no-transform`. SSE rides a `force-dynamic` route handler so that fix lives in the deck rather than in core (D27); the CORS fallback was never available (SEC-HTTP-5, §F.4.2). |
| R17 | `node:sqlite` is Release Candidate stability | acceptable for a local tool; `better-sqlite3` 13.x (N-API prebuilds) is the drop-in fallback. |

---

## 9. Stack (pinned versions verified 2026-09-10; re-check at install)

- **Next.js 16.3.4** (16.2.10 is what coach/groundwork run; either is fine) · **React 19.2** ·
  **TypeScript strict** · **Tailwind 4** · vitest 3 · playwright 1.5x — house pattern.
- **`@xterm/xterm` 6.0.0** + `addon-fit` 0.11.0, `addon-webgl` 0.19.0, `addon-serialize` 0.14.0,
  `addon-unicode11` 0.9.0, `addon-search` / `addon-web-links` (confirm current), `addon-clipboard`
  is beta — use the native paste path instead. `addon-canvas` is deprecated: do not use.
- **`node-pty` 1.1.0** on **Node 26** (prebuilt, verified) · **`ws`** · **`node:sqlite`** (FTS5).
- **chokidar 5** (or raw `fs.watch`) as the nudge; stat polling as the truth.
- **`toasted-notifier`** 10.1 (maintained SnoreToast fork) for Windows toasts until Tauri's native
  notifications.
- **Tauri 2.10.x** at Phase 5b (Rust toolchain, WebView2 evergreen).
- `flightdeck.cmd` + `scripts/install-core-task.ps1`.

---

## 10. Build order (detail and gates in BUILD-PLAN.md)

| Phase | Deliverable | Gate |
|---|---|---|
| 0 | Spikes: node-pty **✅**, TS-on-Node-26, `http` hook UX, `--bg` end-to-end shapes, statusLine POST, xterm in Next, security probe, SSE via rewrite | every shape captured as a fixture; receiver-down UX known |
| 1 | `flightdeck-core`: reconciler + hooks + statusLine + SQLite + SSE + Connect (dry-run) + logon task | every live session across both subs prints with state, flags, vitals, quota; a `Stop` appears within 1 s |
| 2 | Deck: dense attention-sorted rows, header gauges, palette, `flightdeck.cmd` | "what needs me?" answered without a terminal |
| 3 | Projects: import, workflow map, observed behaviour, groups, by-project view | app-next renders fully; docs-tool degrades gracefully |
| 4 | Launcher: presets, quota-aware picker, `--bg` dispatch, Ask, version chip; bash drift fixed | a ticket session starts from the deck, named, in its worktree, on the sub with more headroom |
| 5a | Terminal grid: attach panes, previews, layouts, renderer budget, keybindings helper | nine sessions in one window; closing a pane never stops a session |
| 5b | Tauri shell: tray badge, hotkey, native toasts | Ctrl+W deletes a word; nothing closes |
| 6 | Shell panes, pop-out, preset groups, toasts, handoff, duplicate warning | a full day with no hand-opened terminal |
| 7 | FTS5 search, cost/activity analytics, daemon view, optional OTLP receiver | "where did I deploy to Workers?" answers in < 1 s |

Phases 1–4 need no PTY and no shell; they deliver most of the value. Phase 5 is where the
remaining technical risk sits, and step 0 already removed its biggest part.

---

## 11. Open items

**Resolved in rev 3 → DECISIONS.md:** auto-launch (D17), notifications (D16), legacy `.claude`
(D14), cards vs table (D15), Ask button (D18), desktop vs web (D1).

**To verify in Phase 0 (not decisions):** whether `--bg` sessions render a statusLine (else their
vitals come from `cost-state`); the `http`-hook UX when core is down; whether `refreshInterval`
is worth the CPU; SSE through the Next rewrite; Ctrl+W inside the Tauri WebView.

**Three things only the owner decides:**
1. **Bash aliases** — delete them or make them delegate to the PowerShell functions? (D4)
2. **Core as a logon task** — acceptable to have `flightdeck-core` start with Windows? (D2)
3. **Rust toolchain** on this machine for the Phase 5b Tauri shell — fine, or stay browser-only
   and live with the `keybindings.json` remaps? (D1)
