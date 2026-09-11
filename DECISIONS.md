# Flightdeck — decisions

Architecture decisions with the evidence behind them. Each one points at the RESEARCH.md section
that justifies it. Status: **decided** (build on it), **provisional** (decided on current
evidence, re-check where noted), **open** (needs the owner).

---

## D1 — Web app or desktop app? (decided 2026-09-10, after RESEARCH §E.1–E.3)

**Question (owner, 2026-09-10):** "isn't it better if desktop app or web app for this kind of
project? can you double check that."

**Verdict: both, in this order — the *application* is a local web app; the *window* it lives in
becomes a Tauri desktop shell the moment the terminal grid ships (Phase 5). Electron is rejected.**

Separate the two things "desktop app" can mean:

1. **Where the logic runs.** Always a local server on this machine (Next.js UI on `127.0.0.1:4949`
   + a Node core service on `:4950`). Every option below — browser tab, Edge `--app` window, Tauri,
   Electron — loads *the same* localhost app. Nothing is rewritten when the shell changes. This is
   what makes the choice low-regret.
2. **What window shows it.** That is the only real decision, and it is driven by one fact:

| Concern | Browser / Edge `--app` window | Tauri 2 shell (WebView2) | Electron |
|---|---|---|---|
| Ctrl+W, Ctrl+T, Ctrl+N, Ctrl+Shift+W | **Browser eats them.** Ctrl+W closes the deck; Ctrl+T is Claude Code's todo toggle. Keyboard Lock needs fullscreen; PWA/`--app` windows still close | No tabs, so nothing to close; page still `preventDefault`s (no blanket accelerator switch — wry#569). Confirm in 5b | Page receives them |
| Toasts when the window is closed / minimized | Only while a tab is alive (Notification API) — the core service does toasts instead | Native, plus tray badge | Native, plus tray |
| Global "show the deck" hotkey | No | Yes (global-shortcut plugin) | Yes |
| Own taskbar icon / start-menu entry | `--app` gives a chromeless window; icon is the browser's | Yes | Yes |
| Install size | 0 | ~5–10 MB with the WebView2 already on Windows 11 (~180 MB if bundled) | ~120 MB+ (Electron 43.x) |
| Native modules | n/a — all native code lives in the Node core service | n/a — same | Would have to rebuild `node-pty` for Electron's ABI if anything ran in-process; avoidable only by keeping the sidecar, which removes Electron's one advantage |
| Extra toolchain | none | Rust toolchain on the dev machine (one-time) | none |
| Matches coach (4747) / groundwork (4848) house pattern | **yes** | UI yes; shell is new | UI yes; shell is new |

**Why not desktop-first:** Phases 1–4 (monitoring, workflow map, quota, launcher) involve **no
typing into a terminal**, so the keyboard problem does not exist yet. A browser window is the
fastest path to something useful, and it is the pattern two working apps here already use.

**Why not browser-forever:** the moment a terminal pane exists you type prompts into it, and
Ctrl+W (delete word) is muscle memory. In a browser that closes the window. `keybindings.json`
can move delete-word elsewhere and xterm.js can `preventDefault` most keys, but Chromium never
hands the page Ctrl+W / Ctrl+T / Ctrl+N / Ctrl+Shift+W outside fullscreen. That is a daily,
unfixable annoyance in the browser, and a non-issue in Tauri. Hence: **Tauri is scheduled, not
optional** — it lands in Phase 5b, right after the first terminal pane works.

**Why Tauri, not Electron:** identical keyboard win, 15–30× smaller, no ABI coupling with
`node-pty` (the PTY host stays in the Node core service either way), tray + notifications +
global shortcut are first-party plugins. Electron buys nothing here.

**What about the Claude desktop app already installed (AppX `Claude 1.30096.5.0`)?** Checked. It
runs parallel sessions **for one signed-in account**, its sessions are separate from CLI sessions,
and it has no project workflow map or quota comparison. It cannot show two subscriptions at once,
which is the whole point. Prior art, not a substitute (RESEARCH §D.5).

**Re-checked (RESEARCH §E.1–E.3):** Keyboard Lock works **only in fullscreen** — a hard
platform gate, and Chrome dropped the idea of a permission prompt in March 2026, so nothing is
coming that changes it. Installed PWAs and Edge `--app` windows still close on Ctrl+W (VS Code
#150735); VS Code for the Web and code-server remap rather than fight it. Tauri 2.10.1 is stable;
WebView2 has no tabs to close, but also no blanket accelerator-disable switch, so the page keeps
its `preventDefault` handlers and **Phase 5b starts by confirming Ctrl+W reaches the page**. The
schedule above stands: browser through Phase 4, Tauri shell at 5b, Electron out.

---

## D2 — Two processes: an always-on core service and an on-demand UI (decided)

- **`flightdeck-core`** (Node 26, `127.0.0.1:4950`): receives hook and statusLine events, runs
  the `agents --json` reconciler, tails transcripts, hosts PTYs, stores everything in SQLite, fires
  Windows toasts, exposes `/api` + WebSocket + SSE. Starts at logon (Task Scheduler) or from
  `flightdeck.cmd`. No UI.
- **`flightdeck` UI** (Next.js 16, `127.0.0.1:4949`): reads from core. Can be closed, restarted,
  hot-reloaded without losing a single event or PTY.

**Why:** hooks POST *whenever a session does something*, whether or not a browser is open; if the
receiver is down, the CLI records hook errors in every session (RESEARCH §D.2 exit-code rules).
An always-on receiver makes hooks safe to install permanently. It also answers open question 2
(notifications without a live window) and keeps `next dev` restarts harmless. Rev 2's "PTY
sidecar" grows into this; it is not a third process.

## D3 — Event feeds, ranked (decided)

| Rank | Feed | Latency | Gives | Documented? |
|---|---|---|---|---|
| 1 | **`http` hooks** in both `$CFG/settings.json`: `SessionStart`, `SessionEnd`, `UserPromptSubmit`, `Stop`, `StopFailure`, `Notification` (`idle_prompt`, `permission_prompt`, `agent_needs_input`, `agent_completed`), `PostToolUse`, `PreCompact`/`PostCompact`, `SubagentStart`/`SubagentStop` | ms | exact state transitions, "doing now" (tool name + input), waiting-for-you, turn done | yes (§D.2) |
| 2 | **statusLine heartbeat**: `statusline.py` POSTs its stdin JSON to core (150 ms timeout, swallow errors) | per render, 300 ms debounce, plus `refreshInterval` | cost, context % + window size, model, effort, rate limits (5h/7d/spend), PR, worktree, cache | yes (§D.3) |
| 3 | **`agents --json` × 2 dirs every 10 s** | 10 s | authoritative liveness, `state`/`waitingFor` for background sessions, short `id` | yes (§B.2) |
| 4 | **Transcript tail** (byte-offset, incremental) | ~1 s | `away_summary`, `cost-state` per model, `ai-title`, `last-prompt`, `compact_boundary`, `turn_duration`, files touched | **no** — best-effort, fixture-tested |
| 5 | `fs.watch` (or chokidar 5) on `sessions/` and `jobs/` + a 2 s `fs.stat` poll | instant nudge | triggers an early reconcile; the stat poll is the truth because Windows `fs.watch` drops events (RESEARCH §E.5) | n/a |

Rev 2 made feed 4 primary. Rev 3 makes it enrichment. A schema change in the JSONL must degrade
one card's extras, never liveness or cost.

## D4 — Launch routing stays in the PowerShell profile; fix the bash drift now (decided)

Flightdeck spawns `powershell -NoLogo -Command "<profile-function> --bg -n <name> '<prompt>'"`
exactly as `open-tab.mjs` does, so model/flag routing has one home. **Found today:** `.bashrc`
carries a second, diverging set of aliases (`claude-365` pins `--model claude-fable-5`, the PS
version relies on `settings.json` = `claude-fable-5-1[1m]`). Action before Phase 4: make the bash
aliases either identical or delegate to PowerShell, or delete them. v2 option (not now): one
declarative `launch-profiles.json` that generates both shells' functions *and* feeds Flightdeck's
preset list.

## D5 — Cost comes from Claude Code, never from token maths (decided)

`cost-state` records (`totalCostUSD`, per-model `costUSD`) and statusLine `cost.total_cost_usd`
are authoritative. The pricing table in RESEARCH §D.6 is only for `hasUnknownModelCost: true`
rows and sanity checks.

## D6 — Node 26 everywhere (decided)

`node-pty` 1.1.0 is N-API with win32-x64 prebuilds; installed and ran under Node 26 and Node 20
with no compiler (RESEARCH §A.1). The machine has **no MSVC toolset**, so anything native must
ship prebuilds — `node-pty` does, `node:sqlite` is built in (FTS5 verified). Rev 2's Node-20
sidecar requirement is withdrawn.

## D7 — Use Claude Code's own state vocabulary, add derived flags (decided)

Base: interactive `status ∈ busy|idle`; background `state ∈ working|blocked|done|failed|stopped`
+ `status ∈ busy|waiting|idle` + `waitingFor`. Derived by Flightdeck: **needs-you** (`blocked`,
`waitingFor`, `idle_prompt`/`permission_prompt` notification, or idle right after a `Stop`),
**wedged** (working with no events for N min), **context-pressure** (`used_percentage` ≥ 80),
**retired** (`done` after the daemon's idle retirement — RESEARCH §B.3 — a *normal* resting
state with a one-click resume), **errored** (`failed`, `StopFailure`, repeated tool errors).

## D8 — Panes attach to background sessions only; attach is exclusive (decided)

Only `--bg` sessions can be attached, and **one terminal at a time** (`Can't open — this session
is running in another terminal`). So: sessions Flightdeck launches are fully interactive; sessions
started in a terminal outside Flightdeck appear as **read-only cards** (transcript + status) until
they exit, after which `--bg --resume <id>` adopts them. Pop-out to Windows Terminal = detach the
pane, then `wt … claude attach <id>`. `claude logs` needs the daemon alive; when it is not, the
preview falls back to the transcript tail.

## D9 — Storage: SQLite via `node:sqlite`, outside the repo and outside `$CFG` (decided)

`%LOCALAPPDATA%\flightdeck\flightdeck.db`: sessions, events, statusline snapshots, projects,
presets, FTS5 index (Phase 7). Never write into `~\.claude-*` except the two settings blocks
Flightdeck installs (D13). Rationale: `cleanupPeriodDays` (30) deletes transcripts; the DB is the
only durable history.

`node:sqlite` is Release Candidate stability (1.2) in Node 26 — fine for a single-user local
tool. Its FTS5 was **verified on this machine's Node 26.3.0**; older Node builds lacked it
(nodejs/node#56951), so `scripts/doctor.mjs` re-runs the one-line check after every Node upgrade.
Drop-in fallback if it ever regresses: `better-sqlite3` 13.x (N-API, Windows prebuilds, FTS5
compiled in — RESEARCH §E.6).

## D10 — Security model for a localhost service that spawns processes (decided 2026-09-10)

Bind `127.0.0.1` only. In addition (rev 2 lacked these): **check `Host` and `Origin` on every
request and every WebSocket upgrade** (a page on any website can `fetch()` or open a WebSocket to
`127.0.0.1:4950` — CORS blocks reading the response, not sending the request); **per-boot random
bearer token** written by core to `%LOCALAPPDATA%\flightdeck\token`, read by the Next server and
injected into the page, required on every mutating route and the WebSocket; **no CORS headers at
all**; `Sec-Fetch-Site` must be `same-origin`/`none`. Hook and statusLine POSTs from Claude Code
carry the same token via the hook `headers` field.

**Evidence (RESEARCH §E.8):** Chrome 142 (2025-10-28) prompts for public→loopback requests
(Local Network Access), but only for HTTPS pages and only in Chrome — Edge/Firefox/Safari are
unverified, so the browser is not the boundary. **CVE-2025-49596** (MCP Inspector, CVSS 9.4) was
RCE on a developer machine through a 127.0.0.1-bound tool via DNS rebinding; the fix was exactly
this list: tokens, Origin validation, Host validation. `Sec-Fetch-Site` is one strong layer, not
the only one — it does not cover the WebSocket handshake.

## D11 — Quota and per-session vitals via the existing statusLine hook (decided)

Extend `~/.claude/hooks/statusline.py` (already shared by both configs) with a ≤150 ms POST of
the raw stdin JSON to `http://127.0.0.1:4950/api/statusline`, wrapped in try/except, never
altering render output. Core persists the last-known `rate_limits` per config dir so quota is
known immediately after a restart. Optional `statusLine.refreshInterval: 30` so idle sessions
still heartbeat. Rev 2's "write a quota file" is dropped — one always-on receiver makes files
unnecessary.

## D12 — Not building (decided)

Config *scoring* (claude-coach / coach-core owns it — link to `:4747` when `gates.json` exists),
remote/phone access (Remote Control), cloud sessions (`--cloud`), multi-machine aggregation,
anything on the undocumented messaging pipe (`messagingSocketPath`, `.key` files), a re-implementation
of agent view's "peek & reply".

## D13 — "Connect subscription" installs the two settings blocks, with a diff and a backup (decided)

Flightdeck never asks the owner to edit `settings.json` by hand (house rule: automate, don't ask them to
remember). The Connect button shows the exact JSON it will merge into `$CFG/settings.json`
(hooks + statusLine), writes `settings.json.bak-<date>` first, then merges. Hooks are read at
session start, so already-running sessions join on their next restart — the UI says so.

## D14 — Legacy `~\.claude` (decided) — open question 3

Hidden by default. A "show legacy" toggle lists its `projects/` transcripts read-only for search.
Its `hooks/` and `CLAUDE.md` are shown in the instruction stack because both live configs
reference them.

## D15 — Dense rows, not cards (decided) — open question 4

One k9s-style row per session at every count (fits 20+ on 1080p), expandable inline to the full
card. No second layout to maintain.

## D16 — Notifications come from the core service (decided 2026-09-10)

The core fires Windows toasts on needs-you / completed / errored regardless of any window, with
per-session mute. Library: **`toasted-notifier` 10.1** (maintained SnoreToast fork; `node-notifier`
is five years stale — RESEARCH §E.4). Tauri (Phase 5b) replaces it with the native notification
plugin and adds a tray badge and click-to-focus.

## D17 — Morning presets are manual, one click (decided) — open question 1

No auto-launch on boot (it would spend quota unattended). A named preset *group* ("morning:
app-core orchestrator + ticket + reports") launches in one click from the palette.

## D18 — Build the Ask button, measure it (decided) — open question 6

It differs from `claude -p` in a terminal by quota-aware subscription choice, `--max-budget-usd`,
any imported project as cwd, and a result that lands in the deck. Ship in Phase 4; if the usage
counter is still zero after two weeks, remove it.

## D19 — Phase gates are behavioural, not calendar (decided)

Each phase in BUILD-PLAN.md ends with a sentence the owner can verify by using the thing. No phase
starts until the previous gate is true.

## D20 — DP1: the bash Claude aliases are deleted, not synced (decided 2026-09-10, resolves DP1)

**Question (owner, 2026-09-10):** delete the bash aliases, or make them delegate to the PowerShell
functions?

**Verdict: delete them.** `.bashrc` lines 24–33 go; the PowerShell profile stays the only home for
launch routing, as D4 requires.

The drift was real and already wrong: bash pinned `claude-365` to `--model claude-fable-5` and
`claude-isg` to `--model opus`, while the PowerShell functions pin no model at all and let each
subscription's `settings.json` decide (`claude-fable-5-1[1m]`). Two of the bash aliases
(`-1m` variants, `claude-isg-bg`) have no PowerShell counterpart either.

**Why not delegate:** a bash alias can only reach the functions as
`powershell -Command claude-isg @args`, which nests ConPTY inside MinTTY. That is acceptable for a
`--bg` launch and poor for an interactive one — mangled keys, broken resize, alt-screen artefacts.
It would also add a second spawn path that Flightdeck's launcher never uses.

**Why not sync them:** D4 offered it; it re-creates the same drift the next time `settings.json`
changes, which is exactly how this bug appeared.

**Consequence:** launching Claude from Git Bash stops working — deliberately. The `claude` guard
alias (line 33) is rewritten to point at the PowerShell functions instead of the bash ones.
Flightdeck's launcher (P4-T2) only ever invokes the four allowlisted profile functions
(SECURITY.md SEC-PROC-2), so nothing in the product depends on the deleted aliases. **P4-T0 is
unblocked.**

## D21 — DP2: core runs as a Windows logon task (decided 2026-09-10, resolves DP2)

**Verdict: yes.** `flightdeck-core` starts at logon via Task Scheduler; `flightdeck.cmd` still
starts it on demand if it is not already up.

D2's argument decides it: hooks POST whenever a session does anything, browser open or not, and a
down receiver makes the CLI record hook errors in *every* session (RESEARCH §D.2). Hooks are only
safe to install permanently if the receiver is always up, and permanent hooks are the whole
premise of feed 1 in D3.

Shape is already fixed by SECURITY.md SEC-OPS-3 and SEC-FS-4: run only when the owner is logged on, no
stored credentials, never elevated, token file written with `icacls /inheritance:r`. `scripts/doctor`
checks the task exists and the ACL is right. **P1-T12 is unblocked.**

P0-T3 measures the receiver-down UX regardless — it sets how loudly `doctor` complains when the
task is not running, not whether the task exists.

## D22 — DP3: the Tauri shell is deferred, not scheduled (deferred 2026-09-10, supersedes part of D1)

**Question (owner, 2026-09-10):** "i dont understand this, i dont need ctrl+w, i just click close."

D1 scheduled Tauri as "not optional" on one argument: Ctrl+W is delete-previous-word in a terminal,
and Chromium never delivers it to the page, so typing it into a browser-hosted pane closes the deck.
**That argument does not apply — the owner does not use Ctrl+W to erase words.** With it gone, Tauri's
remaining value is a tray badge, a global summon hotkey and its own taskbar entry. Native toasts are
*not* a reason: D16 already has core firing them with no window open.

**Verdict: defer the decision to P5a.** P5b is parked, not dropped. Once a real terminal pane exists
and the owner has typed into it in a browser window, the answer takes five minutes to reach; deciding now
would be guessing. This stays low-regret because D1's first point holds — the application is the same
localhost app in every shell, so swapping the window later rewrites nothing.

**P5b-T1 stays blocked, on P5a rather than on DP3.** If the answer at P5a is no, P5b is dropped and
D1's schedule is amended; the Rust toolchain is installed only if the answer is yes.

## D23 — The repository is public (decided 2026-09-10)

`kimbelas/flightdeck` is public. SECURITY.md §6 said "private repository" when it was written; §6 is
amended to match reality rather than the reverse.

This is sound because the app needs no secrets: the bearer token is generated per boot at runtime
(SEC-HTTP-3), `fixtures/raw/` is git-ignored and every committed fixture is scrubbed (§10.3),
transcripts and the SQLite store live outside the repo (SEC-DATA-1), and gitleaks runs over full
history on every push (SEC-SUP-2).

**Accepted cost:** SPEC.md, RESEARCH.md and SECURITY.md describe this machine's config-dir layout,
loopback ports and which controls are not built yet. That is a readable map for anyone who already
has code execution here — which SECURITY.md §1 already places out of scope ("malware already running
as the owner's user owns the machine regardless"). The controls do not depend on any of it being secret.

**Amended (2026-09-11): public does not mean identifiable.** D23 originally reasoned that because
the repo is public under a known account, the Windows account name in the fixtures was not a
disclosure (RESEARCH.md F.7.8). That conflated two different names, and it licensed a scrubber rule
that also published every client project folder and a ticket id from a private tracker. The repo
stays public; what it may contain is now narrower. Nothing in the repo names the owner, their
employer, their clients or their machine account: the person is "the owner" throughout, paths are
generic, `fakePath` keeps only structural segments, and `PROMPTS.md` — the verbatim prompt log — is
git-ignored rather than committed. The two config-dir names `.claude-365` and `.claude-isg` stay,
because they are real directories the code resolves by name (`claude-install.ts`) and renaming them
would break a live machine to hide two tokens that decode to nothing on their own; what has gone is
the table that said what each one was for.

## D24 — `daemon/roster.json` is allowlisted by field, not as a file (decided 2026-09-11)

**Found in P0-T4** (RESEARCH.md F.2.10). SEC-FS-1 allowlisted `daemon/roster.json` for reading
while SEC-FS-2 forbade `daemon/*.key`. The two rules contradicted each other: the roster carries
`rvAuth` and `ptyAuth` — 32 hex characters each, the auth for the rendezvous and PTY pipes — and
`dispatch.launch.args` / `dispatch.respawnFlags` holding the **full prompt text** of every
background session. A file-level allowlist on that file grants exactly what SEC-FS-2 exists to
deny, only inline instead of in a sibling `.key`.

**Verdict: the allowlist unit for this file is the field, not the file.** SEC-FS-1 now permits
`workers.<id>.{pid,sessionId,cwd,startedAt,cliVersion}` and nothing else; SEC-FS-2 names `rvAuth`,
`ptyAuth` and `dispatch` explicitly as never-read. The adapter discards the rest before the value
leaves it, so nothing above the adapter can leak a field it never receives — which also means the
redaction rule (SEC-DATA-2) is a second line of defence here, not the first.

**Why not drop the file from the allowlist entirely?** Because the roster is the only place that
records a dead `supervisorPid`, which is the signature of the state in F.2.16 where `stop`, `rm`
and `logs` all fail permanently. P7-T4 needs to surface that, and `pid`/`startedAt` are enough.

**Cost:** a field allowlist is easy to widen by accident later. P1-T14 carries the deny-list test
that fails if `rvAuth`, `ptyAuth` or `dispatch` ever reaches a parsed value, so widening it has to
be deliberate.

## D25 — `main` is protected with no bypass, and green-in-isolation is not green (decided 2026-09-11)

Until today SEC-SUP-5 and CODING-STANDARDS §12 both asserted `main` was protected. Neither a
branch protection rule nor a ruleset existed. It does now, and the shape was chosen by an
incident rather than by taste.

**What happened.** Dependabot #8 (`@eslint/js` 9 → 10) and #10 (grouped vitest 5) were each green
on their own branch and were merged minutes apart. `main` went red immediately: `@eslint/js` 10
peers on `eslint ^10` while the project is on `^9`, so `npm ci` stopped resolving, and
`js.configs.recommended` became eslint 10's rule set running on an eslint 9 engine — which failed
lint on a file nobody had touched. #8 was reverted in #11. Neither PR was wrong on its own; the
base each was tested against was stale.

**So the load-bearing setting is "require branches to be up to date before merging",** not the
PR requirement. A PR rule alone would have changed nothing that day. The dependency-family groups
added in the same session are the other half of the fix: the two packages can no longer be
proposed apart in the first place.

**Bypass list is empty, admin included.** A bypass for the one maintainer would make the rule
advisory, and the failure mode being guarded against is not malice, it is a tired maintainer
merging two green ticks. The cost is real and accepted: no one-line fix goes straight to `main`
ever again, including at 11pm. The escape hatch is a two-click edit to the ruleset, which is a
deliberate act that leaves an audit trail — which is the point.

**0 required approvals, not 1.** GitHub will not let an author approve their own PR, so a single
maintainer with 1 required approval cannot merge anything at all. Thread resolution is required
instead, which is the part of review a solo maintainer can actually perform.

**`Next.js build` is not a required check** until the UI exists; a required check that never runs
blocks every PR forever.

## D26 — Flightdeck is a lens over the machine, not a container for it (decided 2026-09-11)

**Question (owner, 2026-09-11):** "all things should be under flightdeck folder, correct?" — and then,
"move them from development to flightdeck … also all memories and stuff".

**Verdict: nothing moves.** Flightdeck reads and displays what lives elsewhere. P3-T3 is a
workflow-map *reader* over each project's instruction stack, agents, commands, skills and hooks;
P3-T6 **deep links** to coach's `gates.json` verdict rather than absorbing coach. Owning none of
it is the design, not an omission.

**What breaks if the folder becomes the container** — all four measured, not predicted:

1. `claude-kit` is a registered **`directory` marketplace in both config dirs**. Moving the folder
   unregisters it, and `context-hygiene` (the `guard-read` and `session-ceiling` hooks) and
   `shell-review` stop loading in every session on the machine.
2. `multi-business-system` is a separate product with its own remote
   (`kimbelas/multi-business-system`). Nesting it costs it that identity.
3. This repo is a git repo with a protected `main`. A repo inside it is either an untracked `.git`
   git silently ignores, or a flattening that destroys the inner history and remote.
4. **Memories cannot be moved at all.** The path
   `~/.claude-365/projects/C--Users-dev-Documents-development/memory/` is *derived from the
   working directory*. Re-keying them to a flightdeck path would make four of the six —
   coach-core, paperweight, app-speed-plan, terse-output — load only inside Flightdeck and stop
   loading in `app-next` and `docs-tool`, which is the opposite of the intent.

**The rule already existed and is upheld, not invented here.** `claude-kit`'s README states the two
tests an asset must pass to live there — measured use and portability — and concludes: *"Anything
failing test 2 stays in its own repo. A plugin loads everywhere it is installed, so shipping a
repo-specific agent here would spend context in every project for value in one."* The same logic
forbids a repo-specific asset moving into Flightdeck. Three homes, three reasons: repo-specific
assets stay in their repo, portable ones go to `claude-kit`, and Flightdeck imports both by path.

**Consequence:** the want behind the question — one place to see everything — is **P3-T1**, project
registry by path. Note what that does *not* mean: the registry ships empty, importing is the owner's
action in the deck, and nothing scans the disk or compiles in a project list. A folder becomes
readable to core because he imported it, which is also what keeps SEC-FS-1's allowlist honest —
it grows by one deliberate act at a time. The projects named on that task are acceptance targets
for the P3 gate, not contents.

## D27 — SSE rides a force-dynamic route handler; the rewrite keeps everything else (decided 2026-09-11)

**Measured in P0-T8** (RESEARCH.md F.6), against SPEC.md R16, which asked what to do *if* the Next
rewrite buffers SSE. R16's second fallback was already dead before the spike started — SEC-HTTP-5
forbids CORS headers and F.4.2 measured that a page on :4949 cannot reach :4950 directly at all —
so the real question was rewrite versus route handler.

**The rewrite does not inherently buffer.** Both transports streamed unbuffered in `next dev`
*and* `next start`: median inter-event 202–203 ms against a 200 ms cadence, worst gap 214 ms,
across three runs. R16 can be retired on the evidence rather than mitigated.

**So latency did not decide it.** The route handler is first to first byte in `next start` in
every run (11.6–20.1 ms against 16.3–26.7 ms), but the ranges nearly touch and eight milliseconds
on a first byte decides nothing.

**What decided it is where the anti-buffering mitigation lives.** SSE through Next is batched by
**gzip**: Next compresses the proxied response, a compressor holds the stream to the end, and 12
events arrive as one chunk at ~2.25 s. Exactly one server-side header prevents it —
`Cache-Control: no-transform`. `Content-Encoding: identity` and `X-Accel-Buffering: no` are both
ignored, and `Accept-Encoding: identity` works but is a request header, which a browser's
`EventSource` cannot set.

- On the **rewrite**, that header lives in **core**, in another process. If core ever emits a
  stream without it, the deck batches — with a `200 OK`, every event eventually delivered, and
  nothing in any log. It would present as a slow reconciler and be debugged in the wrong process.
- On the **route handler**, the deck defends itself: `accept-encoding: identity` on the upstream
  leg and `no-transform` on its own response, both in the same file. A core that forgets cannot
  batch the deck.

A silent failure whose fix lives across a process boundary is worth one file to close.

**Two further differences, both measured, both in the same direction.** Core down returns a
deliberate **503** from the route handler and Next's **500 plus an HTML error page** from the
rewrite — and 500 is also what the deck returns when the deck itself is broken, so the rewrite
gives the store no way to tell "core restarted" from "the UI is broken". And the handler is the
only place a stream-specific concern (retry hints, last-event-id, a heartbeat) can live at all.

**The rewrite is not being replaced.** `/api/core/*` stays exactly as it is for every non-stream
call, and it remains load-bearing (F.4.2): it is still the only route from the browser to core.
The streaming route sits at **`/api/stream`**, deliberately outside the `/api/core/*` prefix, so
"forwarded verbatim to core" and "handled by the deck" are visible in the URL rather than in a
comment. A route handler under `/api/core/` would win over the rewrite silently, which is exactly
the kind of thing that is discovered a year later.

**`middleware.ts` is now `proxy.ts`, and this is not cosmetic.** The token is a per-boot random in
a file (SEC-HTTP-3). Middleware-set request headers *do* reach an external rewrite destination —
so the rewrite could carry a token — but `middleware.ts` runs on Next's **edge** runtime, where
`node:fs` does not exist and build-time `process.env` inlining cannot see a value that will not
exist until core next starts. Next 16 deprecates `middleware` for `proxy`, and **proxy always runs
on Node.js**. The rename is what makes the token readable at all, so the deck gets it either way:
`proxy.ts` authenticates every `/api/core/*` call, and the route handler reads the token itself.

**Cost, accepted.** Two places now read the token (`proxy.ts` and the route handler) and one more
file exists that would not have existed. Both are the price of the mitigation being local, and
both are named here so a later reader does not "simplify" the route handler back into the rewrite
without rerunning `scripts/sse-spike-cli.ts`.

## D28 — a shape is captured by the task that parses it, not by the phase that first saw it (decided 2026-09-11)

**Forced by P0-T9.** P0's gate read "every shape in P0 is captured as a scrubbed fixture and the
http-hook receiver-down behaviour is documented". The second clause was true. The first was false,
and checking why produced a better rule than patching it would have.

**What was actually missing.** Three shapes P0 observed and never captured — `claude logs` output,
`daemon.log`'s lifecycle lines, and `daemon/roster.json` — all for one reason:
`scripts/capture-fixtures.mjs` only walked `*.json` and said nothing about the rest
(RESEARCH.md F.7.4). The silent skip is fixed regardless of this decision; a capture it cannot
scrub is now either on an explicit deferral list or a hard failure.

**Verdict: the gate binds a shape to its consumer, not to the phase that noticed it.** P0's gate is
now "every shape a P1 task parses is captured as a scrubbed fixture…", and the other two captures
move into the tasks that read them — `claude logs` into P5a-T4, `daemon.log` into P7-T4.

**Why not simply capture all three now, as the original wording demanded?** Because a fixture
captured without a consumer is captured wrong, and P0-T9 produced the proof rather than the
argument. `roster.workers` is keyed by session id, and the scrubber — built for shapes whose keys
are field names — rewrote the values and left the keys, yielding a fixture that asserted a
relationship the real file guarantees and the fixture no longer had (F.7.5). That was caught only
because P1-T14's parser is a phase away and concrete enough to check against. `claude logs` output
is a 4723-line terminal frame with no parser until P5a: there is no way to know which of its
structure matters, and every guess would be committed as though it were observed.

**What this costs, stated plainly.** The gate is weaker than it was. A shape can now sit in
`fixtures/raw/` — git-ignored, on one machine — for several phases, and if that machine is rebuilt
the capture is gone and has to be provoked again. That is a real risk and it is accepted for one
reason: the alternative is not a stronger gate, it is a gate that gets declared true by writing
fixtures nobody can validate. The deferral list in `capture-fixtures.mjs` carries the task id for
each deferred capture, so the debt is named in the code that would otherwise hide it, and
`--check` prints it on every run.

**The gate keeps its teeth where they matter.** P1 is the phase that turns observed shapes into
parsers, so "every shape a P1 task parses" is the clause that actually protects anything — and
`daemon/roster.json`, the one P1-T14 needs, is captured, projected through a field allowlist, and
covered by the deny-list test D24 asked for.

## D29 — D7's vocabulary, corrected against what P0 actually measured (decided 2026-09-11)

**Forced by P1-T1.** D7 said "use Claude Code's own state vocabulary, add derived flags", and was
written before any of it had been observed. P0-T4 then measured the listing. Three of D7's names
do not survive contact, and the domain model is where that had to be settled rather than worked
around in each adapter.

**`waitingFor` is gone.** D7 made it a needs-you trigger. It is in the binary's strings and in the
official docs, and it **never appeared on any record, in any state, including a genuinely blocked
one** (RESEARCH.md F.2.1). The attention signal from the listing is `state === 'blocked'`, and
nothing may key off `waitingFor` because there is nothing to key off.

**`stopped` is gone from the run states.** `claude stop <id>` leaves a record reading `state: done`,
not `stopped`; the documented state was never observed (F.2.3). It survives as an *end reason*.

**`done` means "not running" and nothing more, so "why" is a separate axis.** Stopped, retired and
finished are indistinguishable in the listing — only `daemon.log` separates them. So `EndReason`
is modelled explicitly and defaults to **`unknown`**, which is the honest answer for most of P1:
Flightdeck's own audit row supplies `stopped` for actions it took (SEC-PROC-3, P4-T2), and
`daemon.log` supplies the rest at P7-T4.

**Consequently `retired` is derived from the end reason, not from the listing.** D7 listed it among
the derived flags as though it were observable. It is not. Modelling it as a reason also gets D7's
own requirement for free — retirement is a *normal* resting state with a one-click resume, so it
must never read as `errored`, and a flag derived from `EndReason === 'retired'` cannot.

**And liveness is `pid`, not state.** F.2.1: a background record has three shapes, `pid` and
`status` are both optional, and **the presence of `pid` is the liveness test**. `status` was absent
on a live three-second-old session, so nothing may key off it alone. `wedged` therefore requires
liveness as well as silence — without it every finished row in the listing turns amber ten minutes
after it ends.

**What this does not change.** D7's five flags keep their names and their meanings; this is a
correction to the *inputs*, not to the product. `needs-you` still has the two sources D7 gave it —
the listing's `blocked`, and the notification/post-Stop signals — but the second arrives as an
explicit signal from the hooks feed (P1-T5) instead of being invented from a field that does not
exist.

**Cost:** the vocabulary now differs from Claude Code's documentation in two places, which is
exactly what D7 set out to avoid. Accepted, because the alternative is a vocabulary that matches
the docs and not the software. `contracts/session.ts` carries the reasons beside the unions, and
`tests/contracts/session.test.ts` fails if `stopped` or `retired` is ever added back as a run state.

---

## D30 — a terminal slice is pulled ahead of P2, P3 and P4 (decided 2026-09-11)

**Asked for directly.** "I want to see my terminals inside in the next 4 hours of continuous
development." By the roadmap, typing into a pane is P5a — behind thirty-odd tasks of core, deck,
projects and launcher. Those thirty tasks are not what makes a terminal appear in a browser; they
are what makes the *deck* worth looking at. So this builds the narrow vertical instead: core comes
up, a PTY host attaches, a socket carries the bytes, one page renders the panes.

**What is pulled forward:** P1-T3 (the `agents --json` adapter) and P1-T10 (this middleware) out of
P1; P5a-T1, P5a-T2, P5a-T3 and part of P5a-T5 out of P5a; enough of P2-T1 and P2-T6 to host and
launch it.

**What is explicitly not built, and so what the slice does not do.** No SQLite (P1-T8), no SSE
(P1-T9), no hooks or statusLine receiver (P1-T5, P1-T6), no reconciler (P1-T4). The deck therefore
**polls when asked and does not update itself**: it shows live terminals inside a dead deck. That
is the honest trade and it is worth naming, because the M1 milestone — "the deck answers *what
needs me?*" — is exactly the part being skipped, and it is not reached by this work.

**The constraint that decides what "my terminals" can mean.** Every session on the machine right
now is `kind: "interactive"` (five of them, across both subscriptions). `claude attach` takes
**background** sessions only, which SPEC §5.2 already recorded — *"vitals but read-only —
interactive sessions cannot be attached."* A terminal already bound to a Windows Terminal tab
cannot be re-hosted in a pane, today or ever. So the slice delivers typable panes for sessions
**Flightdeck starts** with `--bg`, plus plain shells; existing interactive sessions appear as rows
and are not attachable. This is a property of Claude Code, not a shortcut taken here.

**Phase gates are not waived, they are deferred.** P1 and P5a stay open with their unbuilt tasks
`todo`. Nothing here marks a phase done, and D19 (gates are behavioural) still decides when one is.
The slice's own tasks are marked `done` only where their tests are green in CI.

**Cost:** the roadmap stops reading as a build order for the length of this slice. Accepted,
because the alternative is four hours of infrastructure with nothing to look at, and because every
task pulled forward is one the roadmap already contains — none of it is throwaway.

---

## D31 — the page gets the token, and that is a real cost (decided 2026-09-11)

> **Superseded by D32 on 2026-09-11.** The ticket was built at the end of P5a, as this
> decision said it should be. What follows is the reasoning for the shortcut while it stood;
> the cost it names is no longer being paid.

**Forced by the PTY socket.** A browser cannot set headers on a WebSocket handshake, so SEC-WS-1
puts the token in the first frame — which means the page must hold it. SPEC §7 rule 4 already said
so ("delivered to the page by the Next server"), but `contracts/core-token.ts` says the opposite in
its header: *"the token has no reason to be in the browser."* Both were written before anything
opened a socket. The socket settles it: the token reaches the page, by a Next route handler that
reads the file server-side and returns it same-origin only.

**What this actually costs.** P0-T8 measured that core's stream carries no Content-Type backstop,
which makes a leaked token worth more on GET than on POST (F.6.5). With the token in the page,
anything that can run script in the deck's origin can read it — an XSS in the deck is now a full
core compromise rather than a defaced page. The CSP (SEC-UI-1, nonce + `strict-dynamic`) is what
stands between those two outcomes, which promotes it from hardening to a load-bearing control.

**Why not a ticket, which is the right answer.** A short-lived single-use ticket, minted by core
and exchanged at the handshake, would keep the per-boot token out of the page entirely and cap the
blast radius of an XSS at one pane. It is perhaps forty lines. It is not built here because D30's
four hours buy one thing — a terminal in the browser — and this is the cheapest path that is also
the one the SPEC already describes. **P5a-T2b is filed for it, and the token route carries a
comment pointing at this decision** so the shortcut cannot be mistaken for a design.

**Not negotiable in the meantime:** the route is same-origin only, `no-store`, and never logs what
it returns. `core-token.ts`'s header is corrected rather than left to contradict this.

**Cost:** accepted deliberately and time-boxed. If the ticket is not built by the end of P5a, the
right move is to stop and build it before the deck leaves the machine it was written on.

---

## D32 — the socket takes a ticket, and the token goes back behind the server (decided 2026-09-11)

**Supersedes D31**, which said this should be built before the deck left this machine, and which
filed P5a-T2b to do it. It is built.

**The shape.** `POST /pty-ticket` mints a 256-bit ticket bound to one `PtyTarget`, valid for 10 s,
deleted the moment it is presented. The deck reaches that route through the same-origin Next
rewrite, so `proxy.ts` attaches the per-boot bearer server-side and the page authorises a mint it
could not perform itself. `WS /pty` redeems the ticket against the target parsed from *its own
upgrade URL* — not from any frame — and spawns nothing if the two disagree. `app/api/pty-token`
is deleted. The token no longer enters the browser at all.

**What it actually buys, stated honestly.** An XSS in the deck can still mint tickets: it is running
in the origin the mint route trusts, and no server-side check can tell its fetch from the deck's.
What it can no longer do is *take anything with it*. Before, one `fetch('/api/pty-token')` yielded
a credential good for every route core answers, for as long as core stays up, exfiltrable to
anywhere and usable by any process on the machine. Now the most it can carry off is a receipt for
one pane, already spent or expired within seconds. The difference is not "an XSS cannot open a
terminal" — it is that a transient script bug stops being a durable key to the machine.

**Bound to a target, not just short-lived.** The redemption compares the ticket's target with the
socket's, which is what makes "one ticket, one pane" true rather than "one ticket, one socket of
your choosing". It costs one comparison and it is the difference between capping the blast radius
at the pane the deck asked for and capping it at everything `PaneRegistry` can spawn — a shell on
this machine included.

**`LoopbackGuard.screenFirstFrame` is deleted, not left unused.** A guard method that still
compared the first frame against the token would be a second, silent way in — reachable the moment
anyone wired it back up, and passing its own tests the whole time. The socket's first frame is now
TicketOffice's business alone, and the only remaining token comparison on a socket is the one in
`scripts/security-probe.ts`, which measures browser behaviour rather than core's.

**Not constant-time, deliberately.** `isAuthorised` hashes and compares in constant time because
the token is long-lived and an attacker can probe it indefinitely. A ticket is 256 random bits that
survive one presentation and ten seconds; there is no repeatable measurement to take, and the
lookup is keyed on a fixed-length digest either way. The office holds hashes, not tickets, so a
heap dump yields nothing usable.

**Cost.** A pane now makes a round trip before its socket opens, and `PaneSocket.connect` became
asynchronous — which needed an `abandoned` flag, because a pane can be closed while its mint is in
flight. The grid lost its page-wide "no core token" banner; each pane reports its own refusal
instead, which is more honest anyway. Roughly 120 lines, mostly tests: the first frame now has a
suite of its own (`tests/core/http/pty-socket-auth.test.ts`), including the regression that the
per-boot token presented as a ticket closes 1008.
