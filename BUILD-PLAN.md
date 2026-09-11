# Flightdeck — build plan

How SPEC.md (rev 3) gets built: repo shape, data model, API contract, phases with gates, and the
test strategy. Decisions referenced as **D-n** are in DECISIONS.md; evidence as **R §x** in
RESEARCH.md. Nothing here is built yet.

---

## 1. Repo shape

```
flightdeck/
├─ flightdeck.cmd            start core (if not running) + Next dev + Edge --app window
├─ package.json              Next.js 16 · React 19 · Tailwind 4 · TypeScript strict · vitest · playwright
├─ app/                      Next app router (UI on 127.0.0.1:4949)
│  ├─ (deck)/                by-session · by-project · terminals · search
│  └─ api/                   thin proxies only — real work is in core
├─ components/               dense rows, gauges, palette, pane, workflow-map widgets
├─ lib/                      client state (SSE subscriber), keymap, formatting
├─ contracts/                TypeScript types + zod schemas shared by core and UI (§3)
├─ core/                     flightdeck-core — Node 26, TypeScript run directly (erasable syntax), no build step
│  ├─ main.ts                http + ws server on 127.0.0.1:4950
│  ├─ feeds/                 hooks.ts · statusline.ts · reconciler.ts · transcript-tail.ts · fswatch.ts
│  ├─ model/                 session state machine, derived flags (D7), quota
│  ├─ store/                 node:sqlite — schema, migrations, FTS5 (Phase 7)
│  ├─ launch/                profile-function spawner, presets, connect (settings merge, D13)
│  ├─ pty/                   node-pty host: attach panes, shell panes, popout
│  ├─ notify/                Windows toasts (D16)
│  └─ security/              host/origin/token guards (D10)
├─ scripts/
│  ├─ install-core-task.ps1  register flightdeck-core as a logon task
│  ├─ capture-fixtures.mjs   scrub real transcripts/hook payloads into test fixtures
│  └─ doctor.mjs             checks: ports, node version, claude.exe, both config dirs, hooks installed
├─ fixtures/                 scrubbed JSONL + hook/statusline payloads (never raw transcripts)
├─ tests/                    vitest (core, contracts) · playwright (UI smoke)
└─ SPEC.md · RESEARCH.md · DECISIONS.md · BUILD-PLAN.md
```

House-pattern alignment (R §A): same Next/React/Tailwind majors as claude-coach and groundwork,
`-H 127.0.0.1`, a `.cmd` launcher, vitest + playwright as in groundwork. Ports **4949** (UI) and
**4950** (core). Both bind loopback only.

**Why core is TypeScript without a build:** Node 26 strips types natively; keep `core/` to
erasable syntax (no `enum`, no parameter properties, no namespaces) so `node core/main.ts` just
runs. Verified in step 0.2; if it bites, fall back to `tsx`.

---

## 2. Processes and how they talk

```
Claude Code sessions (both $CFG)            flightdeck-core :4950                 UI :4949 (Next)
  http hooks  ──────────────POST /hooks────▶  feeds/hooks ─┐
  statusline.py ────────────POST /statusline▶ feeds/statusline ─┤
  agents --json ◀──every 10 s── reconciler ◀────────────────────┤──▶ model ──▶ store (sqlite)
  transcripts  ◀──tail (byte offset)──────── transcript-tail ───┘        │
                                                                        ├──▶ GET /stream (SSE)  ◀── browser (via Next rewrite, same-origin)
  claude attach <id> in ConPTY ◀── pty host ◀── WS /pty ────────────────┘◀── browser (direct to :4950, Origin + token checked)
  powershell -Command "<profile fn> --bg -n … '…'" ◀── launch/
```

- **HTTP from the browser goes through Next** (`next.config.ts` `rewrites: /core/:path* → http://127.0.0.1:4950/:path*`) so the page stays same-origin and core needs **no CORS at all**.
- **WebSockets go straight to :4950** (Next rewrites do not proxy upgrades). Core accepts an upgrade only when `Origin` is exactly `http://127.0.0.1:4949` (or the Tauri origin in Phase 5b) **and** the first message carries the per-boot token (D10).
- **Claude Code → core** uses the hook `headers` field for the token; `statusline.py` reads the token file.

---

## 3. Data model (`contracts/`)

```ts
type SubscriptionId = '365' | 'isg';            // display names, not paths
interface Subscription {
  id: SubscriptionId; configDir: string;        // ~\.claude-365 …
  profileFns: string[];                         // claude-365 | claude-isg | claude-isg-ticket | claude-isg-orch
  connected: boolean;                           // hooks + statusline blocks installed (D13)
  quota?: Quota; version?: string;              // from statusline heartbeat
}
interface Quota {                               // statusline.rate_limits, last seen per subscription
  fiveHour: { usedPct: number; resetsAt: number };
  sevenDay: { usedPct: number; resetsAt: number };
  spendLimit?: { usedPct: number; resetsAt: number };
  observedAt: number;
}

type LiveKind = 'interactive' | 'background';
type BgState = 'working' | 'blocked' | 'done' | 'failed' | 'stopped';       // Claude Code's words (R §B.2)
type IntStatus = 'busy' | 'waiting' | 'idle';
interface Session {
  sessionId: string; subscription: SubscriptionId; kind: LiveKind;
  shortId?: string; pid?: number;               // shortId only for background sessions
  cwd: string; projectId?: string; worktree?: string;
  name?: string; nameSource: 'user' | 'derived' | 'auto' | 'ai-title';
  startedAt: number; lastEventAt: number;
  state?: BgState; status?: IntStatus; waitingFor?: string;
  flags: Array<'needs-you' | 'wedged' | 'context-pressure' | 'retired' | 'errored' | 'unnamed' | 'attached'>;
  vitals?: Vitals; now?: Activity; live: boolean;   // live = present in last reconcile
}
interface Vitals {                              // from statusline heartbeat; cost-state fills gaps
  model: string; contextWindow: number; usedPct: number; effort?: string;
  costUsd: number; linesAdded: number; linesRemoved: number;
  turnElapsedMs?: number; permissionMode: string; agent?: string;
  pr?: { number: number; url: string; reviewState?: string };
  git?: { branch?: string; dirty?: number; ahead?: number; behind?: number };
}
interface Activity {                            // "doing right now"
  tool?: string; input?: string;                // PostToolUse tool_name + first 80 chars
  lastPrompt?: string; title?: string; awaySummary?: string;
  toolCallsThisTurn: number;
}

interface FdEvent {                             // append-only, sqlite `events`
  id: number; at: number; sessionId: string; subscription: SubscriptionId;
  source: 'hook' | 'statusline' | 'reconcile' | 'transcript' | 'fswatch' | 'launcher';
  type: string;                                 // hook_event_name | notification type | 'seen' | 'gone' | …
  payload: unknown;                             // raw, for replay and fixtures
}

interface Project {
  id: string; path: string; name: string; group?: string;      // group: app-core + app-next + worktrees
  worktrees: string[]; stack: string[]; git?: Vitals['git'];
  usualSubscription?: SubscriptionId;           // from observed history
  presets: Preset[];
}
interface Preset {
  id: string; name: string; subscription: SubscriptionId; profileFn: string;
  cwd: string; sessionName: string; prompt: string;
  model?: string; agent?: string; effort?: string; permissionMode?: string; addDirs?: string[];
}
```

Derived flags (D7) are computed in `model/` from events, never stored as truth.

---

## 4. Core API contract (`127.0.0.1:4950`)

All mutating routes and `/pty` require `Authorization: Bearer <token>`. All routes reject a
`Host` other than `127.0.0.1:4950`/`localhost:4950` and any `Origin` other than the UI's.

| Route | Purpose |
|---|---|
| `POST /hooks` | Claude Code `http` hook target. Body = hook JSON (R §D.2). Replies `200 {}` in < 5 ms, work is queued. |
| `POST /statusline` | statusline.py heartbeat. Body = the statusLine stdin JSON. Same fast-ack rule. |
| `GET /stream` | SSE. **Built (P1-T9):** `snapshot` on connect (every row plus the unreadable subscriptions), then `session.upsert` / `session.gone`. To come: `quota` (P1-T6), `event` (P1-T5, which decides what of a hook payload is safe to show — SEC-UI-2) and `pty.*`. |
| `GET /sessions` · `GET /sessions/:id` · `GET /sessions/:id/events?since=` | merged view of both subscriptions |
| `GET /sessions/:id/tail` | SSE of parsed transcript records from the stored offset (enrichment view) |
| `POST /sessions/:id/stop` · `/rm` · `/respawn` · `/resume` · `/rename` | wrappers over the CLI, per subscription (`$CFG` set on the child) |
| `POST /launch` | `{presetId}` or explicit `Preset` fields → `powershell -NoLogo -Command "<profileFn> --bg -n <name> '<prompt>' …"`; returns `{shortId, sessionId?}` |
| `POST /run` | Ask: `-p --output-format stream-json --include-partial-messages [--json-schema] --max-budget-usd` under the chosen profile fn; SSE reply |
| `GET /quota` | both subscriptions' last-known `Quota` + the recommended one (`most headroom`) |
| `GET/POST /projects` · `GET /projects/:id/map` · `GET /projects/:id/observed` · `POST /projects/:id/presets` | F1/F6 |
| `WS /pty?attach=<shortId>` · `WS /pty?shell=powershell&cwd=` | attach pane (exclusive, D8) / plain shell pane; frames: `data`, `resize`, `detach`, `kill` |
| `POST /popout/:shortId` | detach any pane, then `wt.exe -w 0 nt --title <name> -d <cwd> powershell -NoExit -Command "<profileFn> attach <shortId>"` |
| `POST /connect/:subscription?dryRun=1` | D13: compute/merge the hooks + statusLine blocks into `$CFG/settings.json` with backup |
| `GET /health` · `GET /version` | core liveness; Claude Code version per subscription; update available? |

`app/api/*` in Next contains nothing but the rewrite; the UI never talks to `claude.exe` itself.

---

## 5. Phases and gates

Each gate is a sentence the owner can verify by using it (D19). Estimates are working sessions, not
calendar days.

### Phase 0 — spikes (½–1 session)

| # | Spike | Status / gate |
|---|---|---|
| 0.1 | `node-pty` prebuild + ConPTY round trip on Node 26 | **DONE 2026-09-10** (R §A.1) |
| 0.2 | `node core/main.ts` runs under Node 26 with native type stripping | prints a `/health` response |
| 0.3 | `http` hook behaviour: install a `SessionStart` + `Stop` http hook in **one** subscription pointing at a 10-line receiver; capture real payloads to `fixtures/`; then stop the receiver and observe what a session shows when the target is down | payloads captured; the "receiver down" UX is documented (this decides whether core must be a logon task or may be started lazily) |
| 0.4 | `--bg` end to end via `claude-isg --bg -n fd-spike '<tiny prompt>'`: capture `agents --json` for a **running** background session (expect `id`, `state`, `waitingFor`), `logs`, `attach` inside node-pty, the second-attach error, `stop`, `attach` again (resume), `rm` | every shape in the row is in `fixtures/`; the retire-after-idle behaviour (R §B.3) is timed once |
| 0.5 | statusline.py POST: add the ≤150 ms POST + token read, confirm render output is byte-identical and a refused connection costs < 5 ms | measured |
| 0.6 | `@xterm/xterm` 6.0.0 + `addon-fit` 0.11 + `addon-webgl` 0.19 + `addon-serialize` 0.14 + `addon-unicode11` 0.9 inside Next: WebGL renderer, fit, resize, alt-screen with `tui: fullscreen`, `attachCustomKeyEventHandler` capturing Ctrl+C-with-no-selection; confirm the ~16 WebGL-context cap and the `onContextLoss` → DOM fallback (R §E.1) | measured on this machine's Edge and Chrome |
| 0.7 | Security probe: from a page on another origin, attempt `fetch` POST and a WebSocket to :4950; confirm both are rejected by Host/Origin/token checks (R §E.8) | rejected, with tests in `tests/security` |
| 0.8 | SSE through the Next rewrite: does `/core/stream` reach the browser unbuffered in `next dev` **and** `next start`? If not, pipe it through a `force-dynamic` route handler returning a `ReadableStream`, or connect `EventSource` directly to :4950 with an exact-origin CORS allow (R §E.7, R16) | events arrive within 100 ms of core emitting them |

### Phase 1 — core service, headless (2–3 sessions)

Reconciler (`agents --json` × 2 every 10 s, `fs.watch` nudges), hooks receiver, statusline
receiver, SQLite store, SSE stream, state machine with derived flags, `scripts/doctor.mjs`,
`install-core-task.ps1`, `Connect` merge with dry-run. A `flightdeck-core status` command prints
the merged session table.

**Gate:** with both subscriptions connected, every live session on the machine prints with
subscription, name, state, flags, model, context %, cost and 5h/7d quota, and a `Stop` in any
session shows up in the table within one second.

### Phase 2 — the deck: sessions view (2 sessions)

Next app, dense attention-sorted rows (D15), inline expansion with vitals + "doing now" +
away-summary, both quota gauges in the header, `Ctrl+K` palette skeleton, `?` shortcut sheet,
`flightdeck.cmd` opening `msedge --app=http://127.0.0.1:4949`.

**Gate:** "what needs me?" is answerable from the deck alone, for both subscriptions, without
opening or alt-tabbing to any terminal.

### Phase 3 — projects and the workflow map (2–3 sessions)

Import folder (path reference), stack detection, git status (lift `statusline.py`'s cached
approach), the Workflow Map from `.claude/*` + `CLAUDE.md` + `.mcp.json` + settings hooks
timeline, observed behaviour from both subscriptions' transcripts for that slug, project groups,
worktree discovery via the same logic as `lib/tree.mjs`, `gates.json` verdict + deep link to
coach `:4747` when present (D12). By-project view.

**Gate:** importing `app-next` renders its 3 agents, 3 commands, 10 skills, 17 hooks on a
trigger timeline, 2 worktrees and the MCP server correctly; importing `docs-tool` (no `.claude`)
degrades gracefully to CLAUDE.md + stack + git.

### Phase 4 — launcher, quota-aware routing, Ask/Dispatch (2 sessions)

Presets per project (encode the five profile functions), subscription picker pre-selecting the
most headroom, `--bg` dispatch appearing as a row within a second (hook `SessionStart`), Ask panel
with streamed result and `--max-budget-usd`, Refresh, version/update chip with `claude update` and
`respawn --all`, forced naming at launch (D7 `unnamed`). Fix the bash alias drift first (D4).

**Gate:** a new ticket session for app-next starts from the deck on the subscription with more
headroom, named, in the right worktree, and the owner never typed a terminal command.

### Phase 5a — terminal grid (3 sessions)

`WS /pty` attach panes with exclusivity handling, `logs`/transcript preview for unfocused panes,
renderer budget (live WebGL only on focused/visible panes, DOM renderer or text preview elsewhere),
layouts 1/2/4/6/9 + focus mode saved per project, per-pane controls (interrupt, stop, respawn,
rename, mute), scrollback cap, `keybindings.json` helper that writes the Ctrl+W/Ctrl+T remaps into
both config dirs with a diff (D13 style).

**Gate:** nine sessions in one window, typing in the focused pane is indistinguishable from a
terminal, closing a pane never stops a session, and reopening the deck re-attaches.

### Phase 5b — Tauri shell (1 session, D1)

**5b.1 first:** a bare Tauri 2.10 window loading the deck — confirm Ctrl+W and Ctrl+T reach the
page's `keydown` handler in WebView2 (wry#569 says there is no blanket accelerator switch; a lead
is WebView2's `AreBrowserAcceleratorKeysEnabled` through wry's Windows builder extension — R §E.3).
If they do not reach the page, stop and reassess before building the rest of the shell.

Then: `src-tauri/` loading `http://127.0.0.1:4949`, starting core + Next if absent, tray icon
with needs-you badge, global hotkey to show the deck (`global-shortcut` plugin), native
notifications (`notification` plugin) routed from core. Rust toolchain installed once (≥ 1.77.2).
Evergreen WebView2 — do not bundle the 180 MB fixed runtime. The web version keeps working
unchanged.

**Gate:** Ctrl+W in a pane deletes a word; nothing closes.

### Phase 6 — one browser, zero terminals (1–2 sessions)

Plain PowerShell panes, pop-out to Windows Terminal (`open-tab.mjs` AppX fix reused), preset
groups ("morning"), toasts with per-session mute, duplicate-cwd warning, session handoff
(`--resume --fork-session` into a worktree).

**Gate:** one full working day with no terminal window opened by hand.

### Phase 7 — search and analytics (2 sessions)

FTS5 index over both subscriptions' transcripts (incremental by byte offset, survives
`cleanupPeriodDays`), filters (project, subscription, date, tool, session), cost/tokens per
project/subscription/week from `cost-state`, daemon visibility, optional OTLP/http-json receiver
(R §D.7).

**Gate:** "where did I do that Cloudflare Workers deploy?" returns the session in under a second.

---

## 6. Test strategy

- **Fixtures, never raw transcripts.** `scripts/capture-fixtures.mjs` takes a real JSONL or hook
  payload, keeps structure, replaces every string longer than 12 chars with a deterministic
  placeholder, and writes to `fixtures/`. Transcripts contain client code and prompts; the repo
  must stay shareable.
- **Core parsers are pure functions with vitest tables**: one fixture per record type in R §C,
  one per `agents --json` shape (interactive, background running, background done), one per hook
  event, one statusLine payload with and without optional fields. A shape the parser does not
  recognise must produce `unknown` + a metric, never a throw.
- **State machine tests**: event sequences → expected flags (needs-you after `Stop`+idle; retired
  after `done`; wedged after N silent minutes; context-pressure at 80 %).
- **Security tests** (Phase 0.7): wrong Host, wrong Origin, missing token, cross-origin WebSocket
  → all rejected.
- **Playwright smoke**: deck loads, rows render from a fixture SSE stream, palette opens, a pane
  mounts against a fake PTY echo server.
- **Version drift guard**: `scripts/doctor.mjs` records the Claude Code version the fixtures were
  captured on; after `claude update` it re-runs the Phase 0 captures and diffs the shapes.

---

## 7. Operational notes

- `flightdeck.cmd`: check `GET :4950/health`; if down, `start /b node core\main.ts`; `npm run dev`;
  `start msedge --app=http://127.0.0.1:4949`. Fail loudly if 4949/4950 are taken (R11).
- Logon task (`install-core-task.ps1`) runs `node core\main.ts` hidden at logon so hooks always
  have a receiver (D2). Until Phase 0.3 proves the "receiver down" UX is silent, this is mandatory.
- Never touch port 4201 or 4200 (sibling-app, app-core serve) — reuse `lib/tree.mjs`'s blacklist idea.
- Everything Flightdeck writes lives in `%LOCALAPPDATA%\flightdeck\` (db, token, logs) — except
  the two settings blocks and the keybindings file it installs on request, each with a backup.
