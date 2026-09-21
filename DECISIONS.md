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

## D33 — Hooks authenticate with a stable ingest key, not the per-boot token (decided 2026-09-12, P1-T11)

**Question.** P1-T11's open question was whether the http handler's `allowedEnvVars` could supply
the bearer token, so a per-boot secret (SEC-HTTP-3) would not have to be written literally into
`settings.json`.

**It can, and that turned out to be the smaller half of the question** (RESEARCH.md F.1.7).
`"Authorization": "Bearer ${FLIGHTDECK_TOKEN}"` with `"allowedEnvVars": ["FLIGHTDECK_TOKEN"]`
resolves; an undeclared name resolves to the empty string rather than being left alone. So the
secret need never appear in a config file. But the value is read from the **session process's own
environment**, which Windows fixes at process creation — so a session started before core restarts
carries the previous boot's token and cannot be told otherwise.

**And a stale bearer is not a silent degradation.** It is a `401`, which Claude Code renders as
`Stop hook error occurred · ctrl+o to see` for every turn afterwards (F.1.5) — the exact banner
this task refuses to install into, except caused by us and while core is running. Writing the token
literally into `settings.json` has the identical failure plus a credential in a config file, so
`allowedEnvVars` is strictly better and still not sufficient.

**Decided: a second, narrower credential** — SEC-HTTP-7, a 256-bit ingest key created once per
install, kept beside the token with the same ACL, never rotated on restart, and accepted on
`POST /hooks` and nothing else. Three options were on the table:

| | Never stale | New control | Cost |
|---|---|---|---|
| Per-boot token in the env var | no | none | a banner in every session older than core |
| **Stable ingest key** | **yes** | **SEC-HTTP-7** | **a second secret to rotate** |
| `command` hooks reading the token file | yes | none | a process spawn per tool call, every turn |

**The principle, which is the part worth keeping: a secret a client cannot re-read must not rotate
under it.** Control routes are driven by a person through the deck, which re-reads the token file
per request; the statusLine block re-reads it per render (SEC-ING-3). Hooks are the one client that
captures its credential at spawn and lives for hours. Per-boot is right for the first two and
impossible for the third.

**What the key is worth to someone who steals it:** posting fabricated hook events into the local
log and the deck. It cannot launch a session, read `/sessions`, open a stream or mint a PTY ticket.
It is no more exposed than the token file already is — any process running as the owner can read
either — and it is not in `settings.json`, which is the file most likely to be pasted into a
conversation.

**Consequences.** `Rotate token` (SEC-OPS-2) rotates the ingest key as well, which costs every
running session a restart — acceptable when a person asked for it, which is exactly why a core
restart must not do it. Connect publishes the key as the `FLIGHTDECK_TOKEN` user environment
variable and Disconnect withdraws it; terminals already open do not see it, which is a one-time
cost because the key never changes.

## D34 — the keyboard is a table keyed on focus, and it claims exactly one key from a pane (decided 2026-09-14, P2-T5)

SPEC §5.4 asks for `Ctrl+K`, `j`/`k`/arrows, `Enter`/`Esc`, `1`–`9`, `/` and `?`. Every one of those
except `Ctrl+K` is a single character somebody is otherwise in the middle of typing, and the deck is
a page with xterm panes and a launch textarea on it. **The keymap was never the hard part; deciding
where each key is dead was.**

**Decided: bindings carry a `contexts` column and the deck resolves against a `KeyContext`** —
`deck`, `text`, `terminal`, `palette` — derived from four facts about the focused element
(`contracts/keymap.ts`). Three consequences that are the actual decision:

- **`Esc` is never taken from a terminal pane.** It belongs to vim, to Claude Code's own TUI and to
  everything else that will ever run in one. A deck that swallows `Esc` is a deck you cannot work in.
- **`Ctrl+K` *is* taken from a terminal pane**, and it is the only key that is. A pane that can
  swallow the one global key is a pane you cannot leave without reaching for the mouse. The trade is
  named on the `?` sheet (`TERMINAL_CLAIMED`) rather than left to be discovered.
- **The listener captures on `window`.** Bubbling is too late — xterm handles keys on its own hidden
  textarea — so the deck now sees every keystroke on the page first, and `keyContextFor` is the only
  thing between that and a swallowed prompt. It is tested against a plain object, not a DOM.

**`j`/`k` move real DOM focus rather than a selection index.** The session row's title already *is*
a button (P2-T4), so focusing it buys `Enter`, `Space`, scroll-into-view and the screen reader's
announcement for nothing. That is also why `Enter` is deliberately unbound on the deck: binding it
would mean `preventDefault`-ing it, which breaks `refresh`, `open pane` and every other control the
moment one of them holds focus. It appears on the sheet under `NATIVE_KEYS` instead.

**The `?` sheet lists the browser-owned keys; it does not remap them.** RESEARCH.md E.2 already
measured why it cannot: Keyboard Lock works only in JavaScript-initiated fullscreen, so it is
unavailable in the Edge `--app` window; `Ctrl+W` closes an installed PWA or `--app` window with no
documented suppression; nobody reclaims it in a window, and code-server remaps its own bindings out
of the way instead. E.3 says the Tauri shell is where that changes, and that is P5b. SPEC §5.3's
helper — one click writing the `Ctrl+W`/`Ctrl+T` remaps into both config directories — is a
different task with a different blast radius, and nothing in P2-T5 goes near `~/.claude*`.

**The palette lists only commands that exist.** Launch, shell, refresh, filter, shortcuts, and two
per session. Switch-project (P3), Ask (P4) and change-layout have no code behind them and are
absent; `connect` exists but as a CLI whose whole point is a dry run, a diff and a `--apply`
opt-in (P1-T11, SEC-ING-3), and a palette entry that performed that write on one keypress would
defeat every control the task put around it. A palette entry that does nothing is worse than an
absent one: the first no-op teaches you not to trust the entries beside it.

## D35 — the deck's CI gate runs the real build against a fixture core, not a mocked browser (decided 2026-09-16, P2-T7)

The deck had no automated check that it WORKS. 1290 unit tests and a coverage gate cover `core/`,
`contracts/` and `scripts/`; `app/**` is deliberately not in `coverage.include`, because the store,
the view models and the keymap are all tested without a DOM and that is what makes them testable at
all. What none of them can observe is the failure this project keeps meeting: a page that renders,
never hydrates, and passes everything (RESEARCH.md G.3, F.5.1). Six of the bugs in §G were found by
running the thing, and until now "running the thing" meant a person.

**The assertions were never the hard part.** PR #20 had already driven thirty of them through a
throwaway probe against a real core. The question was what CI starts, and there were three answers.

**Rejected: `page.route()` interception.** Fulfilling `/api/core/*` and `/api/stream` in the browser
needs no server at all, and that is precisely the objection — it fakes on the far side of every
layer that has actually broken here. `proxy.ts`'s per-request nonce, the rewrite's bearer, the
stream route's `accept-encoding: identity` and `no-transform` legs are all upstream of the point
where a route handler answers, so a smoke built this way would have caught none of G.3, G.6, G.7 or
F.6.3. It also cannot stream: `route.fulfill` delivers a complete body and closes, so the "live
feed" would arrive as one batch followed by the store's reconnect loop.

**Rejected: a fixture mode inside core.** It would put a test-only branch in the process that owns
the PTYs and writes the token — the one process where a wrong branch costs the owner a session —
and it would drag sqlite, node-pty and `claude.exe` onto a runner that has none of them.

**Decided: the real production build, served by real `next start`, against a fixture core.** The
double speaks core's HTTP surface (`/sessions`, `/session`, `/stream`, `/pty-ticket`, `/health`) and
core's PTY protocol, authenticates every route with a per-boot bearer exactly as core does, and has
an echo behind the WebSocket instead of `claude attach`. Everything in front of the wire is the real
thing. What is lost is the one thing a runner cannot have — a real Claude session painting in a real
ConPTY — and the `run` skill is still where that is checked.

Three consequences worth naming:

- **It runs in the smoke's own process, not as a child.** So there is no control channel: publishing
  a delta is a method call, and what core RECEIVED — the launch body, the bearer on each request,
  which tickets were minted — is an array the checks read directly.
- **The token file goes to a temp directory**, with `FD_TOKEN_FILE` pointing both processes at it.
  A smoke run cannot disturb a live core's token, which is the cost G.12 already paid once.
- **The runner is hand-rolled rather than `@playwright/test`.** The thing under test is one page
  driven through a sequence — `j` moves focus, `Enter` expands what `j` focused, `/` filters what
  `Enter` left open — so a runner whose unit is an isolated test would either re-navigate per
  assertion or hold the shared state it exists to prevent. It also keeps a second test runner and a
  config file that neither TypeScript project can own cleanly out of the repo. The cost is about
  forty lines of scoreboard.

**The job is advisory on the day it lands.** `main`'s ruleset has an empty bypass list (D25) and
requires four checks; a new one is not enforced until it is added to that list, which is a
repository-settings change and not a file in this PR.

## D36 — a project root is deny-listed, a config directory is allow-listed (decided 2026-09-16, P3-T1)

**Question:** D26 settled that folders are *imported by path* and that the registry ships empty.
It did not settle what core may then read inside one. `ReadPolicy` (P1-T12) had exactly one rule
set — *nothing under a config directory is readable unless it is named* — and the obvious move was
to add imported roots to the same list.

**Verdict: two rule sets, not one.** Under a config directory everything stays refused unless it
is named. Under an imported project root everything is allowed unless the deny-list takes it, and
the deny-list that survives is the half of SEC-FS-2 that is about secrets — `*.key` and
`.credentials*` — not the half that is about shape.

**Why the asymmetry is the right way round.** `~/.claude-365` is another program's private state:
its contents change with every Claude Code release, and the value of the allow-list is precisely
that a settings file the *next* release invents is unreadable until a person names it here. A
project is the owner's own repository, and what P3-T3 exists to read is `CLAUDE.md`,
`.claude/agents/*.md`, `.claude/settings.json` and `.mcp.json` — two of which are `.json` files
that SEC-FS-2's unlisted-`.json` rule would have refused. Applying the config-directory rule there
would mean naming every file a repository is allowed to contain, which is a list nobody can finish
and which would silently drop whatever a project does that this build has not seen.

**What makes that safe is the ORDER, and it is load-bearing.** A path under a config directory is
screened by the config-directory rules *first*, whatever else contains it — so a wider root cannot
loosen a narrower rule. `ProjectImport` also refuses to import a folder that is, is under, or
contains a config directory, which means the ordering is a second lock rather than the only one.
Both are asserted; `read-policy.test.ts` has the case where a project root sits above both config
directories and `control.key`, `statsig/x.json` and `.credentials.json` are still refused.

**And a project is its path, so there is no id.** BUILD-PLAN §3 sketches `Project.id`; it is
dropped. Importing the same folder twice has to be the same project, which makes the canonical path
the natural key — a second identifier derived from it could disagree with the thing it identifies,
and one derived from nothing would make a re-import a duplicate row. `projectKey` is the comparison
form, `path` is what `realpath` returned and what goes on screen, and both are stored.

**Forgetting is part of the control, not a convenience.** An allowlist that only grows makes the
first mistyped import permanent, and D26's "one deliberate act at a time" reads very differently if
the acts cannot be undone. `POST /projects/forget` withdraws a root and takes the read permission
with it, and both halves write an audit row (SEC-PROC-3). Same argument as Disconnect (SEC-OPS-2).

## D37 — Git state is a computed wire type, never a stored field, and a root has its own door (P3-T2)

BUILD-PLAN §3 sketches `stack` and `git` as fields on `Project`, beside `path`, `name` and
`worktrees`. The sketch is declined, for the reason `SessionDetail` is not `SessionRow`: those two
fields are a **reading taken a moment ago**, and the rest of the row is a **standing permission the
owner granted**. `core/ports/store.ts` already draws that line — everything in the store is an
observation of what happened, and D36 admitted the `projects` table as the single exception because
a root is a permission rather than an event. Putting a branch name on that row would make the one
table that says "which folders may core read" change every time somebody commits, and the next
reader would reasonably ask which half of it survives a restart.

So `ProjectStatus` is its own type on its own route, `GET /projects/status`, and nothing it holds is
written anywhere. The cache that keeps it cheap is in memory and dies with the process, which is the
right lifetime for a fact about now.

**The cache is `statusline.py`'s, and the shape is more specific than "cached".** A value is
recomputed when its **signature** moves *or* its **TTL** lapses, and the two do different jobs. The
signature is `mtime(.git/HEAD)/mtime(.git/index)` — two stats, microseconds — and any commit,
checkout, stage or merge moves one of them, so "nothing happened" becomes something core can prove
rather than assume. The TTL is what covers the change the signature cannot see: editing a tracked
file moves neither mtime. Four seconds for git, five minutes for the stack, which are the numbers
that file has been running with on this machine for months.

**One spawn, and the in-progress state costs none.** `git status --porcelain=v2 --branch -uno`
answers branch, divergence, dirty and conflicts together; asking `rev-parse` then `rev-list` then
`status` would pay Windows' spawn cost three times for one answer. Mid-merge, mid-rebase and
mid-bisect are read as the presence of a file in the git directory instead, which is not only free
but is what makes them worktree-safe — a linked worktree has its own `rebase-merge` under
`<main>\.git\worktrees\<name>`. `-uno` is not an optimisation either: counting untracked files
would make "dirty" mean "there are files here" rather than "there is work here".

`ProcessRunner` did not grow a `cwd` for this. `git -C <root>` is an argv element like any other, so
SEC-PROC-1's "an array, always" still covers the whole invocation, and the child is given an empty
environment — `execFile` resolves the executable through the parent's `PATH` regardless (measured),
so an empty block is a child that inherits no token and no `CLAUDE_CONFIG_DIR` and still finds git.

**And listing a root is a different question from opening a file.** `ProjectRegistry.resolve`
answers the second and refuses a directory outright — "the project directory itself is not a file" —
which is correct for what it is asked and wrong for what P3-T2 needed. `resolveRoot` is the second
door: canonicalise, then check the result is **in the registry**. Membership rather than
containment, so a root replaced by a junction since it was imported resolves somewhere that is not
a project and is refused; `ReadPolicy` was not loosened to make this work. It shipped without that
distinction, past a green unit suite and a green deck smoke, and was found by running it — the
fakes screened a root the way a subdirectory is screened (RESEARCH.md G.26).

## D38 — The user `CLAUDE.md` joins the config-directory allowlist, by name and by argument (P3-T3)

SPEC §5.1's first row is "`CLAUDE.md`, `AGENTS.md`, `.claude/soul.md`, **user `CLAUDE.md` of both
configs**". Three of those four live under a project root and were already readable — D36 made a
project root deny-listed, so everything but `*.key` and `.credentials*` is open. The fourth lives
under `~/.claude-365` and `~/.claude-isg`, where the rule is the opposite: a config directory is
**allow-listed**, and `ReadPolicy.ALLOWED_FILES` was exactly `history.jsonl`, `settings.json`,
`daemon.log` and `daemon\roster.json`. The instruction stack could not be read, and the row could
not be built.

**One named entry, which is the only shape this list takes.** `'claude.md'` joins those four. The
two wrong fixes were available and are worth naming, because both would have looked like less work:
allow-listing the config directory's **top level**, or allow-listing `*.md` **under** it. Either
would make the markdown file the next Claude Code release invents readable by default, which is the
whole thing the allow-list is for — it is what makes P1-T12's "a deny-list check runs before every
open" mean something when the program on the other side of it ships every few weeks. The narrow
entry is SEC-FS-1's own pattern and is the same trade P2-T4 made for `jobs\*\state.json`.

**What it exposes, stated rather than assumed.** A few hundred bytes of the owner's own prose,
addressed to Claude, on a machine-local page only they can reach. That is a different class of thing
from `history.jsonl` — every prompt they have typed — and from `daemon.log`, both of which are
already on this list. On this machine both files are 683 bytes and hold an `@~/.claude/CLAUDE.md`
import rather than the text itself; core never follows that import, and the instruction stack takes
only a `stat`, because the row is **byte sizes in resolution order**. Reading the contents is what
a later row would need, and this entry is what a later row would use.

**It is entered lower-case, and that is not cosmetic.** `ReadPolicy` compares against
`canonicalWindowsPath`, which lower-cases. The four existing entries happen to be written that way,
so nothing in the file said so — and the first entry with a capital letter in it was allow-listed in
the source and refused at runtime, silently. It was caught by a unit test that asked the real
`ReadPolicy` rather than a fake of it (RESEARCH.md G.27), which is G.26's lesson arriving one task
early enough to be cheap.

**The project side needed no new rule at all**, which is D36 paying off exactly as argued: a task
later, `CLAUDE.md`, `AGENTS.md`, `.claude/settings.json`, `.mcp.json`, `.claude/agents/*.md` and
`.claude/skills/*/SKILL.md` were all readable as they stood, and `.claude/settings.json` and
`.mcp.json` would both have been refused by SEC-FS-2's unlisted-`.json` rule had a project root been
allow-listed the way a config directory is.

**One route, seven readings, one cache.** The map is `GET /projects/map`, a third project route
beside the registry and the status, because the three cost different things: listing the registry
opens nothing, a status may spawn `git`, and a map is a directory listing per asset kind, a head
read per asset and two JSON parses. It is signed on `mtime(.claude)` and `mtime(.claude/settings.json)`
with `statusline.py`'s 300 s config TTL — adding, renaming or deleting an agent, a command, a skill
or a convention folder moves the directory's mtime, editing the hooks or the permissions moves the
file's, and the TTL covers the one neither can see, which is a description rewritten inside an
existing `agents/*.md`. Two stats against roughly thirty reads. Nothing it produces is stored: D37's
line holds, and a workflow map is a reading rather than an observation.

## D39 — Worktrees are read off git's own administrative files, and the port rule is a prohibition (P3-T4)

SPEC §5.1(a)'s table names `git worktree list` for this row, and it is not what P3-T4 runs. The
trees are read from `<common>\worktrees\<name>\gitdir` and `HEAD` — the files git itself reads to
answer that command — for the reason `ProjectGitReader` already gives about the in-progress state:
it is cheaper than a process, and it is what makes the answer worktree-safe, because a spawn only
ever answers about the directory it ran in. Four projects on an open panel would otherwise be four
`git` processes to learn something that changes a few times a month.

The same argument settles how a linked worktree is recognised. `lib/tree.mjs` asks git twice
(`--absolute-git-dir` against `--git-common-dir`) and calls them different a worktree. The fact is
already on disk: git puts a linked worktree's administrative directory at `<common>\worktrees\<name>`
and nowhere else, so a git directory whose parent is named `worktrees` is one, and its grandparent
is the common directory. Two string operations replacing two spawns, and the shape is the one
`GitDirectoryLocator` was already built to follow from the other end (P3-T2).

**The identity is the tree's directory name, not git's registration name.** They agree until a tree
is moved, and then `tree.mjs`'s `treeId` — the directory — is the one the owner sees in their shell
prompt and the one every hook in the reference repository keys its state by. An administrative
record nobody else reads would be a second vocabulary on screen.

**A tree core may not read is dropped rather than listed.** `git worktree list` prints a
registration whose tree is gone and calls it prunable. This does not, because the map is a
catalogue of places a session can be started (P4), and a launch target that cannot be opened is
worse than an absent row. The refusal is logged, which is the half worth knowing about: outside
every imported root is SEC-FS-1 working, and prunable is the repository's own housekeeping.

**The 4200/4201 rule is taken as a prohibition and not as a port plan.** `tree.mjs` carries both
halves — 4200 for main, 4210-4213 for the worktrees, and 4201 blacklisted because a session once
read that port's 200 as its own app being up and killed the process holding it. Flightdeck does not
serve these trees and has no business choosing ports for them, so there is nothing here to assign.
`NEVER_TOUCH_PORTS` lives in `contracts/worktree.ts`, beside the trees it is about, so SEC-PROC-5
and SPEC §9 R11 have one place to be consulted from rather than a sentence in a document to
remember.

**The trees are in `WorkflowMap` rather than on `ProjectStatus`,** which keeps D37's line: a
worktree is a place to start a session and the map is the catalogue of what a session in this
folder would be. It costs the map's signature one more stat — `mtime(<common>\worktrees)` — and
that stat is deliberately not a fallback to the common directory's own mtime, which every commit
moves and which would tie a thirty-read recompute to how often the owner commits. The consequence
is stated rather than hidden: a repository's FIRST worktree appears within the 300 s TTL, and every
one after it at once.

## D40 — the deck paints in the DOM, and the WebGL budget is deleted rather than re-measured (decided 2026-09-20, P5a-T3b)

SPEC §5.3 gives the terminal grid a *renderer budget*: focused panes get WebGL, capped at 8–10,
with a DOM fallback on context loss, justified by "Chromium allows ~16 WebGL contexts per page"
(§9 R9). Two measurements have now taken both halves of that away.

**The cap is not a cap here.** P0-T6 counted 40 contexts headless and 76 on this GPU (RESEARCH.md
F.5.2) against a nine-pane layout. Eviction order is oldest-first as documented, so the *behaviour*
the design feared is real — there is just nothing on this machine that reaches it. A budget for a
resource with an eight-fold margin is not a budget, it is three states and a focus listener.

**And the renderer it rationed works.** G.4 recorded that `addon-webgl` 0.19.0 paints nothing on
xterm 6.0.0, and that is why the deck has been on the DOM renderer since P5a-T3. It is wrong.
Measured in lit pixels, the addon paints (14 532 px against the DOM renderer's 15 168) — unless
`@xterm/xterm/css/xterm.css` is absent, and then it paints 295, which is the cursor. The deck had
no such import until P5a-T6a. **G.4 and G.5 were one bug**, five weeks apart, in two libraries,
written down as two.

So the choice is open rather than forced, and it is made on what the two renderers do to the rest
of the system:

- **The DOM renderer puts the session's text in the DOM.** `innerText` of `.pane-host` is what the
  smoke asserts, what a screen reader announces, and what a person sees — one string, three
  readers. WebGL empties `.xterm-rows` and those three come apart; keeping them together then
  means a pixel probe in CI forever, and the probe is the only thing that would have caught G.4.
- **Throughput is not the deciding number.** Nine panes, 4.5 MB: 478–536 ms on DOM, 341–469 ms on
  WebGL with a GPU, and *slower* than DOM without one. A 25 % edge on half a second of burst, for
  a tool whose panes emit a few KB a second, does not buy back the paragraph above.
- **A silent renderer is the worst failure mode this codebase has met.** The addon reports
  `renderer: 'webgl'`, creates its three canvases and draws nothing, and it did that here for five
  phases behind every green check. The DOM renderer has no equivalent state to be wrong about.

**So: the DOM renderer, and the budget is deleted, not re-measured.** `TerminalPane` loses
`enableWebgl`, `releaseWebgl`, `renderer`, `lost`, `onContextLoss` and the `@xterm/addon-webgl`
dependency with them. `app/spike/xterm/` and `scripts/xterm-spike-cli.ts` — P0-T6's budget harness
— are deleted too, on D32's precedent about `LoopbackGuard.screenFirstFrame`: a harness left
running the addon would still report `webgl` over an unpainted canvas, which is the trap, not the
measurement. Their findings are in RESEARCH.md F.5 and are not diminished by the code going away.
`PaneReport`, `visibleText()` and the `blocked` tally go in the same sweep, because the spike was
their only reader.

**What would reverse this.** A pane that cannot keep up — a `tui: fullscreen` session at 60 fps
across nine panes is the plausible case, and nothing here has produced one. Reversing it costs the
dependency back, `enableWebgl` back, and, non-negotiably, a CI check that asserts **painted
pixels** rather than `report().renderer`. SPEC §5.3's budget text and §9 R9 stand as written; this
is where they stopped describing the build.

## D41 — the keyboard helper moves what a file can move, and says so about the rest (decided 2026-09-20, P5a-T7)

SPEC §5.3 and D1 both promise a one-click helper that writes "the Ctrl+W / Ctrl+T remaps" into
both config directories. Half of that promise cannot be kept: **delete-word is not a keybindings
action in Claude Code 2.1.278**, measured against the installed binary rather than read from the
docs (RESEARCH.md G.33), so no `keybindings.json` moves Ctrl+W.

Three ways to respond, and only one of them is honest.

- **Ship the Ctrl+T half quietly.** The button works, the sheet says nothing, and the owner finds
  out about Ctrl+W by pressing it and losing the window. This is the failure mode G.4 and G.5 are
  both about — a true thing recorded in a way that stops anyone looking again.
- **Drop the task.** One reclaimable key is not worth a route, and it would be defensible if
  Ctrl+T were the only one. It is not.
- **Move what is moveable and name what is not.** Taken.

**What moves: `ctrl+t` and `ctrl+r`.** The second was not in the task's title and is the better
catch — `history:search` on Ctrl+R means that in a pane, Ctrl+R reloads the deck instead of
searching history, every time. Both go to `ctrl+x`-prefixed chords, the family Claude Code already
uses for its own, and deliberately **not** to `ctrl+k` chords even though the keybindings skill's
example uses one: the deck claims Ctrl+K away from a pane (D34), so a `ctrl+k` prefix is the one
that never arrives.

**Both halves of a move are written**, because user bindings are additive: `"ctrl+t": null` unbinds
the default and `"ctrl+x ctrl+t": "app:toggleTodos"` adds the chord. Writing only the chord leaves
the stolen key bound underneath, which is not a move.

**The helper is the third sanctioned writer into `$CFG`** (SEC-FS-3), after Connect and
Disconnect, and it is the narrowest of the three by construction rather than by care:

- **A GET computes the plan and a POST writes it**, two routes rather than one with a flag. A
  handler that cannot write cannot be talked into writing early, which is how D13's promise —
  the owner sees the diff first — is kept structurally. The deck enforces the same ordering: the
  button that writes is not rendered until a plan has been shown.
- **The POST takes nothing from the page but a direction**, from a closed union. Not a path, not
  contents, not a key. The two files are named from `SubscriptionId` the way every other config
  path in this project is.
- **It re-plans from disk at the moment of the write.** A plan computed a minute ago against a
  file the owner has since edited is exactly the write SEC-FS-3's sequence exists to refuse.
- **Removal is by value, not by key.** A binding the owner later put on `ctrl+x ctrl+t` themselves
  survives "put it back"; only our own pair comes out.
- **One refusal fails the whole plan.** The two subscriptions are one keyboard, and a Ctrl+T that
  moved on 365 and not on isg is worse than one that did not move — it is unpredictable per
  session rather than merely unchanged.

**What is deliberately not done.** A file created by the helper is left behind by "put it back",
emptied rather than deleted: deleting a file in `$CFG` is a larger blast radius than writing one,
and the emptied file is inert. And no CLI, unlike Connect: Connect runs before the deck works, and
this runs from inside the sheet somebody opened because a key did something they did not expect.

## D42 — a terminal frame's scrubber preserves LENGTH, not shape, and never reads the letters (decided 2026-09-20, P5a-T4)

**Forced by D28.** That decision moved the `claude logs` capture out of P0 and into the task that
parses it, on the argument that "a fixture captured without a consumer is captured wrong", and
deferred the scrub rule with it. This is the rule, and D28 was right to wait: every instinct carried
over from the JSON scrubber is wrong here, and only the parser says so.

**What a parser wants from a frame is length.** The JSON rules preserve SHAPE — a UUID stays a
parseable UUID, a Windows path stays a path of the same depth — because a parser reads a field by
name and `text-<8 hex>` may be any length. A terminal emulator reads by POSITION: every glyph
advances the cursor one cell, and the frame relies on autowrap, its 200-character box rules carrying
no newline and wrapping onto the next row (G.34). A placeholder one character longer reflows every
row below it, and the result still looks like a screen. So:

- escape sequences and control characters pass through **byte for byte** — 39 distinct ones carry
  the whole layout, and they are structure rather than identity;
- every ASCII letter and digit is replaced **in place**, preserving case and letter-vs-digit so a
  uuid stays uuid-shaped and `v2.1.267` stays version-shaped;
- everything else survives — spaces, punctuation, and the box-drawing and spinner glyphs Claude
  Code draws its chrome with. None of it is identity and all of it is what makes the flattened
  screen recognisable as a screen.

**The filler is keyed on POSITION and LENGTH, never on the word.** This is the one place the frame
path deliberately breaks the determinism rule the JSON scrubber follows, and it is a disclosure
decision rather than a style. `text-<sha256 prefix>` of a whole sentence is a large search space; a
per-WORD hash of a four-thousand-word screen is a substitution cipher anyone can undo with a
dictionary and one `sha256` per guess. Keying on the slot means **the output is a function of the
punctuation, the escapes and the lengths — it never reads the letters at all**, which is a property
with a test: two frames differing only in their words scrub to identical bytes. Re-scrubbing the
same capture still yields the same output, which is all `--check` needs.

**A non-ASCII letter fails the capture rather than being replaced.** Every non-ASCII character in
the captures measured so far is chrome. A letter from another script would be identity, and both
honest options are bad — leaving it is a leak, and swapping it for an ASCII one changes the cell
width of a wide glyph and reflows the screen this whole path exists to preserve. So it stops, the
way `assertNoDataKeys` stops on an unclassified key, and names the offset.

**A `.txt` with no escape sequence in it also fails.** The extension is the whole classification,
and that is only safe because the scrubber refuses anything that is not a frame. A plain text file
scrubbed by these rules would be this script guessing what a file is, which is what `DEFERRED`
exists to stop it doing quietly.

**What this costs, stated plainly.** The committed fixture is 330 046 bytes that nobody will ever
read. That is paid for with a second file: `logs-blocked.screen.txt`, the twenty-five lines the
frame flattens to, committed as a golden. A reviewer reads the golden and can see at a glance that
it is a Claude Code screen with the identity gone — the banner, a conversation, a prompt box, a
context gauge — without reading a byte of the frame. It is deliberately NOT regenerated by
`capture-fixtures.mjs`: a golden rewritten by the code it checks proves nothing.

**`DEFERRED` is now empty, and stays.** It was one entry and this pays it off. The map remains
because the rule does — the next shape nobody has a consumer for gets a line there with its task
id, not a silent skip (P0-T9).

## D43 — a preview is what a session shows when it cannot show a terminal, and it is a button (decided 2026-09-20, P5a-T4)

**SPEC §5.3 gave previews to panes a WebGL context budget had no renderer for. D40 deleted that
budget**, so on the letter of the SPEC this task had no audience left. It has a better one, and the
change makes the feature more useful rather than less.

**Who it is for now.** An INTERACTIVE session cannot be attached at all — `claude attach` takes
`--bg` sessions only, and SPEC §5.2 calls that permanent (F.2.6). For those a preview is not a
cheaper terminal, it is the *only* way to see what the session is doing, and until now the deck
answered "Interactive session — already bound to its own terminal" and stopped there. A stopped
background session is the same case for a different reason. Both sets are permanent; the WebGL one
never existed.

**Where it lives: the expanded row, not the pane grid.** The SPEC sketch put it in the grid, and
that is the one thing not carried over. A pane is a live PTY with a socket, a ticket, an
exclusivity claim and a place in a layout that must not remount (P5a-T5); a preview is a JSON
request with no lifecycle at all. Putting it in the grid would mean a second pane kind sharing none
of that machinery, and the load-bearing "every card is a direct child of one container in array
order" rule would have to hold for something that is not a card. The expanded row already has the
`SessionRef`, is already opened by a person who just clicked, and is where the sentence explaining
why there is no pane already sits. Moving it to the grid later is a task, not a refactor, and
nothing here blocks it.

**It is a button and never a timer**, and that is the measurement rather than a preference. One
preview costs a 2.7 s spawn and 330 KB (F.2.5, G.34). SPEC §5.3 says "refreshed every few seconds",
which was written before that was measured; nine panes refreshing on a 3 s timer would be three
megabytes a second and nine `claude.exe` spawns. So: nothing on expand, nothing on a timer, one
read per press, and the age shown beside it because a preview is a photograph.

**Two sources, and the deck must not confuse them.** `claude logs` gives a SCREEN — what that
session's terminal looks like. The transcript gives a TRAIL of what it did, which is what there is
when the daemon has gone, and F.2.16 measured that as permanent. They are labelled differently
("last screen" / "recent activity") because a heading that called the second one a screen would be
the deck claiming to show something nobody rendered.

**The trail shows only records the transcript parser already reads.** `tool`, `file`, `turn`,
`compaction`, `away` — no conversation text. Rendering the conversation would mean teaching
`contracts/transcript-record.ts` to read `assistant` message content, which is the largest body of
model prose in the product, for a fallback view; "what is never read cannot leak" (SEC-DATA-1) is
worth more than a prettier fallback. G.37 removed `prompt` from that list after running it.

**Flattening happens in core.** `@xterm/headless` behind a `ScreenReader` port, because SEC-UI-2
says "ANSI is rendered by xterm.js, never by hand" and that is a control rather than an
implementation detail. The frame uses six CSI finals and a reader of those six is about forty lines
(G.34) — the argument for the library is not difficulty, it is that the seventh arrives silently.
The deck receives plain text, ~1.8 KB instead of 330 KB, with nothing left in it to interpret.

## D44 — a preset names a profile function, and the function is both the model and the subscription (decided 2026-09-20, P4-T1)

**BUILD-PLAN §3 sketches `Preset` with `subscription`, `profileFn`, `model`, `agent` and `effort`.
Three of those five are dropped, and the drop is D4 being kept rather than a feature being cut.**

D4 settled that every spawn goes through `claude-365`, `claude-isg`, `claude-isg-ticket` or
`claude-isg-orch`, so that "model routing changes in one file". Those functions already pin the
model: `claude-isg-ticket` is `--model "opusplan[1m]"` plus `ANTHROPIC_DEFAULT_OPUS_MODEL` and
`ANTHROPIC_DEFAULT_SONNET_MODEL`, and `claude-isg-orch` is `--model claude-sonnet-5 --agent
orchestrator`. A preset carrying its own `--model` would be a second place model routing lives —
which is exactly the `.bashrc` drift P4-T0 finished deleting four days ago. Wanting a different
model is a new function in one file, which is what D4's "one file" means.

`subscription` goes for a stronger version of the same reason: the function IS the config
directory. `claude-365` exports `~\.claude-365` and the other three export `~\.claude-isg`, so a
`subscription` field beside `profileFn` is a value that can disagree with the command line, and
the command line is the half that wins. `subscriptionOfProfileFunction` derives it instead, and
the badge on the deck cannot be wrong.

**The consequence for P4-T3, named here so that task does not discover it.** Quota-aware routing
can only choose between `claude-365` and `claude-isg` — `ROUTABLE_PROFILE_FUNCTIONS`. The other
two are `~\.claude-isg` by construction, so "run this on whichever subscription has more headroom"
is not a question that can be asked about a ticket or an orchestrator session at all. A picker
offering the swap on those four would be offering something it cannot do.

**Four profile functions, where SPEC §5.7 says five.** `claude-isg-agents` runs `claude agents …`,
which opens the agents browser: it is a terminal UI over sessions, not a way to start one, and
there is no `--bg` form of it. SEC-PROC-2 has allowlisted four since P0 for that reason, and
SPEC's "all five" is about the ways the owner starts Claude today rather than about what a preset
can encode. The fifth is reachable from the deck as the thing it actually is — the session list.

**The plan-first prompt is COMPUTED from the ticket id, not stored.** It is lifted from
`app-next/.claude/scripts/open-tab.mjs`, which is how the owner starts a ticket today, and it names
the ticket three times — in the sentence and in the two paths it points at. Freezing one id into a
stored string would make the preset good for exactly one ticket, so `promptSource` is a two-value
union (`literal` | `ticket`) and `TicketPrompt` rebuilds the four sentences from whatever is in the
name box. That prompt is model routing rather than politeness: with `opusplan[1m]`, "enter plan
mode first" puts the planning turn on Fable 5.1 and `ExitPlanMode` returns to bypass, which is Opus
5 for the edit. It is asked for in the prompt rather than passed as `--permission-mode plan`
because that flag cannot be combined with `--dangerously-skip-permissions`, which every profile
function passes (verified 2026-09-10, recorded in open-tab.mjs beside the line that works around
it).

**What is NOT lifted from open-tab.mjs is its `.replace(/['"]/g, '')`.** That script interpolates
the prompt into a PowerShell `-Command` string, where an apostrophe ends the argument. Flightdeck
never builds a command string — the prompt is an argv element today and the `FD_PROMPT`
environment variable once P4-T2 lands (SEC-PROC-1) — so copying the strip would have carried a
workaround for a bug this design does not have, and would have quietly mangled a ticket title.

**Built-ins are computed, never seeded.** Importing a folder still writes exactly one row; the four
presets it gets are derived from the project and the profile functions on every request
(`PresetCatalogue`). That is D26's habit one layer up — the owner's database holds nothing they did
not put there — and it means a build that changes a built-in changes it everywhere rather than
leaving last month's copy behind. A saved preset SHADOWS the built-in whose id it shares, so
"I want `ticket` to start in my worktree" is one save rather than a second button called
`ticket (mine)`, and forgetting it brings the built-in back.

**A preset cannot widen what core may read.** Its `cwd` is screened on the way in by
`ProjectRegistry.resolveDirectory` — a third door beside `resolve` (may core OPEN this file) and
`resolveRoot` (is this directory an imported project), because a launch target is neither: a
worktree under `<project>\.claude\worktrees\<name>` is a good place to start a session and is not
itself imported. It is then checked for containment in the project it is filed under, so a preset
on `app-next` cannot start a session in `pdf-editor`. Verified against the live registry: a config
directory, a file, another imported project and `C:\Windows\System32` are all `bad_cwd`.

## D45 — the launcher goes through the profile, and `rm` is three acts away (decided 2026-09-20, P4-T2)

**Two decisions in one task, and they pull in opposite directions: make starting a session easier,
and make deleting one harder.**

### Starting: the profile function IS the command

D4 said model routing stays in the PowerShell profile. P2-T2's launcher did not honour it — it
spawned `claude.exe` with `CLAUDE_CONFIG_DIR` set, which reproduces `claude-365` and `claude-isg`
exactly and loses everything the other two do: `claude-isg-ticket` pins `--model "opusplan[1m]"`
plus `ANTHROPIC_DEFAULT_OPUS_MODEL` and `ANTHROPIC_DEFAULT_SONNET_MODEL`, and `claude-isg-orch`
pins a model, an agent and a name. A deck that offered four presets and ran two of them was going
to be the drift P4-T0 had just finished deleting from `~/.bashrc`, in a different file.

So the launcher runs `powershell.exe -NoLogo -NonInteractive -EncodedCommand <script>`, and
**`-NoProfile` is the flag that must never be added**: without the profile none of the four
functions exists (F.8.1). That reads backwards — the hardening flag is the one that breaks it —
which is why it has a test of its own asserting its absence.

**Four fixed scripts, one per function, and nothing is composed.** `ProfileFunction` is a closed
union, so the table is exhaustive by type; a reviewer reads four lines and can see there is no
interpolation in any of them. One template with the name substituted in would be a command string
built from a value, and the whole point is that this file has none — even when the value is safe.

**`FD_PROMPT` and `FD_NAME` are not a convenience, and F.8.2 is why.** `$env:FD_PROMPT` in
PowerShell's argument mode is a VALUE: a prompt with spaces, quotes, `$`, `;` and `|` arrives at
the child as one argv element, and a prompt that reads like flags arrives as one element too.
The same script with the prompt interpolated splits it into thirteen and **executes `$(Get-Date)`
in the owner's shell**. The difference between the two designs is not tidiness; it is whether a
prompt can run a command. That is measured, and the measurement is a test that fails when the
mechanism is removed.

**`no_claude` became `no_shell`, and `no_session_id` is new.** The first is a rename that stops a
sentence naming the wrong binary. The second is the outcome P4-T2's task note asked for: F.3.6
predicted a HANG for a launch into an untrusted folder, and F.8.3 measured that `--bg` does not
hang there — it starts in 1.6 s. What is left is the general case, and folding it into
`launch_failed` is the one reading that is actively unhelpful: a process that exited 0 may well
have started a session, so "it failed" is how the owner ends up with two.

**A name is required now** (SPEC §5.7, D7's `unnamed`), except for `claude-isg-orch`, which passes
`-n orchestrator` itself — asking for a second name would be asking for one that is thrown away.

### Deleting: three deliberate acts, and never beside `stop`

`rm` deletes `jobs/<shortId>/` and the conversation with it, with no confirmation from the CLI and
nothing that brings it back (F.2.8). It is the only thing Flightdeck does that destroys something,
so the design question is not "where does the button go" but "how many ways are there to press it
by accident".

- **It is not in `.row-actions`.** `stop` lives there and never moves. The roadmap task says in as
  many words that `rm` must not arrive behind a button that looks like `stop`.
- **It is inside the EXPANDED row**, under the detail and the preview. Reaching it takes three
  deliberate acts: expand, `delete…`, then a button labelled `delete <name>`. None of the three is
  where a hand lands by habit.
- **It is not a palette entry**, and that is the one exception on `DeckActions`. Every other verb
  is reachable by typing its name into Ctrl+K; a fuzzy list where `Stop fd-t1` and `Delete fd-t1`
  sit one row apart is exactly the place to press the wrong one.
- **The armed warning names what is lost, and the two sentences differ**: a live session is ended
  as well as deleted. A confirm that said the same thing about both is a confirm nobody reads
  twice.
- **Its own route, `POST /sessions/rm`.** `RequestRouter` matches literally, so a body field
  choosing between "stop" and "delete" would be one typo from the wrong one. Its own failure union
  too, although the three codes read alike: a shared one would make it a line's work to point the
  stop button at the destructive route.

**The confirm is the deck's, not the use case's.** `SessionRemover` asks nothing — a use case that
prompted would be one nothing could call twice, and what it owes instead is the audit row.
SEC-PROC-3 exists for exactly this verb: `daemon.log` cannot tell a deletion from a session that
ended on its own (F.2.3), so the row is the only record that it was Flightdeck that did it.

## D46 — headroom is the fuller window, and the recommendation is a default rather than a write (decided 2026-09-21, P4-T3)

SPEC §5.2 has said since rev 1 that the subscription picker is quota-aware, "the one with more
headroom pre-selected, override allowed". Two of those words carried a decision nobody had made.

**"More headroom" had to mean something, and the obvious meaning is wrong.** There are two windows
per account, not one. An account at 5h 10 % / 7d 95 % draws an almost empty five-hour bar — which
is the bar the owner actually watches, because it is the one that moves — and has five points of
room before it stops accepting work for the rest of the week. A rule that read the five-hour gauge
would recommend that account confidently, every time, and the owner would find out at the moment a
session stopped. So headroom is **100 minus the fuller of the two windows**, the binding constraint
is what decides, and `boundWindow` travels out with the answer so the advice names the window it
was derived from. Without that the sentence contradicts the gauge beside it and reads as a bug.

**Three different ways to decline, because they are three different sentences.** A gap under
`ROUTING_MARGIN_POINTS` is a `tie` — a `quota` frame arrives on every statusLine render, so
recommending a swap on a one-point difference would move the pre-selection under the owner's
cursor every few seconds. An account that has never reported makes the pair `incomparable`: no
reading is not 100 % free, and the account nothing has run on all day is also the one whose 7-day
window nobody has looked at. And `claude-isg-ticket` / `claude-isg-orch` are `not_routable`, which
is D44's consequence arriving exactly where it was predicted to (`ROUTABLE_PROFILE_FUNCTIONS`) —
a picker offering a swap on those would be offering something it cannot do.

**Staleness qualifies the advice; it never withdraws it.** Dropping an old reading would blank the
recommendation on an idle machine, which is precisely where the first session of the day gets
started. The age goes out with the number, as it already does in the header.

**The half that is not a rule: the recommendation is a DEFAULT, not a write.** This is the part
that would have been a bug in any implementation reached for by reflex. The natural shape is an
effect that pushes the recommendation into the select when the quota changes — and the quota
changes every few seconds, so that effect re-picks forever: the owner chooses an account, keeps
typing their prompt, a frame lands, and the launch goes somewhere else. There is no effect. The
override is a `useState` that starts `undefined`, the rendered value is
`picked ?? recommended ?? claude-365`, and the first deliberate change wins permanently. "Override
allowed" is not a mode the form enters; it is what a `useState` already is.

**One rule, two screens.** `recommendRouting` is pure and in `contracts/` for the reason
`summariseQuota` is: `flightdeck-core status` prints a `start on` line from it too, and a CLI that
compared the accounts its own way would be two screens recommending different ones — which is worse
than neither recommending anything. `chosen` is optional precisely so the CLI can ask the question
honestly, with nothing selected, instead of inventing a selection to get an answer.
