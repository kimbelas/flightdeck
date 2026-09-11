# Flightdeck — research log

Every fact the spec relies on, with how it was verified and when. **Verified** = run or read on
this machine today. **Documented** = official Claude Code docs (URL given). **Observed** = seen in
internal files whose format is not documented and may change. Re-run the checks in §A–§C after any
Claude Code update; the version at the time of writing is **2.1.267**.

Machine: Windows 11 Home 10.0.26200 · verified **2026-09-10**.

---

## A. Machine inventory (verified)

| Item | Finding |
|---|---|
| Claude Code binary | `%APPDATA%\npm\node_modules\@anthropic-ai\claude-code\bin\claude.exe`, **2.1.267**, a 220 MB native (Bun-compiled) executable. `%APPDATA%\npm\claude.cmd` is the shim the PowerShell profile calls. `package.json` says `engines.node >= 22`, irrelevant for the native build. |
| Config dirs | `~\.claude-365` and `~\.claude-isg` are live (both have `sessions/`, `projects/`, `daemon/`, `settings.json`). `~\.claude` is legacy: `hooks/`, `CLAUDE.md`, empty `sessions/`. |
| Shell routing — PowerShell | `Microsoft.PowerShell_profile.ps1`: `claude-365`, `claude-isg`, `claude-isg-agents`, `claude-isg-ticket` (opusplan[1m] + `ANTHROPIC_DEFAULT_OPUS_MODEL=claude-fable-5-1`, `ANTHROPIC_DEFAULT_SONNET_MODEL=claude-opus-5`), `claude-isg-orch` (sonnet-5, `--agent orchestrator -n orchestrator`). `claude` is a stub. |
| Shell routing — bash | `~\.bashrc` has a **second, diverging** set: `claude-365` pins `--model claude-fable-5` (PowerShell relies on `settings.json` = `claude-fable-5-1[1m]`), plus `claude-365-1m`, `claude-isg-1m`, `claude-isg-bg`, and an interactive launcher menu on every new shell. **Two sources of truth already disagree** — see DECISIONS D4. |
| Node | fnm: 16.20.2, **20.19.5**, **26.3.0 (default)**. ABI: Node 20 → 115, Node 26 → 147. npm 11.6.4, pnpm 10.29.3, Python 3.12.5. |
| Native toolchain | `C:\Program Files\Microsoft Visual Studio\2022\BuildTools` exists but has **no `VC\Tools\MSVC`** (no `cl.exe`). Anything that needs node-gyp will fail here → prebuilt binaries are mandatory, not preferred. |
| Browsers / terminal | Edge (`msedge.exe`) and Chrome present. Windows Terminal **1.24.11911.0** at `C:\Program Files\WindowsApps\Microsoft.WindowsTerminal_1.24.11911.0_x64__8wekyb3d8bbwe` (AppX; the `wt.exe` on PATH is an execution alias Node cannot spawn — `open-tab.mjs` fix stands). |
| Claude desktop app | AppX package **`Claude 1.30096.5.0` is installed**. Relevant to the desktop-vs-web question (DECISIONS D1). |
| Ports | 4200 in use (app-core serve). 4747, 4848, 4949, 4950 free. `lib/tree.mjs` in app-next blacklists 4201 (sibling-app) — Flightdeck must never probe or kill it either. |
| `node:sqlite` | Node 26's built-in SQLite **has FTS5** (`CREATE VIRTUAL TABLE … USING fts5` succeeded in-memory). No `better-sqlite3`, no native build needed for §5.8 search. |

### A.1 node-pty spike (build-order step 0) — PASSED

Scratchpad install of `node-pty` **1.1.0** under Node 26: `added 2 packages in 6s`, no compiler
invoked. The package depends on `node-addon-api ^7.1.0` (N-API → ABI-independent) and ships
`prebuilds/win32-x64/{pty.node, conpty.node, conpty_console_list.node, winpty-agent.exe,
winpty.dll, conpty/}`. Functional test (spawn `powershell.exe -NoProfile` in ConPTY, write a
command, read the marker back, `resize(120,40)`, confirm the new size, `exit`):

| Runtime | ABI | Result |
|---|---|---|
| Node 26.3.0 | 147 | exit 0, marker seen, resize seen |
| Node 20.19.5 | 115 | exit 0, marker seen, resize seen |

**Consequence:** rev 2's "sidecar must run on Node 20" (R1) is withdrawn. Everything runs on the
default Node 26. The sidecar still exists, for other reasons (SPEC §4.3).

---

## B. Claude Code session surface (verified on the 2.1.267 binary)

### B.1 `claude --help` — flags that matter here

| Flag / command | Verified text (abridged) |
|---|---|
| `--bg, --background` | "Start the session in the background and return immediately. Prints the id that `claude attach`, `logs`, `stop` and `rm` take; `claude agents` lists them. With `--resume <session-id>`, continues that session in the background under the same ID, or starts a copy and says so when the session is already running." |
| `agents` | "Manage background agents". `--json` "Print active sessions (interactive and background) as a JSON array and exit (for scripting; does not require a TTY)". `--all` adds completed background sessions. `--cwd <path>` filters. Dispatch defaults: `--model`, `--effort`, `--agent`, `--permission-mode`, `--add-dir`, `--mcp-config`, `--plugin-dir`, `--settings`, `--restricted`. |
| `attach <id>` | "Open the background session in this terminal. ← returns to agent view, Ctrl+Z drops back to your shell. The session keeps running either way." |
| `logs <id>` | "Print the background session's recent terminal output." **Needs the daemon alive** — on a finished session with no daemon running: `Couldn't read logs for a41e908d — connect ENOENT \\.\pipe\cc-daemon-*-control`. |
| `stop\|kill <id>` | "Stop a background session. Its conversation is kept; resume it later with `claude attach <id>`." |
| `rm <id>` | "Delete a background session and its worktree. Unlike `stop`, works on already-exited sessions." `--discard-unpushed <commit>@<worktree-id>` guard. |
| `respawn <id>\|--all` | "Restart a background session (or all of them) so it picks up the current Claude binary." |
| `-n, --name <name>` | "Set a display name for this session (shown in the prompt box, /resume picker, and terminal title)". |
| `-r/--resume`, `--fork-session`, `--session-id <uuid>`, `-c/--continue` | all present. |
| `-p/--print` + `--output-format text\|json\|stream-json`, `--include-partial-messages`, `--include-hook-events`, `--json-schema`, `--max-budget-usd`, `--input-format stream-json`, `--replay-user-messages`, `--no-session-persistence` | all present. |
| `--permission-mode` | choices: `acceptEdits, auto, bypassPermissions, manual, dontAsk, plan`. |
| `--effort` | `low, medium, high, xhigh, max`. |
| `--autocompact <auto\|tokens>` | 100k–1M. |
| `-w/--worktree [name]`, `--tmux` | worktree-per-session; tmux is Unix-only in practice. |
| `--cloud`, `--remote-control [name]`, `--teleport` | cloud / phone paths — out of scope. |
| `--bare`, `--restricted`, `--safe-mode` | useful for a "safe headless" preset. |
| `doctor`, `update\|upgrade`, `install [target]` | present. `claude tasks` is **not** a command (falls through to top-level help). |
| Also present | `auto-mode`, `gateway`, `import`, `mcp`, `plugin`, `project`, `setup-token`, `ultrareview`. |

### B.2 `claude agents --json`

- **Cost:** 763 ms wall for `.claude-365` (3 sessions). Two config dirs ≈ 1.5 s per sweep. Confirms the "every ~10 s reconciler, never the 1 s poll" rule.
- **Interactive session shape** (verified, both dirs identical):
  `{"pid","cwd","kind":"interactive","startedAt","sessionId","name","status":"busy"|"idle"}`
- **Background session shape** (verified via `--all`, a finished one):
  `{"id":"a41e908d","cwd","kind":"background","startedAt","sessionId","name":"Adding fields to form","state":"done"}` — note **`id` (short) and `state`, no `pid`, no `status`**.
- Documented extra fields for live background sessions: `state ∈ working|blocked|done|failed|stopped`, `status ∈ busy|waiting|idle`, `waitingFor` (docs: agent-view). `waitingFor` and `blocked` = "waiting on user" — the attention signal for free. `waitingFor` confirmed present in the binary.
- `--cwd C:\…\app-next` returned only the two app-next sessions. Works.
- Registry files (`$CFG/sessions/<pid>.json`) are richer than the listing (`version`, `procStart`, `statusUpdatedAt`, `entrypoint`, `nameSource: user|derived`, `agent`, `peerProtocol: 1`, `peerFeatures: ["notify_idle","artifact_yield"]`, `messagingSocketPath`), plus a sibling `<pid>.<sha256>.key` file (110 bytes) per session — an auth key for the messaging pipe. **Never read, log or serve the `.key` files.**

### B.3 The daemon (observed in `$CFG/daemon/` and `daemon.log`)

Background sessions are children of a **transient supervisor** ("daemon"), one per config dir:

- `daemon/roster.json` `{proto:1, supervisorPid, updatedAt, workers:{}}`, `pipe.key`, `control.key`, `attach-journal/`, `dispatch/`, `pty-pids/`. Control socket `\\.\pipe\cc-daemon-*-control`.
- `daemon.log` shows the lifecycle: `daemon start … origin=transient` → `bg spawned <id> (slash)` and a pre-warmed `(spare)` worker → **`bg retire a41e908d: idle-prompt, idle 32m [low memory]`** → `bg settled (done)` → **`idle 5s with no clients — exiting`**. Another: `bg retire bf93f016: empty-idle, idle 61m`.
- **Consequence for the spec:** "sessions survive everything" needs nuance. A `--bg` session that sits idle is *retired by the daemon* (observed at 32 min under memory pressure, 61 min when empty). Its conversation is kept and `attach`/`--resume` bring it back, so **work is never lost, but "running" is not "forever"**. Flightdeck must treat `done` as a normal resting state, not an error, and offer one-click resume.
- Job state lives in `$CFG/jobs/<shortId>/state.json` (observed shape: `state, detail, tempo, template:"bg", respawnFlags:[…], bgIsolation, providerEnv:{CLAUDE_CONFIG_DIR}, interactiveLineage, intent (first prompt), name, nameSource:"auto", sessionId, resumeSessionId, daemonShort, cwd, createdAt, updatedAt, backend:"daemon"`) plus `jobs/pins.json`. `providerEnv.CLAUDE_CONFIG_DIR` is how the daemon pins the subscription for respawn.
- Documented daemon commands: `claude daemon status`, `claude daemon stop --any` (strings confirmed in binary; not shown in top-level `--help`).

### B.4 Strings confirmed in the 2.1.267 binary (features the docs describe)

`allowedEnvVars` (http hook), `refreshInterval` + `hideVimModeIndicator` (statusLine), hook events
`StopFailure`, `PostCompact`, `PreModelSwitch`, `SubagentStart`, statusLine fields
`context_window_size`, `spend_limit`, listing field `waitingFor`, the attach-exclusivity message
`Can't open`, `daemon status`, `cleanupPeriodDays`, `keybindings.json`, hook type `mcp_tool`.

Notification types (the `Notification` hook matcher values) as they appear in the binary:
**`permission_prompt`, `idle_prompt`, `auth_success`, `elicitation_dialog`, `agent_needs_input`,
`agent_completed`, `elicitation_url_dialog`, `worker_…`**. `idle_prompt` is "waiting for your
input"; `agent_completed` is a background agent finishing — the two events SPEC §5.5 wants.

"FleetView" (20 hits: `mountFleetView`, `FleetViewScreen`, `createFleetViewHost`,
`useAttachFleetOwners`, `touchFleetViewHeartbeat`) is the **internal name of `claude agents`'
agent view**. Not a separate product; not in the docs under that name.

---

## C. Transcript record shapes (observed — internal format, best-effort only)

Docs (`sessions.md`) say the JSONL is internal and changes between versions. Everything here is
therefore an **enrichment** source behind the documented hooks/statusLine feeds, never the source
of truth. Fixture-test every shape below.

Sizes: `.claude-365/projects` = 647 MB over 18 slugs, largest file **50.9 MB**; `.claude-isg` =
509 MB / 18 slugs, largest 29 MB. Slug = full path with `:` and `\` → `-`
(`C--Users-dev-Documents-development-app-next`). Default retention `cleanupPeriodDays` = 30.

| Record | Shape / use |
|---|---|
| `assistant` | top-level `uuid, parentUuid, timestamp, sessionId, cwd, gitBranch, version, effort, requestId, isSidechain`; `message.{id, model, role, content[], stop_reason, stop_details, usage, context_management, diagnostics}`. `message.model` is the **per-turn model** (e.g. `claude-opus-5`). `content[].type == tool_use` → name + input = "doing right now". |
| `user` | `cwd, gitBranch, isMeta, isSidechain, message, timestamp, uuid, version`. |
| **`cost-state`** | `totalCostUSD, totalAPIDuration, totalToolDuration, totalLinesAdded, totalLinesRemoved, totalDuration, startTime, modelUsage:{<model>:{inputTokens, outputTokens, thinkingTokens, cacheReadInputTokens, cacheCreationInputTokens, webSearchRequests, costUSD}}, hasUnknownModelCost`. **Claude Code already computes cost per model — do not recompute from token rates.** Example: one session, `claude-opus-5[1m]`, 30.2 M cache-read tokens, `costUSD 31.16`. |
| `ai-title` / `custom-title` / `agent-name` | card title; user-set title; `--agent` name. |
| `last-prompt` | `lastPrompt` (truncated), `leafUuid` — card subtitle. |
| `permission-mode`, `mode` | `bypassPermissions` etc. / `normal`. |
| `file-history-snapshot`, `file-history-delta` | `trackingPath`, `backup.realParentDir` — files touched. |
| `queue-operation` | enqueued `<task-notification>` payloads (subagent completions) — an operation log. |
| `system` subtypes | `turn_duration {durationMs, messageCount}` (2 051 hits in `.claude-isg`), `stop_hook_summary {hookInfos[{command,durationMs}], hookErrors}` (1 680), **`away_summary {content}`** — a natural-language recap of what happened while you were away (537) — ideal card text, `local_command`, `informational`, `scheduled_task_fire {taskId, cron, prompt, taskKind}` (loops/crons), `compact_boundary {compactMetadata:{trigger, preTokens, postTokens, cumulativeDroppedTokens, durationMs}}`, `model_consent_fallback`, `agents_killed`. Records also carry `slug` (e.g. `dazzling-snacking-squid`). |
| `attachment` | tool results, `total_tokens_reminder`, skill listings — skip for live view. |
| `history.jsonl` (per config dir) | `{display, pastedContents, timestamp, project, sessionId}` — cheapest "last prompt per session, with project path". |
| `stats-cache.json` | `version 5`, `dailyActivity[{date, messageCount, sessionCount, toolCallCount}]`; `lastComputedDate` 2026-08-31 / 2026-09-01 — computed lazily, **not** a live source. Undocumented. |

---

## D. Official documentation (claude-code-guide research, 2026-09-10)

Base: `https://code.claude.com/docs/en/`. Pages: `agent-view`, `hooks`, `hooks-guide`,
`statusline`, `keybindings`, `sessions`, `headless`, `settings`, `env-vars`, `model-config`,
`monitoring-usage`, `desktop`, `remote-control`, `cross-session-messaging`, `terminal-config`.

### D.1 Background sessions (`agent-view.md`, `sessions.md`)

- `--bg` **requires an initial prompt** (positional). Follow-up input reaches a background session via agent view "peek & reply", `claude attach <id>`, or cross-session messaging.
- **Only one terminal can be attached at a time**: `Can't open — this session is running in another terminal`. → A Flightdeck pane and a Windows Terminal pop-out are mutually exclusive; detach first.
- `claude rm` removes from the list; the transcript is preserved.
- `claude daemon status` / `claude daemon stop --any` manage the supervisor. No documented cap on session count.
- Transcripts at `$CFG/projects/<slug>/<sessionId>.jsonl`; `sessions/` holds the registry.

### D.2 Hooks (`hooks.md`)

- **Events:** `SessionStart`, `SessionEnd`, `UserPromptSubmit`, `Stop`, `StopFailure`, `PreToolUse`, `PostToolUse`, `Notification`, `PreCompact`, `PostCompact`, `SubagentStart`, `SubagentStop`, `PreModelSwitch`, `PostModelSwitch`, `Setup`.
- **Handler types:** `command` (`command, args, timeout, async, shell`), **`http`** (`url, headers, allowedEnvVars, timeout`), `mcp_tool`, `prompt`, `agent`.
- **`async: true`** on command hooks runs them without blocking the session (app-next already uses it on `fast-lint.mjs`).
- **Common stdin/body fields:** `session_id, prompt_id, transcript_path, cwd, scratchpad_dir, permission_mode, effort.level, hook_event_name`, plus per-event fields (`tool_name`, `tool_input`, notification type…).
- Hooks in **user-level `settings.json` apply to every project under that `CLAUDE_CONFIG_DIR`** — one block per subscription covers everything.
- Exit codes: 0 ok, 2 block, other = non-blocking error. Matchers are regex on tool name / notification type.

### D.3 statusLine (`statusline.md`)

Full stdin JSON (fields Flightdeck cares about): `session_id, session_name, prompt_id,
transcript_path, cwd, version, model.{id, display_name}, workspace.{current_dir, project_dir,
added_dirs, git_worktree, repo.{host, owner, name}}, cost.{total_cost_usd, total_duration_ms,
total_api_duration_ms, total_lines_added, total_lines_removed}, context_window.{total_input_tokens,
total_output_tokens, context_window_size, used_percentage, remaining_percentage, current_usage.*},
exceeds_200k_tokens, prompt_cache.{warm, hit_ratio, expires_at, …}, fast_mode, effort.level,
thinking.enabled, rate_limits.{five_hour, seven_day, spend_limit}.{used_percentage, resets_at},
agent.name, pr.{number, url, review_state}, worktree.{name, path, branch, original_cwd,
original_branch}`.

- Runs on: new assistant message, `/compact` finish, permission-mode change, vim toggle, **`refreshInterval` (min 1 s)**, a rate-limit `resets_at`, cache `expires_at`. **Debounced 300 ms**; an in-flight script is cancelled by a newer trigger.
- `rate_limits` present only for Claude.ai Pro/Max accounts (both subscriptions qualify). `resets_at` = Unix seconds.
- Config: `statusLine.{type:"command", command, padding, refreshInterval, hideVimModeIndicator}`.
- The existing `~/.claude/hooks/statusline.py` already reads `model`, `effort`, `session_name`, `agent`, `context_window.used_percentage`, `rate_limits.*`, `prompt_cache.*`, `cost.*`, `pr.*`, `fast_mode`, and caches git state per repo in `%TEMP%\cc-statusline-<hash>.json`.

### D.4 keybindings (`keybindings.md`)

`~/.claude/keybindings.json` (per config dir under `CLAUDE_CONFIG_DIR`); `/keybindings` creates
it. Contexts: `Global, Chat, Autocomplete, Confirmation, Tabs, Transcript, HistorySearch, Task,
…`. Chords (`ctrl+k ctrl+s`, 3 s window). **`ctrl+w` can be rebound** (or set to `null`).
Reserved, cannot rebind: Ctrl+C, Ctrl+D, Ctrl+M, Ctrl+[, Ctrl+I, Ctrl+H. Defaults of note:
`app:toggleTodos` = Ctrl+T (a browser-stolen key), `task:background` = Ctrl+B, `chat:stash` =
Ctrl+S, `history:search` = Ctrl+R.

### D.5 Desktop app, Remote Control, messaging

- **Desktop app (`desktop.md`) runs parallel sessions, per signed-in account. Desktop sessions are separate from CLI sessions.** One account at a time → it cannot show two subscriptions, does not see the CLI sessions launched from the profile functions, and has no project workflow map. It is prior art, not a replacement (DECISIONS D1).
- Remote Control connects a phone/browser to **one** local session. No multi-session view.
- `ListAgents`/`SendMessage` (`cross-session-messaging.md`) are scoped to one `CLAUDE_CONFIG_DIR`. Confirms rev 2 §2.8.

### D.6 Context windows and models (`model-config.md`; pricing from the Claude API reference, cached 2026-06-24)

- Default window 200 000; `[1m]` suffix = 1 000 000. statusLine reports the actual `context_window_size` — **use that field, never infer from the model name.**
- Cost is authoritative from `cost-state` / statusLine `cost.total_cost_usd`. Rates below are for sanity checks and for `hasUnknownModelCost: true` only:

| Model id | Context | Input $/MTok | Output $/MTok |
|---|---|---|---|
| `claude-fable-5-1` | 1M | 10.00 | 50.00 |
| `claude-opus-5` | 1M | 5.00 | 25.00 |
| `claude-sonnet-5` | 1M | 2.00 | 10.00 |
| `claude-haiku-4-5` | 200K | 1.00 | 5.00 |

### D.7 OpenTelemetry (`monitoring-usage.md`)

`CLAUDE_CODE_ENABLE_TELEMETRY=1` + `OTEL_METRICS_EXPORTER=otlp`, `OTEL_LOGS_EXPORTER=otlp`,
`OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_PROTOCOL=grpc|http/json|http/protobuf`.
Metrics: `claude_code.session.count`, `cost_usage`, `token_usage`, `active_time`, lines of code,
commits, PRs. Events: `user_prompt`, tool results, API request/error, permission decisions, auth.
Attributes: `session.id`, `user.id`, `organization.id`. **Viable third feed for analytics** (an
OTLP/http-json receiver is ~100 lines) but hooks + statusLine already carry what v1 needs;
deferred to Phase 7.

### D.8 Also documented

`cleanupPeriodDays` (default 30) deletes old transcripts — Flightdeck's own index (Phase 7) is the
only way to keep history longer without raising it. `claude project purge`. `/tasks` lists
in-session background tasks. Headless `stream-json` emits `system/init`, `assistant`, `user`,
`stream_event` (with `--include-partial-messages`) and a final `result` with `usage`, cost,
`session_id`, `structured_output`.

---

## E. Third-party stack (web research, 2026-09-10)

Two research passes (npm, GitHub, MDN, Chrome/Edge/Microsoft docs). Where the researcher could
not pin a primary source it is marked *unverified*; confirm those at install time.

### E.1 xterm.js

- **`@xterm/xterm` 6.0.0**; `addon-fit` 0.11.0; `addon-webgl` 0.19.0; `addon-serialize` 0.14.0;
  `addon-unicode11` 0.9.0; `addon-clipboard` still `0.2.0-beta.x`; `addon-search` and
  `addon-web-links` current numbers *unverified* (npm pages blocked the fetch). **`addon-canvas`
  is deprecated and not updated for v6** (cockpit-project#22509, addon-webgl README) — WebGL with a
  DOM-renderer fallback only.
- **Chromium caps WebGL at ~16 contexts per page** (8 on mobile); the oldest is evicted with
  "Too many active WebGL contexts" (issues.chromium.org 40939743, 40543269). No plan to raise it.
  This is the number behind the renderer budget in SPEC §5.3.
- `WebglAddon.onContextLoss` fires on `webglcontextlost`; documented pattern: dispose the addon
  and fall back to the DOM renderer.
- `attachCustomKeyEventHandler` can `preventDefault()` any key **the page receives**. Chromium
  never delivers **Ctrl+W, Ctrl+T, Ctrl+N, Ctrl+Shift+N, Ctrl+Tab / Ctrl+Shift+Tab** to page JS in
  a normal tab (Microsoft Q&A on Edge Ctrl+W; microsoft/vscode#150735). Ctrl+Shift+W behaves
  like Ctrl+W (*not separately confirmed*).

### E.2 Browser keyboard capture

- **Keyboard Lock (`navigator.keyboard.lock()`) works only in JavaScript-initiated fullscreen**
  (developer.chrome.com keyboard-lock docs; MDN Keyboard API). Not usable in a windowed PWA or an
  Edge `--app=` window. Chrome and Edge both support it; Esc held ~3 s always exits.
- Chrome had proposed a permission prompt for Keyboard/Pointer Lock (Chrome 131) and **decided
  not to ship it** (March 2026 follow-up post) — no extra dialog, fullscreen is the only gate.
- **Installed PWA / `--app` window: Ctrl+W still closes the window** (microsoft/vscode#150735;
  Chrome community threads). No documented suppression outside fullscreen + Keyboard Lock.
- VS Code for the Web documents Ctrl+N/Ctrl+W as browser-reserved; code-server (#2586, #112)
  detects standalone mode and **remaps** conflicting bindings. Nobody reclaims Ctrl+W in a window.

### E.3 Desktop shells

- **Tauri 2.10.1** stable, released **2026-03-04** (v2.tauri.app/release/core). Windows renders
  in **WebView2**. **No blanket "disable browser accelerators" setting** in Tauri/wry
  (tauri-apps/wry#569 "some default platform shortcuts are disabled, some are not";
  tauri-apps/tauri#7418 open feature request) → the page still handles `keydown` +
  `preventDefault()`. The material difference: with no tabs or window chrome, Ctrl+W/T/N have no
  default action to fight for most combos. **Phase 5b's first task is to confirm Ctrl+W reaches
  the page in the Tauri window**; a lead to check is WebView2's `AreBrowserAcceleratorKeysEnabled`
  exposed through wry's Windows builder extension (*unverified*).
- First-party v2 plugins: `global-shortcut` (needs Rust ≥ 1.77.2), tray icon (core), `notification`
  (native Windows toasts). **Rust toolchain required** for dev builds.
- Installer ≈ **5–10 MB** using the evergreen WebView2 already on Windows 11; ≈ **180 MB** if a
  fixed WebView2 runtime is bundled.
- **Electron** is at **43.x** (mid-2026, tracks Chromium ~M147), installers **~120 MB+**
  (bundled Chromium + Node per app).

### E.4 Windows integration

- **Windows Terminal CLI**: `https://learn.microsoft.com/en-us/windows/terminal/command-line-arguments`.
  Confirmed: `-w 0` (most recently used window), `nt`/`new-tab`, `--title`, `-d`/`--startingDirectory`,
  `-p`/`--profile`. Example `wt -w 0 nt --title "X" -p "PowerShell" -d C:\path`.
- **Toasts from Node**: `node-notifier` 10.0.1 is ~5 years unmaintained (wraps SnoreToast);
  **`toasted-notifier` 10.1.0** is the maintained fork (Windows XP–11, same SnoreToast mechanism);
  `node-powertoast` exists; PowerShell `BurntToast` needs a shell-out. → `toasted-notifier` until
  Tauri's notification plugin (Phase 5b).

### E.5 File watching on Windows

- Node `fs.watch` uses `ReadDirectoryChangesW`; documented dropped events under bursty writes
  (libuv#626), inconsistent recursive events on junctions (nodejs/node#53903, #47058); a Jan 2026
  fix (nodejs/node PR #61433) reduced coalescing misses. Recursive watch **is** supported on
  Windows but lossy in practice.
- `fs.watchFile` (stat polling, default 5007 ms) is independent of those semantics but CPU-costlier.
- **chokidar 5.0.0** (2025-11-25) after 4.0.3; v4+ dropped globs, uses `fs.watch` natively on
  Windows (no polling by default).
- **Recommendation adopted (SPEC §4.2 feed 5, R6/R7):** watcher = nudge only; truth = `fs.stat`
  every ~2 s against the stored byte offset; `size < offset` → truncation, reset; read the delta
  with `createReadStream({start})`; buffer a partial trailing line until the next chunk.

### E.6 SQLite in Node

- **`node:sqlite`**: flag-free since 22.13; **Stability 1.2 – Release Candidate** since 25.7
  (nodejs.org/api/sqlite.html, fetched for v26.8.2). Extension loading API exists
  (`allowExtension`, `loadExtension`).
- The researcher found FTS5 **absent** from Node's bundled SQLite as of **Node 23.11**
  (nodejs/node#56951, SQLite 3.49.1 without `ENABLE_FTS5`). **Superseded by the local test in §A:
  `USING fts5` succeeded on Node 26.3.0.** Newer Node ships FTS5; re-run the one-liner in
  `scripts/doctor.mjs` after every Node upgrade.
- Fallback: **`better-sqlite3` 13.x** — N-API since 13.0.0, Windows prebuilds, FTS5 compiled in.

### E.7 Next.js 16

- Stable **16.3.4** (2026-08-31); Turbopack is the default for dev and build; Node ≥ 20.9. Coach
  and groundwork are on 16.2.10.
- **SSE from route handlers works with care**: return a `ReadableStream` immediately and push into
  it; `export const dynamic = 'force-dynamic'`; HMR in `next dev` can tear down an open stream
  (nextjs.org/docs/app/guides/streaming; vercel/next.js discussion #48427).
- **Route handlers cannot upgrade to WebSocket** (open RFC vercel/next.js#95514; #58698). Options:
  custom `server.js`, or a separate process. **Custom servers have no official Turbopack support**
  (vercel/next.js#65479). → Flightdeck's separate `core` process (D2) is the right call; the UI
  stays a stock Next app.
- `next dev` re-evaluates edited server modules → watchers, PTYs, DB handles must live outside
  Next (or behind a `globalThis` guard). Standard practice; not spelled out in an official doc.

### E.8 Localhost security

- A malicious page **can** send a no-preflight simple `POST` to `127.0.0.1:4949` and **can** open a
  WebSocket to `127.0.0.1:4950`; the browser only blocks reading the cross-origin response. The
  server must check `Origin` itself.
- **Chrome 142 (2025-10-28) shipped Local Network Access**: a permission prompt when a public page
  reaches private/loopback/`.local` addresses; requires the requesting page to be HTTPS
  (developer.chrome.com/blog/local-network-access). **Edge/Firefox/Safari equivalents
  *unverified*** — assume no protection there.
- **DNS rebinding remains live**: a domain that re-resolves to 127.0.0.1 after page load makes
  loopback look same-origin unless `Host` is validated.
- **CVE-2025-49596** — `@modelcontextprotocol/inspector` < 0.14.1, CVSS 9.4: unauthenticated
  proxy, exploitable via DNS rebinding **even when bound to 127.0.0.1**, RCE on the developer's
  machine; fixed 2025-06-13 with **session tokens + Origin validation + DNS-rebinding protection**
  (Oligo Security write-up). Same shape as Flightdeck; same fix set (SPEC §7, D10).
- **`Sec-Fetch-Site`** is browser-set and unspoofable (all major browsers incl. Safari ≥ 2023);
  rejecting anything but `same-origin`/`none` on state-changing routes is strong CSRF protection —
  as one layer, not the only one (it does not cover the WebSocket handshake or a non-browser
  client).

---

## F. Spike results (measured on this machine)

Each entry is a measurement, not a reading of the docs. Where a measurement contradicts §D, the
measurement wins and the contradiction is called out.

### F.1 `http` hooks and receiver-down UX — P0-T3 (2026-09-10, Claude Code 2.1.267)

**Setup.** `SessionStart` + `Stop` `http` handlers pointed at `http://127.0.0.1:4950/hooks` in
`~/.claude-isg/settings.json` only, with a bearer token in the `headers` field. Receiver:
`scripts/hook-spike.ts`. Removed again at the end of the spike; `.claude-365` never modified.

**F.1.1 `http` handlers are never invoked for `SessionStart`.** This is the important finding and
it contradicts the assumption behind D3 feed 1.

- `Stop` over `http` fires reliably, for both headless `-p` runs and `--bg` sessions.
- `SessionStart` over `http` produced **no request at all** — not a rejected one. Confirmed by
  instrumenting the receiver to log rejections (401/415/421/413) as well as successes: with
  logging on, zero requests arrived while a `command` handler on the *same* `SessionStart` entry
  fired normally. Adding `"matcher": "startup"` changed nothing.
- So the event fires; the `http` transport does not carry it. **`SessionStart` must be collected
  by a `command` handler**, or inferred from the reconciler (D3 feed 3) and `fs.watch` (feed 5).
- Not yet probed for the same defect: `SessionEnd`, `UserPromptSubmit`, `Notification`,
  `PreCompact`/`PostCompact`, `SubagentStart`/`SubagentStop`. **Assume nothing** — P1-T5 must
  verify each event it depends on over the transport it will actually use.

**F.1.2 Observed payloads.** Scrubbed into `fixtures/hooks/`. Fields beyond the §D.2 list:
`stop_hook_active`, `last_assistant_message`, `background_tasks`, `session_crons` on `Stop`;
`source` on `SessionStart`. Shapes differ by session kind:

| Field | headless `-p` | `--bg` |
|---|---|---|
| `session_id`, `transcript_path`, `cwd`, `hook_event_name` | yes | yes |
| `scratchpad_dir` | no | yes |
| `model`, `session_title` (`SessionStart`) | no | **yes** |
| `prompt_id`, `permission_mode` (`Stop`) | yes | yes |

`session_title` is the `-n` name — so a `--bg` `SessionStart` carries the session's name, which
`Stop` does not. `Stop` carries `last_assistant_message`, i.e. **model-generated text arrives in a
hook payload** and is subject to SEC-UI-2 and the body limit.

**F.1.3 Transport.** `axios/1.15.2`, `Content-Type: application/json`, `Connection: keep-alive`,
`Accept-Encoding: gzip, compress, deflate, br`, and **no `Origin` header**. That confirms the
SEC-HTTP-2 carve-out: hook POSTs cannot be origin-checked and must authenticate by token. The
`headers` field does deliver `Authorization` verbatim.

**F.1.4 Ack latency** (receiver acks before writing to disk):

| Request | Ack |
|---|---|
| first after boot | 5.37 ms / 8.21 ms |
| steady state | 0.54–1.31 ms |

The SEC-ING-2 budget of 5 ms holds in steady state but **not for the first request**, which pays
Node's HTTP warm-up. P1-T5 should warm the path at start rather than treat 5 ms as a hard SLO.

**F.1.5 Receiver down — the UX.** Nothing listening on 4950; loopback refuses immediately, so no
request waits out the 5 s timeout.

- **Headless `-p`: completely silent.** Wall time 4997/6077 ms against a 4956/5648 ms baseline —
  inside the noise. `exit=0`, `is_error: false`, `api_error_status: null`, no hook-related field
  in the JSON result, nothing on stderr. A dead receiver is *invisible* here.
- **Interactive / `--bg`: a persistent visible banner** in the TUI status area reading
  `Stop hook error occurred · ctrl+o to see`. Non-blocking — the turn completes normally and the
  session stays usable — but it is in front of the owner for every turn.

**Consequences.**

1. Hooks are safe to install permanently *only* with an always-on receiver, otherwise every
   interactive session wears an error banner. This is the measured evidence for **D21/DP2** (core
   as a logon task) — the decision was made on the D2 argument and this confirms it.
2. Because the headless failure is silent, `scripts/doctor` (SEC-OPS-1) cannot infer receiver
   health from session behaviour; it must probe the port itself.
3. `Connect` (P1-T11) must not install hooks unless core is installed and running, and
   `Disconnect` is the documented fix when the banner appears (SECURITY.md §5.3).

### F.2 `--bg` end to end — P0-T4 (2026-09-10, Claude Code 2.1.267)

**Setup.** Six `fd-spike-*` background sessions in `.claude-isg`, `--model haiku`, cwd a temp
scratch directory. the owner's three interactive sessions (TICKET-1898, orchestrator, docs-tool-f7) and
the pre-existing background session `a41e908d` were listed but never stopped, removed or respawned
(SEC-PROC-5). Harness: `scripts/bg-spike.ts` (`PtyProbe`, `ClaudeVerb`) and `bg-spike-cli.ts`.

**F.2.1 The listing has three shapes, not two.** This corrects §B.2, which described the retired
shape as "the background shape" because it was captured from a finished session via `--all`.

| Shape | Keys |
|---|---|
| interactive | `pid, cwd, kind, startedAt, sessionId, name, status` (7) |
| background, live | `pid, id, cwd, kind, startedAt, sessionId, name, status, state` (9) |
| background, not live | `id, cwd, kind, startedAt, sessionId, name, state` (7) — **no `pid`, no `status`** |

- A live background record is a *superset* of the interactive one. **The presence of `pid` is the
  liveness test**; `pid` and `status` are optional on a background record in the P1-T3 schema.
- `status` was also missing on a session ~3 s old that already had `pid` and `state: working`, so
  `status` is optional even when the session *is* live. Nothing may key off it alone.
- The short id is the first segment of the session uuid, confirmed on all eight sessions observed.
  No lookup table is needed — but see F.2.13, the scrubber had to be taught to preserve this.
- **`waitingFor` never appeared**, on any record, in any state, including a genuinely blocked one.
  §B.2 found the string in the binary and the docs describe it; it is not in this output.
  **The attention signal is `state === 'blocked'`**, which pairs with `status: idle`, not `busy`.

**F.2.2 `--all` is not optional.** A stopped or retired session disappears from the plain listing
entirely. A reconciler that calls `agents --json` without `--all` reads "stopped" as "gone".

**F.2.3 A stopped session and a retired one are indistinguishable except in the log.**
`claude stop <id>` prints `stopped <id>` and takes 1.44 s. Afterwards the record reads
**`state: done`** — not `stopped` — and `jobs/<id>/state.json` says `done` as well. The documented
`stopped` state was never observed. Only `daemon.log` separates the causes:

```
bg settled <id> (killed)          ← claude stop
bg settled <id> (done)            ← finished on its own
bg retire <id>: idle-prompt, …    ← daemon retirement
```

So D7's state machine cannot recover *why* a session ended from the listing. Flightdeck's own
audit row (SEC-PROC-3) is the source of truth for actions it took; `daemon.log` for everything else.

**F.2.4 `jobs/<shortId>/state.json` carries the attention text.** Richer than §B.3 recorded — it
adds `inFlight{tasks,queued,kinds,drainableMonitors}`, `tokens`, `output.result`, `children`,
`linkScanOffset`, `linkScanPath`, `cliVersion`, `firstTerminalAt`, `lastTerminalAt`, and, **only
while blocked, `needs`**: a model-written sentence saying what the session wants, e.g.
"navigate to a git repository or initialize one with git init".

This answers "what needs me?" without opening a transcript. `needs`, `detail` and `output.result`
are **model-generated and therefore untrusted** (SEC-UI-2); `intent` is the user's first prompt.

**F.2.5 `claude logs` returns a terminal frame, not text.** One short session produced **330 046
bytes, 4 724 lines and 10 483 escape sequences (39 distinct)**, including 24-bit colour, in 543 ms.
It replays repeated full-screen redraws, so a naive tail is garbage — a preview has to run the
stream through an emulator (P5a-T4 already plans xterm.js; SEC-UI-2 requires it). Never poll it.

**F.2.6 `attach` inside node-pty works — and is last-one-wins.** This contradicts §D.1 and §B.4.

- node-pty 1.1.0 with the prebuilt `win32-x64` ConPTY binaries, no compiler, `import` resolved
  under Node 26 type stripping. First byte 108–185 ms; 4.7 KB for an idle session, 26–53 KB while
  the session streams output.
- The documented refusal "Can't open — this session is running in another terminal" **never
  appeared**. The second attach succeeds and the **first is evicted**, exiting cleanly with code 0
  about 2.4 s later. Measured twice — idle session: second attached at 3.00 s, holder exited at
  5.11 s; busy session: 3.00 s / 5.41 s.
- **Consequence for P5a-T1 and SEC-WS-3:** attach exclusivity is entirely Flightdeck's job. The CLI
  will not refuse a second attach, so a Windows Terminal pop-out (P6-T2) silently steals the pane.
  A pane must treat "my PTY exited 0 without me asking" as *evicted*, not as *session ended*.
- **Killing the attach does not stop the session.** All sessions kept their pids across a killed
  attach — the P5a gate ("closing a pane never stops a session") holds at the CLI level.
- **node-pty keeps the Node event loop alive after `kill()`.** The process never exits on its own;
  the PTY host must dispose explicitly (CODING-STANDARDS §7, `Disposable`). The hung process also
  never flushed its piped stdout, so the failure first looked like "no output at all".

**F.2.7 `--resume` forks a copy unless called in exactly one way.**

| Command | Result |
|---|---|
| `--bg --resume <shortId> "<prompt>"` | **copy** under a new id; name lost, auto-named from the prompt |
| `--bg --resume <full-uuid> -n <name> "<prompt>"` | **copy** — *any* extra flag forks it |
| `--bg --resume <full-uuid>` (nothing else) | **wakes the session under its own id**, restoring saved options |

The last prints "woke session 78a31323 with its saved options (-n, --model, --permission-mode)"
and comes back with a new pid, `state: done`, `status: idle`, "idle — send a prompt to start".
Saved options come from `state.json.respawnFlags`. **P4-T2 and P6-T6 must resume with the full
lowercase session uuid and no other argument**, then send the prompt separately.

**F.2.8 `rm` deletes a live session without asking.** `claude rm <live-id>` printed `removed <id>`
with no confirmation and no refusal, and deleted `jobs/<id>/`. It is the most destructive verb
Flightdeck will expose and needs its own confirmation step and audit row (SEC-PROC-3).

Exit codes are inconsistent: `rm` and `stop` on a missing id exit **1**, but `logs` exits **0**
while printing "No job matching". Parse the output; do not trust the status alone.

**F.2.9 Timings** (this machine, warm unless stated):

| Verb | Wall |
|---|---|
| `--bg` first of the day (daemon cold start) | 5.4 s |
| `--bg` warm | 1.3–2.0 s |
| `stop` | 1.44 s |
| `rm` | 1.11–1.14 s |
| `logs` | 0.54 s |
| `attach` to first byte (in ConPTY) | 108–185 ms |

**F.2.10 The daemon roster holds live secrets — SEC-FS-1 needs narrowing.** `daemon/roster.json`
carries, per worker, **`rvAuth` and `ptyAuth`** (32 hex characters each — the auth for the
rendezvous and PTY pipes), and `dispatch.launch.args` / `dispatch.respawnFlags` containing the
**full prompt text**. SEC-FS-1 currently allowlists `daemon/roster.json` for reading while SEC-FS-2
forbids `daemon/*.key`; these two fields are equivalent to the key files but live inline in an
allowlisted file. **SEC-FS-1 should be narrowed to named fields**
(`workers.<id>.{pid,sessionId,cwd,startedAt,cliVersion}`) and SEC-FS-2 should name `rvAuth`,
`ptyAuth` and `dispatch` as never-read, never-logged. Also: roster `pid` disagreed with the listing
`pid` for the same session (3324 vs 33680) — trust `agents --json`.

**F.2.11 The statusline already carries the whole deck header.** Captured from an attached pane:

```
ctx ██░░░░░░░░ 21% │ 5h 16% 3h17m │ 7d 6% │ cache 79% 59m │ $0.02
```

Context %, both quota windows with the 5h reset countdown, cache age and spend — every number
P2-T3 wants is already computed by `statusline.py`, which is what P0-T5 will make POST.

**F.2.12 `-n` names.** `nameSource: "user"` when `-n` is passed, `"auto"` when derived from the
prompt (a resumed copy was auto-named from its prompt text). A `--bg` session started without `-n`
is listed unnamed until the daemon derives one.

**F.2.13 The scrubber had to be taught three shapes** (`scripts/capture-fixtures.mjs`). It was
flattening ISO-8601 instants, CLI flag *names* and the short id into `text-…`, which made the
fixtures unable to test the things they were captured for — `respawnFlags` scrubbed to
`["-n","fd-spike-c","--model","haiku","text-280ea966","default"]`, and `id`/`sessionId` no longer
agreed because the short id survived the length rule while the uuid did not. Timestamps now scrub
to a different but parseable instant, flag names are treated as the closed vocabulary SEC-PROC-2
already allowlists, and the short id is re-derived from the scrubbed uuid. Flag *values*, prompts
and free text are unaffected; `--check` confirms the four committed hook fixtures do not change.

**F.2.14 `jobs/<shortId>/timeline.jsonl` — a state history nobody had noticed.** Not in §B.3. One
JSON object per state transition, oldest first:

```
{"at":"…","state":"working","detail":"Showing the last 5 commits in the current directory","text":""}
{"at":"…","state":"blocked","detail":"not a git repository; git log failed","text":"The command failed…"}
```

`detail` is the one-line summary that also appears in `state.json`; `text` is the **full assistant
message** that caused the transition (empty on entry to `working`). So the deck gets a per-session
state history *and* the away recap (P2-T4) from a small append-only file, without tailing a
transcript at all — cheaper than P1-T7 and already summarised. `detail` and `text` are
model-generated (SEC-UI-2), and `text` is unbounded, so it needs the same size limit as a hook body.

**F.2.15 Idle retirement fires at 60 minutes since last activity — but the number in the log
line is the session's age, not its idle time.** Four `fd-spike-*` sessions retired while the
spike was running, joining two earlier sightings:

```
[2026-09-10T20:33:48.846Z] [bg] bg retire cc89da0a: settled, idle 60m      fd-spike-a
[2026-09-10T20:34:48.901Z] [bg] bg retire 53c3b34f: settled, idle 60m      fd-spike-b
[2026-09-10T20:34:48.927Z] [bg] bg retire 57218c6e: idle-prompt, idle 60m  fd-spike-c (blocked)
[2026-09-10T20:42:48.914Z] [bg] bg retire 6b113e49: settled, idle 70m      fd-spike-idle
[2026-09-04T11:42:04.317Z] [bg] bg retire a41e908d: idle-prompt, idle 32m [low memory]
[2026-09-10T11:35:46.511Z] [bg] bg retire bf93f016: empty-idle, idle 61m
```

- **The three that were never touched after spawn retired 60 m 27 s, 60 m 49 s and 60 m 47 s after
  their own spawn, and all three printed `60m`.** `fd-spike-idle` was spawned *first*, at
  19:32:48, and retired last, at 20:42:48 — exactly 70 m later, printing `70m`. It is also the one
  session the F.2.6 attach probes kept touching, for about ten minutes after it started. The
  reading that fits all four: **the trigger is 60 minutes since last activity, while the printed
  number is age since session start.** Where a session is never touched the two coincide, which
  is why they looked like the same number until one session broke the tie. Treat `idle <n>m` as
  an upper bound on idleness, not a measurement of it.
- **Three reasons, and they are the session's state, not three thresholds.** `settled` = finished
  its work; `idle-prompt` = retired while `state: 'blocked'`, i.e. *waiting for the owner*;
  `empty-idle` = never ran a turn. The deck should treat a session that retires as `idle-prompt`
  as an abandoned request for attention, not as a completed one.
- **`[low memory]` cuts the timer to ~32 min.** The hour is a ceiling, not a promise, so nothing
  may assume a session survives one (P1-T4's gone-detection, P4-T2's resume).
- **Retirement is two log lines ~1.1 s apart**: `bg retire <id>: <reason>, idle <n>m` then
  `bg settled <id> (done)`. The reason only exists in the first one — `agents --json` shows
  `state: 'done'` either way (F.2.3), so the log is the only place the *why* lives.
- Live confirmation of F.2.1: immediately after retiring, `fd-spike-c` was still listed, with
  `state: 'blocked'` intact and **no `pid`**. Presence of `pid` is the liveness test.

**F.2.16 `stop`, `rm` and `logs` are dead without the daemon, and nothing brings it back but
`--bg`.** Found while removing the spike sessions. Once the supervisor idle-exits, every verb that
needs the control pipe fails and keeps failing:

```
claude rm 57218c6e    -> couldn't remove 57218c6e — the background service may be restarting. Try again in a moment.
claude stop 57218c6e  -> couldn't confirm 57218c6e was stopped — the background service may be restarting. Try again in a moment.
claude logs 57218c6e  -> Couldn't read logs for 57218c6e — connect ENOENT \\.\pipe\cc-daemon-*-control
```

- The advice in the message is wrong: it never resolves on its own. Six retries over four
  minutes all failed. `daemon/roster.json` still named `supervisorPid: 23140`, a process that no
  longer existed, and `daemon.log` had already recorded
  `another daemon is already running (pid=23140 …); an on-demand daemon never displaces a running one`.
- **`logs` is the honest one** — its ENOENT names the missing pipe. `rm` and `stop` report a
  transient-sounding failure for a permanent condition.
- **Only `--bg` starts a daemon.** Spawning one throwaway background session brought the pipe
  back and the same `rm` succeeded immediately; the throwaway then stopped and removed cleanly.
- Consequences: `agents --json` keeps working throughout (it reads `jobs/` off disk), so the deck
  can show a session it cannot act on. P4-T2 must distinguish "the verb refused" from "the
  daemon is not there" — probing the control pipe, not parsing the sentence — and offer the
  one repair that works. P7-T4's daemon visibility should surface a roster whose `supervisorPid`
  is dead, which is the signature of this state.
- Unrelated but worth recording: Claude Code auto-updated from **2.1.267 to 2.1.268** during the
  session. Every fixture in this repo carries the version it was captured under, and all of them
  say 2.1.267.

### F.3 statusline.py POST — P0-T5 (2026-09-10, Claude Code 2.1.267, Python 3.12.5)

**Setup.** `~/.claude/hooks/statusline.py` is copied into a scratch directory and patched there;
neither config dir and neither the real script nor the real token file is touched. Both copies run
with `LOCALAPPDATA` and `TEMP` pointed at that directory, so the block reads a scratch token.
Harness: `scripts/statusline-block.py` (the block itself), `scripts/statusline-patch.ts`
(`StatuslinePatcher`), `scripts/statusline-spike.ts` (`StatuslineReceiver`, `RenderProbe`),
`scripts/statusline-cost.py`, `scripts/statusline-spike-cli.ts`.

**F.3.1 The transport is chosen by python import cost, not by network cost.** Marginal cost of the
import, measured on top of statusline.py's own import set (min of 7, warm):

| Module | Marginal import |
|---|---|
| `socket` | **11 ms** |
| `http.client` | 70–81 ms |
| `urllib.request` | 67–74 ms |

The status line is a fresh `python.exe` on **every render**, so an import is paid every time, and
`urllib.request` alone would cost half the 150 ms budget before a byte moves. The block therefore
hand-builds the request over a raw `socket` — nine lines, one fixed request shape. (`_socket`, the
C extension, is 3.9 ms, but it is a private CPython API and 7 ms is not worth that.)

**F.3.2 The import is deferred behind the token read, which makes "not connected" free.** The
block reads `%LOCALAPPDATA%\flightdeck\token` first and returns before importing anything if it is
absent. A machine with Flightdeck disconnected pays **0.10 ms** per render — one failed `open()`.

**F.3.3 A closed loopback port is not refused to Python here — it is dropped.** This is the
finding that changed the design, and it contradicts the "refused connection under 5 ms"
expectation the task was written with. Connecting to a closed `127.0.0.1` port:

| Client | Result |
|---|---|
| Node `net.connect` | `ECONNREFUSED` in **1.4 ms** |
| Python, `settimeout(0.15)` | `TimeoutError` after the full **155 ms** |
| Python, blocking | `ConnectionRefusedError` after **2020 ms** |

Not port-specific — 4949, 4950, 4951, 53791, 1 and 65000 all behave the same, and `::1` matches
`127.0.0.1`. Node and Python differ on the same port at the same moment, so this is Python's
`select()`-based connect on Windows not seeing the failure, not the TCP stack. **Mitigation: the
connect timeout is separated from the read timeout** — 25 ms to connect (a live core answers in
~1 ms, so 25× headroom), 150 ms to read (SEC-ING-3). That turns a dead core from 161 ms per render
into 51 ms.

**F.3.4 Measured cost of the block, per render.** A statusline process serves exactly one render,
so the number that matters is the *first* call in a process — it pays the deferred import. Steady
state is shown only to separate import cost from network cost. 5 processes × 11 calls:

| Core state | First call (what a render pays) | Steady | Render |
|---|---|---|---|
| disconnected (no token file) | **0.10 ms** | 0.05 ms | byte-identical |
| connected (core acks) | **21–26 ms** | 1.7 ms | byte-identical |
| refused (token present, core down) | **51 ms** | 31 ms | byte-identical |
| hung (core never answers) | **172–183 ms** | 157 ms | byte-identical |

Receiver-side ack was **0.29 ms** median over 58 posts, well inside the 5 ms of SEC-ING-2.

- **Byte-identical render in all four states**, including while the connection is hanging. The
  comparison is three interleaved plain/posting pairs per state; a mismatch is retried before it
  is believed, because `until()` renders a countdown at minute granularity and a run that
  straddles a minute boundary produces two different-but-correct renders.
- The healthy path costs ~10 % of the 160–330 ms the python spawn itself takes. Timing that
  through the spawn is hopeless — the spawn's own variance is an order of magnitude larger than
  the effect — which is why `statusline-cost.py` times `fd_post` in process instead.
- **Consequence for P1-T6:** core should *delete* the token file on clean shutdown, not just stop
  listening. That moves the ordinary "core is not running" case from the 51 ms path to the 0.10 ms
  path, and it is one line in the shutdown handler. A crashed core still leaves a stale token, so
  a self-owned circuit breaker (skip posting for N seconds after a failure) stays on the table if
  crashes turn out to be common.
- The hung case is bounded by the 150 ms read timeout and nothing else, so SEC-ING-2's "ack in
  under 5 ms and process asynchronously" is what keeps it theoretical.

**F.3.5 A real statusLine payload, and the trap in it.** Captured by pointing `--settings` at a
capture script — **no write into either config dir** — inside a ConPTY, because statusLine does
not run in headless `-p` at all (a `-p` run with the capture wrapper installed produced nothing).
Two shapes, in `fixtures/statusline/`:

- **`fresh.json`** — before the first turn. `context_window.used_percentage`,
  `remaining_percentage` and `current_usage` are present and **`null`**, not absent and not `0`.
  `session_name`, `prompt_id` and the whole `prompt_cache` block are **absent**. A schema that
  models "no value" as a missing key rejects a real payload; one that coerces `null` to `0` paints
  a 0 % context bar on every new session.
- **`warm.json`** — after one turn. `prompt_cache` arrives with far more than §D.3 lists:
  `warm, caching_observed, ttl, expires_at, requests, misses, expected_rebuilds, hit_ratio,
  cache_write_tokens, miss_recache_tokens, last_miss_at, last_miss_cause, miss_causes,
  recache_tokens_if_cold`. `session_name` is auto-derived from the prompt when `-n` was not
  passed (matches F.2.12).
- Both carry `rate_limits.{five_hour,seven_day}.{used_percentage,resets_at}` — the entire deck
  header (P2-T3) — with `resets_at` in Unix **seconds**.
- Three fields §D.3 does not list: `scratchpad_dir`, `output_style.name`, `thinking.enabled`.
- `spend_limit`, `agent`, `pr`, `worktree` and `effort` did not appear on either capture, so they
  are conditional and nothing may require them.

**F.3.6 An interactive session in an untrusted folder blocks on a modal, forever.** Starting
`claude` in a directory the config dir has not trusted renders "Quick safety check: is this a
project you created or one you trust?" and waits. `--dangerously-skip-permissions` does not
bypass it, and Ctrl+C twice does not dismiss it — the probe was still on the dialog at 18 s with
`exitedOnItsOwn: false`. P4-T2 must treat "launched but never produced a session id" as a
distinct, reportable outcome, or a launch into a fresh worktree will look like a hang.

**F.3.7 The patcher refuses rather than guesses.** Two marker-delimited regions at two unique
anchors (`def main():`, and the `cache_flush()` at the end of main); `remove(apply(x)) === x` is
asserted on LF and CRLF (`tests/scripts/statusline-patch.test.ts`). statusline.py is CRLF on this
machine and the block in the repo is LF, so the patcher detects the ending and rejoins with it —
without that it matched zero anchors. If an anchor is missing or ambiguous, Connect refuses and
says which; it never falls back to appending.

### F.4 Cross-origin and loopback security probe — P0-T7 (2026-09-11, Chromium 153, Node 26.3)

**Setup.** A core-shaped server on 4950 screened by `LoopbackGuard`, the deck's origin on 4949
(with the same-origin rewrite Next will provide), a hostile origin on 5999, and two clients:
Chromium via Playwright, and a raw Node client. Everything binds `127.0.0.1`; nothing leaves the
machine. Harness: `scripts/loopback-guard.ts`, `scripts/security-probe.ts`,
`scripts/page-origin.ts`, `scripts/security-probe-browser.ts`,
`scripts/security-probe-client.ts`, `scripts/security-probe-cli.ts`.

**F.4.1 Which client can prove what — decided before writing the probe, not after.** A Node client
sets `Origin` and `Sec-Fetch-Site` to whatever it is told, so a Node "pass" on those controls means
nothing. A browser will not let a page lie about where it came from. Conversely, forging `Host` is
not cheating: a DNS-rebinding attack produces exactly a `Host` the browser copied from a name that
re-resolved to `127.0.0.1`, so sending it directly is the same request the victim would send.

| Control | Verdict | Proven by | Note |
|---|---|---|---|
| SEC-NET-1 | **proven** | Node | `<lan-ip>:4950` never answers |
| SEC-HTTP-1 | **proven** (rebinding **simulated**) | Node | forged `Host` → 421 |
| SEC-HTTP-2 | **proven** | Chromium | hostile `Origin` → 403 |
| SEC-HTTP-3 | **proven** | Node | absent and same-length-wrong token → 401 |
| SEC-HTTP-4 | **proven** | both | non-JSON → 415; oversize → 413; preflight unanswered |
| SEC-HTTP-5 | **proven** | Node | `cross-site` and `same-site` → 403 |
| SEC-WS-1 | **proven** | both | bad origin refused at upgrade; bad/absent first frame → 1008 |

Rebinding is marked **simulated** deliberately. Proving it end to end needs a DNS name that
re-resolves after load, which is not available offline; the forged `Host` is the faithful shape of
the request but not the full attack. A green tick there would have been a lie.

**F.4.2 The deck's own origin is blocked too — the Next rewrite is load-bearing.** The most useful
result, and not the one the task was looking for. A page served from `http://127.0.0.1:4949`
cannot `fetch` `http://127.0.0.1:4950` directly: **a port is part of an origin**, so deck → core is
cross-origin. JSON triggers a preflight core never answers; a simple request arrives carrying
`Sec-Fetch-Site: same-site` and is refused by SEC-HTTP-5. Only the **same-origin rewrite** — the
deck's own server forwarding to core, with the token attached server-side — returned 200.

So SEC-HTTP-5's "browser HTTP reaches core through a same-origin Next rewrite" is not a
convenience, it is the only route that works, and P2-T1 cannot quietly drop the rewrite and call
core directly. It also means **the token never has to enter the browser at all** for HTTP.

**F.4.3 Content-Type is what catches the request that skips the preflight.** A cross-origin
`text/plain` POST is a CORS *simple request*: no preflight, so **it really does land on core** —
the server log shows the POST arriving from `http://127.0.0.1:5999`. What refuses it is
SEC-HTTP-4, not SEC-HTTP-2. `mode: 'no-cors'` is the same story and the page gets an opaque
response. The browser is not the thing stopping a hostile page from *delivering* a POST; it only
stops it from *reading the answer*. If core ever accepted `text/plain` on a mutating route, a
hostile tab could fire it blind.

The preflight itself arrives as `OPTIONS` with **no `Content-Type` at all** and is refused 415, so
core never implements `OPTIONS` and never grows a CORS header. That is the whole mechanism.

**F.4.4 A WebSocket handshake is not CORS-protected, and that is why the token is in the first
frame.** The browser sent the upgrade happily, carrying its real `Origin`. From the hostile origin
the server refused at the handshake. **From the deck's own origin the upgrade was accepted** — as
it must be — and the only thing then standing between a script on that page and a live PTY is the
token in the first frame. Three first-frame cases all behave: wrong token → close 1008, silence →
close 1008 after 2 s, correct token → accepted. Combined with F.4.2, the token stays server-side
and an injected script on the deck page has nothing to send, which is the property SEC-WS-3 needs.

**F.4.5 Minor: an oversize body is refused by destroying the socket, so the client sees
`ECONNRESET`, not 413.** The server records 413 correctly, but the caller gets a transport error.
Acceptable for an attacker; bad for a legitimate hook that just sent too much, which would retry
blind. P1-T10 should decide whether to drain-and-answer instead of destroying (SEC-HTTP-4).

**F.4.6 SEC-NET-1 holds, and this machine drops rather than refuses.** Connecting to the LAN
address `<lan-ip>:4950` produced no answer at all within 2 s, rather than a refusal — the same
behaviour F.3.3 found on closed loopback ports. Not reachable either way, but `doctor` (SEC-OPS-1)
must treat a *timeout* as "not listening", not as "unknown", or it will report a false alarm.

**F.4.7 One screen, two callers.** The checks had been written twice already (`hook-spike.ts`,
`statusline-spike.ts`), each the subset its own spike needed. They are now one class,
`LoopbackGuard`, which the probe and the statusline receiver share; every rejection carries the
control id, which is what makes the report above possible at all. `hook-spike.ts` is deliberately
left alone: it cannot be re-run without installing hooks into a config dir, and changing code that
cannot be exercised, purely for tidiness, trades a real risk for a cosmetic gain. P1-T10 promotes
`LoopbackGuard` to middleware; 25 unit tests in `tests/scripts/loopback-guard.test.ts` pin one
decision per control id so a regression lands in `npm run check`, not in a spike nobody reran.

### F.5 xterm.js 6 inside Next — P0-T6 (2026-09-11, Next 16.3.4, Chromium 153, xterm 6.0.0)

**Setup.** A real Next app at the repo root (`app/`, `next.config.ts`, `middleware.ts`) with the
`/spike/xterm` route mounting panes through `PaneGrid`, driven in Chromium by
`scripts/xterm-spike-cli.ts` over `globalThis.fdSpike`. Versions resolved exactly as §E.1
predicted: `@xterm/xterm` 6.0.0, `addon-fit` 0.11.0, `addon-webgl` 0.19.0 — those three marks come
off *unverified*.

**F.5.1 A strict CSP and Next hydration are in direct conflict, and the failure is silent.** This
cost the most time and is the finding that matters beyond this task.

- `script-src 'self'` with no nonce **blocks Next's own inline hydration scripts**. The page
  still renders — it is server-rendered HTML — so it looks correct and simply does nothing. The
  only evidence is six CSP console lines and a **minified React #412**.
- The fix is a per-request nonce issued from `middleware.ts`. `'strict-dynamic'` has to go with
  it: Next's nonced bootstrap loads further chunks at runtime and those are refused by the nonce
  alone. `'strict-dynamic'` then disables host allowlisting, so `'self'` stops covering them —
  the two are a package, not independent choices.
- **A nonce cannot be stamped onto statically prerendered HTML**, because that HTML was generated
  at build time. Any route under a nonce CSP must render per request. Worse, `export const
  dynamic` is a *route-segment* export and is **ignored on a `'use client'` module**, so the
  harness had to be split into a server `page.tsx` and a client `xterm-harness.tsx` for one line
  to have any effect.
- `next build` also **rewrites the tsconfig it is pointed at** — adding `jsx`, `allowJs` and
  `.next` types. Unpinned, that was the *root* config, the one `core/` is checked by. It is now
  pinned to `tsconfig.app.json` (`typescript.tsconfigPath`), which is what keeps the DOM lib out
  of `core/`.

**Consequence for P2-T1:** the deck cannot be statically exported, and SEC-UI-1's policy is not a
constant — it is a function of the request. `contracts/content-security-policy.ts` holds it, with
seven tests, because every failure mode here is silent in one direction or the other.

**F.5.2 Chromium's WebGL context cap is nowhere near 16 on this machine.** §E.1 cites ~16 per page
from the Chromium tracker. Measured, by mounting panes until contexts start disappearing:

| Renderer | Panes mounted | Peak live WebGL | Evicted |
|---|---|---|---|
| Headless (SwiftShader) | 44 | **40** | 4 |
| Headed (real GPU) | 76 | **76** | 4 |

**Eviction order is confirmed in both**: the panes that lost a context were ids `0, 1, 2, 3` —
oldest first, exactly as §E.1 says. So the *behaviour* the design depends on holds; the *number*
does not. SPEC §5.3's renderer budget of 8–10 live WebGL panes is therefore safe by a wide margin,
but the "~16 contexts" reason given for it is wrong on this hardware and should not be cited as
the constraint. The real constraint is F.5.3.

Caveat, stated rather than buried: this is one machine, one driver, one Chromium build, and the
deck runs in Edge. A layout of 9 panes (SPEC §5.3) is an order of magnitude below either number,
which is why this is recorded as "the budget is not the binding constraint" rather than as a new
limit to design against.

**F.5.3 `WebglAddon.onContextLoss` fires three seconds late — by design, in the addon.** The
documented pattern in §E.1 ("dispose the addon and fall back to the DOM renderer") works, but not
when you would expect. From `@xterm/addon-webgl` 0.19.0's own source:

```js
"webglcontextlost", e => { console.warn("webglcontextlost event received"); … setTimeout(() => this._onContextLoss.fire(e), 3e3) }
```

Measured end to end: **3036 ms** from dropping the context to the pane reporting the DOM renderer.
The canvas gets `webglcontextlost` immediately and `gl.isContextLost()` is true at once — it is
only the addon's event that waits. So a pane whose context is evicted shows a **dead terminal for
three seconds** before the fallback repaints it. Text survives intact across the switch.

**This is the real P5a-T3 constraint**, not the context count: either accept a 3 s blank pane, or
listen to `webglcontextlost` on the canvas directly and pre-empt the addon. Also, the addon only
notices at all when it next tries to draw — a pane nobody writes to keeps reporting `webgl`
indefinitely after its context is gone, so the renderer state is not trustworthy on idle panes.

**F.5.4 The things that simply worked.** `fit()` resized correctly once the host had a real box —
172 cols at one pane per row, 26 at six, so the addon measures the host element and nothing else.
Alt-screen switched on `ESC[?1049h` (`buffer.active.type` → `alternate`). `attachCustomKeyEventHandler`
attaches and receives events. Two traps worth recording anyway: xterm's `write()` is **parsed
asynchronously**, so reading `buffer.active.type` in the same task as the write reports the old
buffer; and a pane holds **three canvases** (`xterm-link-layer`, the WebGL one, and the texture
atlas), so `querySelector('canvas')` returns a 2D one and any code reaching for the GL context
must scan rather than take the first.

### F.6 SSE through the Next rewrite — P0-T8 (2026-09-11, Next 16.3.4, Chromium 153, Node 26.3)

**Setup.** A core-shaped SSE producer on 4950 screened by `LoopbackGuard.screenStream`, emitting a
`session.updated` frame immediately on connect and then one every **200 ms** for **12 events**.
Two candidate transports on 4949, each measured in `next dev` **and** `next start`, plus a control
that isolates the failure, plus Chromium driving a real `EventSource` under the real CSP. Harness:
`scripts/sse-producer.ts`, `scripts/sse-probe.ts`, `scripts/sse-spike.ts`,
`scripts/sse-spike-browser.ts`, `scripts/sse-spike-cli.ts`. Three runs; ranges below span all three.

The events are deliberately **small** (~300 bytes) and **spaced**. A padded or chatty producer
would have passed every one of these measurements without ever reaching the byte threshold a
buffering proxy flushes at, and would have reported that SSE works.

**F.6.1 Both transports stream unbuffered in both modes, so latency did not decide this.**

| Mode | Transport | First event | Median gap | Worst gap | Verdict |
|---|---|---|---|---|---|
| — | baseline, straight to core | 42–49 ms | 202–204 ms | 213.8 ms | streamed |
| dev | next.config rewrite | 33.3–36.1 ms | 202.0–203.2 ms | 214.1 ms | streamed |
| dev | force-dynamic route handler | 28.8–47.3 ms | 202.5–203.0 ms | 206.0 ms | streamed |
| start | next.config rewrite | 16.3–26.7 ms | 202.1–202.8 ms | 205.0 ms | streamed |
| start | force-dynamic route handler | **11.6–20.1 ms** | 202.4–203.1 ms | 207.6 ms | streamed |
| start | Chromium `EventSource` via rewrite | 13.0–15.1 ms | 202.0–204.4 ms | — | streamed |

Against a 200 ms cadence every median gap is 202–203 ms and nothing ever stalled more than 14 ms
past a tick, so **neither transport adds measurable per-event latency**. The route handler is
first to first byte in `next start` in all three runs — 11.6–20.1 ms against the rewrite's
16.3–26.7 ms — but the ranges nearly touch and ~8 ms on a first byte is not an argument for
anything. R16's worry is answered: **the rewrite does not inherently buffer SSE.**

**F.6.2 The sub-question decided more than the latency did: `middleware.ts` cannot read the token,
`proxy.ts` can.** A `next.config` rewrite attaches no headers and a browser `EventSource` cannot
set one, so the bearer token has to come from something in between. It can:

- **Request headers set in middleware DO reach an external rewrite destination.**
  `NextResponse.next({ request: { headers } })` arrived at core on :4950 intact. That half works.
- **But `middleware.ts` runs on the EDGE runtime**, where `node:fs` is `Native module not found:
  node:fs`, and the token is a per-boot random written to a file (SEC-HTTP-3). Nothing in an edge
  middleware can read it: `process.env` is inlined at build time and the token does not exist yet.
- **Next 16 deprecates `middleware` in favour of `proxy`, and the runtime is the difference.**
  `proxy.ts` reports `NEXT_RUNTIME=nodejs` and `readFileSync` works. Next is explicit in its own
  source: *"Proxy always runs on Node.js runtime"*, and a route-segment `runtime` export inside a
  proxy file is an error rather than an option.

So the rewrite can carry the token, but only through the file convention this repo was not using.
`middleware.ts` is now `proxy.ts`. Had Next 16 not made that rename, the route handler would have
been the only transport able to authenticate at all — which is what the task suspected.

**F.6.3 What actually buffers SSE is gzip, and the fix is one header on the response.** The first
measurement of the rewrite batched **all 15 events into a single 3187 ms chunk**, and the response
carried `content-encoding: gzip`. Next compresses proxied responses, and a compressor holds a
stream until it ends. Four levers, measured:

| Lever | Set by | Result |
|---|---|---|
| `Accept-Encoding: identity` on the request | client | **streams** — but `EventSource` cannot set headers, so it is unavailable to the deck |
| `Content-Encoding: identity` on the response | core | ignored, still gzip, still batched |
| `X-Accel-Buffering: no` on the response | core | ignored, still gzip, still batched |
| **`Cache-Control: no-transform`** on the response | core | **streams**, with the client still asking for gzip |

`no-transform` is the only one that works from the server side, and it is the standard HTTP answer
rather than a Next-specific trick. The control run keeps it in the harness permanently: with
`no-transform` dropped, both modes batch all 12 events into one chunk at **2237–2271 ms**, with a
`200 OK`, every event eventually delivered, and nothing in any log. That is the failure R16 feared
and it is completely silent — the deck would look like a slow reconciler and would be debugged in
the wrong process.

**F.6.4 What core receives differs per transport, and Origin is not among the things it gets.**
Read off the producer rather than assumed:

| Header at core | Rewrite (Node client) | Rewrite (Chromium `EventSource`) | Route handler |
|---|---|---|---|
| `host` | `127.0.0.1:4950` | `127.0.0.1:4950` | `127.0.0.1:4950` |
| `origin` | absent | **absent** | absent |
| `sec-fetch-site` | absent | **`same-origin`** | absent |
| `accept-encoding` | `gzip, deflate, br` (forwarded) | `gzip, deflate, br, zstd` | `identity` (set by the handler) |
| `authorization` | `Bearer <token>` | `Bearer <token>` | `Bearer <token>` |

The rewrite **strips `Origin` but forwards `Sec-Fetch-Site`**, so a browser stream reaches core
looking exactly like a hook POST plus an unforgeable `same-origin`. That is why `screenStream`
keeps SEC-HTTP-2's "absent Origin is allowed" escape: demanding an Origin would refuse the only
path the browser has.

**F.6.5 A stream GET has no Content-Type backstop, and that is this task's security cost.**
F.4.3 found that Content-Type (SEC-HTTP-4) — not Origin — is what refuses a cross-origin simple
POST that skips the preflight. A `GET` carries no body and no Content-Type, so that backstop does
not exist on the stream route: `screenStream` is Host, Origin, Sec-Fetch-Site and token alone.

The layering still holds, and the check carrying it is `Sec-Fetch-Site`. A hostile page's `fetch`
is refused by Origin; a tag-shaped GET (`<img src="http://127.0.0.1:4950/stream">`) sends **no
Origin at all** and is refused by `Sec-Fetch-Site: cross-site`; anything non-browser is refused by
the token. But the margin is thinner than on a POST, which is the concrete reason the token stays
server-side (F.4.2) rather than a stylistic one. `Accept: text/event-stream` is available as a
further layer — tags cannot set it — and is left to P1-T10 rather than added on a spike's
authority.

**F.6.6 A response header set in proxy.ts is forwarded to core as a request header.** The CSP set
on the `NextResponse` arrived at core as a `content-security-policy` **request** header. Harmless
for a CSP; not harmless as a habit, since anything set on a proxy response leaks upstream. The CSP
is now issued only on document responses and `/api/core/*` gets the token and nothing else — the
table in F.6.4 shows it absent.

**F.6.7 Core down is where the transports genuinely differ.** Stopping the producer with the deck
still up:

- **Rewrite → `HTTP 500`**, Next's own error, carrying an HTML error page.
- **Route handler → `HTTP 503`**, deliberately, because it catches the refused connection.

500 is also the status the deck returns when the deck itself is broken. Worth naming as a bug found
by measuring rather than by design: the first version of the route handler returned 500 too,
because `fetch` to a dead port *throws* rather than returning a non-ok response, so the `ok` check
never ran. Core being down is an ordinary state on this machine (F.3.3), not an exception.

**F.6.8 Both transports propagate a client disconnect.** Abandoning the stream after one event
left **0 streams open at core** within a second on both paths. Neither leaks a producer per
reconnect, which an `EventSource` — reconnecting by design — would otherwise do all day.

**F.6.9 Side findings from putting a real build under a microscope.**
- `next build` writes an **`AGENTS.md` and a `CLAUDE.md`** into the repo root unless
  `agentRules: false` is set. A generated file should not sit beside hand-written instructions.
- Turbopack rooted the build at the home directory because a `package-lock.json` lives there,
  outside the repo. Pinned with `turbopack.root`.
- A runtime-computed path inside `readFileSync` makes Turbopack trace **the whole project** into
  the server bundle. Opted out at the call site.
- `/` is still statically prerendered, so by F.5.1's own rule it carries no nonce and does not
  hydrate under this CSP. It is a link list today and the EventSource check drives the page
  directly, so nothing in P0 depends on it — but P2-T1 inherits it, and it will be silent.

**F.6.10 CodeQL flagged the token reaching core, and it was right to.** `File data in outbound
network request` on the route handler's `fetch`: the bearer token is read from a file and sent
over the network. That flow is the design (SEC-HTTP-3) and the destination is a module constant on
loopback, so the alert is a true positive about the pattern and a false positive about the risk —
but reviewing it found two things that were not.

- The handler was **forwarding the client's query string** to core. Nothing needed it; it was
  written speculatively. Dropped, which leaves the outbound request with no client-controlled part
  at all and makes the alert a statement about a constant destination rather than a question.
- `fetch` defaults to **following redirects**. Core never redirects, so a 302 from :4950 means
  something that is not core is answering — and following it would re-issue the request against a
  destination this file did not choose, then pipe the answer back as the deck's own same-origin
  content. Now `redirect: 'error'`, and the caller reports core unavailable.

The alert is dismissed as a false positive with that reasoning rather than suppressed in code: a
comment would hide the next one of these, and the next one might not be the token.

### F.7 Capturing `daemon/roster.json`, and what the scrubber was not doing — P0-T9 (2026-09-11, Claude Code 2.1.268)

**Setup.** `scripts/roster-capture.ts` starts one throwaway `--bg` session in `.claude-isg`, reads
`daemon/roster.json` while the worker is alive, projects it through
`contracts/daemon-roster.ts`, and stops and removes the session again. the owner's own sessions
(`TICKET-1898` pid 18876, `isg-6b` pid 26428) were listed before and after and are unchanged
(SEC-PROC-5).

**F.7.1 The roster's interesting half only exists while a background session does.** `workers` is
`{}` with two interactive sessions running — an interactive session never appears in the roster at
all. So the shape P1-T14 parses cannot be captured by observation; it has to be provoked. That is
why this task needed a spawned session rather than a file read, and it is worth knowing before
P7-T4 tries to show roster state on a machine with no `--bg` work in flight.

**F.7.2 `--bg` and `-p` are mutually exclusive; the prompt is the positional argument.** The first
capture attempt failed outright:

> `--bg and --print conflict: --print never starts the interactive session that `claude agents`
> attaches to, so the job would be unattachable. The prompt is the positional — drop --print:
> `claude --bg '<task>'`.`

`claude --bg -n <name> '<prompt>'`. §B.1 describes `--bg` and `-p` separately and nothing said they
could not be combined. P4-T1 builds the launcher on this verb and SEC-PROC-2 allowlists both flags,
so the allowlist permits a combination the CLI refuses.

**F.7.3 Both roster timestamps are epoch milliseconds, not ISO strings.** `updatedAt` and
`startedAt` are integers (`1789123114141`). Everything else Flightdeck has captured so far dates in
ISO-8601, including the scrubber's own `ISO_INSTANT_PATTERN`, so a parser that assumes one format
across sources will be wrong here — and the scrubber leaves these numbers untouched, meaning a real
wall-clock time is committed. Sequence is what fixtures assert on, and the capture date is already
in this heading, so the exposure is nil; it is recorded because it is a rule the fixtures otherwise
follow.

**F.7.4 The scrubber was silently ignoring every capture it could not parse.** `listRawFiles`
returned only `*.json`, so `fixtures/raw/logs-blocked.txt` was skipped without a word: the script
reported "11 raw capture(s)" against twelve files on disk and `--check` passed. That is how a shape
captured in P0-T4 stayed absent from the repo while the P0 gate claimed every shape was captured.

It now triages. A capture it cannot scrub must be on an explicit `DEFERRED` list naming the task
that will handle it, and anything else non-JSON **fails** the run. A deferral is now a written
decision rather than an absence; a new unscrubbable capture cannot arrive quietly.

**F.7.5 `roster.workers` is the first fixture whose object KEYS are data, and scrubbing it half-way
made the fixture worse than not scrubbing it at all.** The scrubber's model is that keys are field
names and values are data, so it rewrites values and never touches keys. In the roster each key is
the short session id, and it equals the first segment of that worker's own `sessionId` — the same
relationship `keepShortIdDerivable` exists to preserve between `id` and `sessionId`.

The first scrubbed fixture therefore claimed worker `020e5c73` had `sessionId`
`2f3e94f3-dc84-…`. Not a leak — the opposite. A fixture that asserts a relationship the real shape
guarantees and the fixture does not is worse than an unscrubbed one, because P1-T14 would have been
built and tested against a lie. Keys of a `DATA_KEYED_OBJECTS` parent are now rewritten to track
their own scrubbed `sessionId`, with tests on both sides of the relationship.

**F.7.6 Never derive an id for `rm` from prose.** The capture script first read the new session's id
out of the spawn's stdout, with "the last whitespace-separated token" as a fallback when the
pattern missed. The pattern missed, the fallback returned the word `session`, and the script ran
`claude stop session` and `claude rm session`. Both failed — harmlessly, because no session is
called `session` — and the throwaway worker was left running until it was removed by hand.

`rm` removes a live session with no confirmation (F.2.5). A cleanup path that can address a session
by an English word is one collision away from removing somebody's work. The id now comes from a
**roster diff** — the one worker key that was not there before the spawn — which cannot name a
session this script did not start, and anything other than exactly one new worker fails closed
without running a removal verb at all.

**F.7.7 SEC-FS-1's field list was narrower than D24's reason for having it.** SEC-FS-1 permitted
`workers.<id>.{pid,sessionId,cwd,startedAt,cliVersion}` and named no top-level field — while D24
justifies keeping the file allowlisted at all on `supervisorPid`, the dead-daemon signature from
F.2.16 that P7-T4 has to surface. As written, the control forbade reading the only field its own
rationale depended on. SEC-FS-1 now names `proto`, `supervisorPid` and `updatedAt` explicitly.

**F.7.8 The path scrubber left short segments in the clear — fixed, not just noted.** `fakePath`
preserved any path segment of 12 characters or fewer, so the account name and every project
folder survived verbatim into every committed fixture. The scrubber's own header claimed "every
string longer than 12 characters is replaced by a placeholder", which overstated it for paths.

This was first recorded as *noted, not changed*: the repository is public under a known account,
so the username looked like a non-disclosure. That reasoning was wrong in two ways. The account
name on the repository URL is not the Windows account name, and the same rule that let the
username through also let through the names of every client project and a ticket id from a
private tracker — none of which are on any URL. Length was never a safety property; it is a
readability one.

`fakePath` now keeps a segment only if it is in `STRUCTURAL_SEGMENTS` — the Windows and Claude
directory names a parser navigates by (`Users`, `AppData`, `projects`, `.claude-isg`, …) — and
scrubs everything else however short it is. Session names moved the same way: they are free text
a person wrote, so `scrubSessionName` scrubs the `name` of any record carrying a `pid` or
`sessionId` regardless of length, while leaving vocabulary names like `output_style.name` alone.
Every fixture was regenerated from `fixtures/raw/` and the diff is confined to those segments.

---

## G. Slice results (measured on this machine, 2026-09-11, binary 2.1.268)

Measured while building the D30 terminal slice. Both were found by running the thing, not by
reading, and both had already shipped past a green unit suite.

### G.1 `claude attach` takes the SHORT id. The full uuid fails. — **the slice's worst bug**

A pane bound with the full `sessionId` opens, mounts, streams ~295 bytes and dies:

```
No job matching '337975f9-c9c0-454a-a22a-2d53a86e0ea9'. Run 'claude agents' to list running sessions.
```
exit 1, about a second after attach.

The listing prints **both** ids on a background record — `id: "337975f9"` and
`sessionId: "337975f9-c9c0-..."` — and `attach`, `stop`, `rm` and `logs` all take the short one.
`core/domain/session-id.ts` documented this correctly from P1-T1 (*"The short form the listing
prints and `stop`, `rm`, `logs` and `attach` take"*); the adapter simply did not use it.

**Consequence:** the failure mode is the nastiest shape available — the WebSocket handshake
succeeds, the `ready` frame arrives with a real pid, the pane paints, and *then* the session exits.
Every socket-level test passed. Only attaching to a real session catches it.
`WindowsPtyCommands` now converts through `SessionId.parse(...).short`, and the wire carries the
full uuid deliberately: it is the stable identity, and narrowing it to what the CLI happens to
accept is the adapter's job.

### G.2 A just-launched `--bg` session appears in the listing WITHOUT a `pid`

Immediately after `POST /sessions` returned `337975f9`, the next sweep showed:

```
[365] fd-pane-1   background   state=working   live=false   attachable=false
```

and moments later, the same session:

```
[365] fd-pane-1   background   state=working   live=true    attachable=true
```

The record carries `state: "working"` before it carries `pid`. D29's rule — **liveness is the
presence of `pid`** — is still right (a `pid` never lies), but it is not *instant*: there is a
window after launch in which a genuinely running session reads as not live, and therefore as not
attachable.

**Consequence for P1-T4 and P2-T2:** the deck must not conclude anything permanent from one sweep.
A session that has just been launched needs a grace period, or the launch path needs to poll until
the `pid` appears before it offers a pane. The slice's deck re-fetches, which is enough to make the
row correct a second later; a reconciler that latched "not attachable" would not be.

### G.3 The production CSP makes `npm run dev` unusable — the page never hydrates

Loading `/deck` from `next dev` under the SEC-UI-1 policy gives a page that renders server-side and
then does nothing. No button works, no fetch is issued, and the deck sits on "core down" forever.
The console carries the whole explanation, once:

```
eval() is not supported in this environment. If this page was served with a
`Content-Security-Policy` header, make sure that `unsafe-eval` is included.
React requires eval() in development mode ...
```

The dev bundler also opens an HMR WebSocket on the UI port, which `connect-src 'self'` does not
cover — `ws:` is a different scheme from the page's own origin — and `proxy.ts` was matching
`_next/hmr` and answering a WebSocket upgrade with an ordinary HTTP response
(`ERR_INVALID_HTTP_RESPONSE`).

**This was not new.** `/spike/xterm` did not hydrate either; P0-T6's measurements were taken
against a production build, so nothing had noticed. It is the third instance of the failure shape
F.5.1 named: *the CSP breaks the page silently and the symptom names no directive.*

**Partly fixed, and STILL OPEN.** `contentSecurityPolicy(nonce, development)` adds `'unsafe-eval'`
and the HMR socket for dev only — `development` is a parameter rather than an inline `NODE_ENV`
check so a test can assert the production policy never grows either relaxation, and
`tests/contracts` does exactly that. The eval error is gone.

**`next dev` still does not hydrate.** Three things were tried and none of them was enough:

| Tried | Result |
|---|---|
| `'unsafe-eval'` + HMR socket in `connect-src` (dev only) | eval error gone, still no hydration |
| proxy `matcher` excluding all of `_next/` | no change |
| `headers()` source excluding `_next` — response headers on a 101 break a handshake | no change |

The remaining symptom is `ws://127.0.0.1:4949/_next/hmr` failing with `ERR_INVALID_HTTP_RESPONSE`
on every retry, and a page that never hydrates. Something in this Next 16 dev server still refuses
that upgrade. **`next build && next start` works completely**, which is why `flightdeck.cmd` runs
the production build and why the deck was verified against one. Filed as **P2-T6b**; until it is
solved, editing the deck means rebuilding, and `npm run dev` is misleading rather than useful.

The last change is kept regardless of its effect here: `X-Frame-Options` and `Referrer-Policy` on a
JavaScript chunk were always meaningless.

### G.4 `@xterm/addon-webgl` 0.19 on `@xterm/xterm` 6.0 activates and paints NOTHING

A pane attached to a real Claude session, with the socket reporting `live` and `onData` delivering
4 KB of correct escape sequences, showed a cursor on an empty black rectangle. Measured in both
headless and headed Chromium, so it is not a software-GL artifact.

| Renderer | `.pane-host canvas` | `.xterm-rows > div` | What a person sees |
|---|---|---|---|
| WebGL (addon 0.19.0) | 3 | 0 | nothing |
| DOM (default) | 0 | 52 | the session, correctly |

The addon loads without throwing, `report().renderer` says `'webgl'`, and the canvases exist — so
every signal the P0-T6 harness checks says it is working. **Neither `@xterm/xterm` 6.0.0 nor
`@xterm/addon-webgl` 0.19.0 declares a `peerDependencies` range**, so npm installed the pair
without a word; 0.19 is built against xterm 5's internals.

**Consequence:** the deck runs on the DOM renderer, which paints every pane and puts real text in
the DOM where tests and screen readers can read it. `enableWebgl()` is kept for P0-T6's context
budget harness and is not called by the deck. **P5a-T3b** decides the renderer properly — a
matching addon version, or accepting the DOM renderer and deleting the budget logic that only
existed to ration WebGL contexts.

### G.5 Two artifacts in a working pane, neither fatal, both real

With the DOM renderer the deck shows a live Claude Code session correctly — banner, prompt,
response, statusline, and typed input echoing back in the prompt box. Two things are visibly wrong.

**The first keystroke after a pane opens can be lost.** Typing `hello from the browser` into a
freshly focused pane produced `ello from the browser`. Consistent across runs. The likely cause is
that `TerminalPane.focus()` runs in the mount effect while the socket is still mid-handshake, so
the first `onData` fires before `PaneSocket` has set `authorised` and `send()` drops it — the guard
that stops an unauthenticated frame is also dropping a legitimate early one. The fix is to buffer
input until `ready` rather than discard it. Filed against P5a-T6.

**A garbage line paints above the session.** `$$$$$$$…5555555555` on the first row. It is the
`ESC[?9001h` win32-input-mode sequence ConPTY emits, which xterm.js does not recognise and renders
as text. Harmless, cosmetic, and it will need either a filter on the first frames or an xterm that
understands the sequence. Also filed against P5a-T6.

### G.6 `next start` binds 0.0.0.0 by default - the deck was on the LAN

`flightdeck.cmd`'s port check refused to believe the deck had started, because it looks for
`127.0.0.1:4949` and `netstat` said:

```
TCP    0.0.0.0:4949    0.0.0.0:0    LISTENING
```

Next's own startup banner says so plainly and it is easy to read past:

```
- Local:         http://localhost:4949
- Network:       http://<lan-ip>:4949      <- anyone on the Wi-Fi
```

**This breaks SECURITY.md section 7 rule 1** ("Bind 127.0.0.1 only, both ports. Never a host
flag.") and it had been true of every `npm run dev` in this project since P0-T6. Core was always
correct — `CoreServer.listen` passes `LOOPBACK_ADDRESS` explicitly and there is a test for the
EADDRINUSE case — but the *deck* inherited a framework default that nobody had checked, and the
deck is the origin core trusts.

**Fix:** `-H 127.0.0.1` on both `next dev` and `next start`. The runner's check is deliberately
strict about the address rather than matching any bind of the right port, so a regression here
fails the start instead of quietly exposing the deck again.

**Worth generalising:** the security model was verified end to end on core's port and assumed on
the deck's. A control that is only asserted on one of two processes is asserted on neither.
