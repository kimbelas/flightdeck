# Flightdeck — security policy

Flightdeck reads every Claude Code transcript on the machine and can start, attach to and stop
sessions that run with `--dangerously-skip-permissions`. A weakness in it is a weakness in the
whole machine. This document is the threat model, the controls (each with an id the roadmap and
PRs reference), the secure-coding rules, and what to do when something goes wrong.

Evidence for the threat model is in RESEARCH.md §E.8, including CVE-2025-49596 (MCP Inspector):
remote code execution on a developer's machine through a tool that was bound to `127.0.0.1`.

---

## 1. Scope and threat model

**Assets**
- Transcripts and prompts (client code, credentials pasted into sessions, business context)
- The ability to spawn processes as the owner, with permission checks bypassed
- Session `.key` files, the daemon's pipe keys, Claude Code credentials in `$CFG`
- Flightdeck's own bearer token and SQLite store

**Trust boundaries**
1. Browser page ↔ core service (loopback HTTP + WebSocket)
2. Claude Code sessions ↔ core (hook and statusline POSTs)
3. Core ↔ filesystem (two config dirs, imported project folders)
4. Core ↔ child processes (`claude.exe`, `powershell.exe`, `wt.exe`)
5. Model-generated text ↔ UI (titles, summaries, tool inputs rendered on screen)
6. Dependencies and CI ↔ the repo

**Attackers considered**
- **A web page in the same browser** (any tab) sending requests to loopback ports: simple
  `POST`s need no preflight; WebSocket handshakes are not origin-restricted by the browser.
- **DNS rebinding**: a hostname that re-resolves to `127.0.0.1` after load, making loopback
  look same-origin.
- **Prompt-injected content** in transcripts: a session summary or tool input crafted to
  exploit the UI (XSS) or to be pasted into a command.
- **A compromised npm dependency or GitHub Action.**
- **Accidental self-harm**: a bug that stops the wrong session, writes the wrong settings file,
  or leaks a token into logs.

**Out of scope**: malware already running as the owner's user (it owns the machine regardless), other
local user accounts (single-user PC), physical access.

---

## 2. Controls

Ids are stable; ROADMAP.yaml tasks and PRs cite them.

### Network — SEC-NET
| Id | Control |
|---|---|
| SEC-NET-1 | Core and UI bind **`127.0.0.1` only**, explicitly (not `localhost`, not `::`). No configuration option can widen this; a host flag is never added. Start fails loudly if the port is taken. **The UI half was violated until P2-T6**: `next start` and `next dev` default to `0.0.0.0`, so the deck was reachable from the LAN while core was correctly bound (RESEARCH.md G.6). Both now pass `-H 127.0.0.1`, and `flightdeck.cmd` checks the address rather than the port so a regression fails the start. |
| SEC-NET-2 | Core makes **no outbound network calls** except to `127.0.0.1:4949`. The version-update check calls `claude update` (the CLI does the network), never a URL from core. The UI loads no third-party scripts, fonts or images at runtime; `images.unoptimized` keeps Next's optimiser from fetching. **A build is not exempt, and was the hole until P2-T1**: `next build` POSTs to `telemetry.nextjs.org` unless `NEXT_TELEMETRY_DISABLED=1` is set, which ci.yml and release.yml did and `flightdeck.cmd` — the only local build — did not. |
| SEC-NET-3 | **Remote reach is a proxy the owner installed, never a bind** — P8, DECISIONS.md D59. *Placeholder until P8-T5 rewrites it from what P8-T2 measured.* The owner may put an identity-aware reverse proxy that authenticates them outside Flightdeck (Tailscale `serve`, DP4) in front of loopback. SEC-NET-1 is unchanged by that: core and the deck still bind `127.0.0.1` only, `netstat` shows nothing new on any other address, and a host flag is still never added. What the proxy adds is **one extra host/origin pair** — exact strings, read from one file core owns, compared the way the loopback pair is (SEC-HTTP-1, SEC-HTTP-2, SEC-WS-1) — never a wildcard, never an IP literal, never a loopback name, and the pairing itself is the allowlist: a remote host with a loopback origin, or the reverse, is refused. Absent config is today's behaviour byte for byte. The PTY socket reaches core through the same proxy and the same single-use ticket (SEC-WS-1); the per-boot token still never enters a browser. The proxy's own inverse (`tailscale serve reset`) returns the machine to loopback-only in one line. What stays out: Remote Control, cloud sessions, other machines (D12, D59). |

### HTTP — SEC-HTTP
| Id | Control |
|---|---|
| SEC-HTTP-1 | **Host validation** on every request: `Host` must be exactly `127.0.0.1:4950` or `localhost:4950` (core) / `:4949` (UI). Anything else → `421`. Defeats DNS rebinding. |
| SEC-HTTP-2 | **Origin validation**: mutating routes and all upgrades require `Origin` to equal the UI origin (`http://127.0.0.1:4949`; P5b's Tauri origin was dropped with P5b, and the tailnet origin is P8-T3 under SEC-NET-3). Requests with no `Origin` are allowed only from Claude Code hooks/statusline, which authenticate with the token instead. |
| SEC-HTTP-3 | **Per-boot bearer token**: 256-bit random, generated by core at start, written to `%LOCALAPPDATA%\flightdeck\token` with an ACL restricted to the current user. Required on every mutating route, `/hooks`, `/statusline` and `/pty-ticket`; `/pty` takes a ticket minted by that route instead (SEC-WS-1, D32), and **never accepts the token itself**. Compared in constant time. Rotated on every core restart; a `Rotate token` action exists. **`/hooks` also accepts the ingest key (SEC-HTTP-7)**, which is the one client that cannot re-read this file — and so do the optional OTLP receiver's `/v1/metrics` and `/v1/logs` (P7-T5), whose client is the same session's exporter. |
| SEC-HTTP-4 | **Content-Type must be `application/json`** on every POST (forces a CORS preflight for cross-origin pages, which core never answers). Body limit 4 MB (hook `tool_input` can be large), 64 KB for control routes, 8 MB for `POST /pasted-images` (SEC-FS-5 — one screenshot, base64, which adds a third). **A pasted image is JSON with base64 for this reason and not as a preference**: `multipart/form-data` is a *simple request*, the one shape another origin may post without a preflight, so an upload route that took it would be the single place this control did not apply. Unparseable JSON → `400` with no detail. **A stream `GET` carries no body and no Content-Type**, so this control cannot apply to it: `/stream` is screened by SEC-HTTP-1, -2, -5 and -3 alone, and `Sec-Fetch-Site` is what refuses the no-Origin tag-shaped GET that Content-Type would have caught on a POST (RESEARCH.md F.6.5). |
| SEC-HTTP-5 | **`Sec-Fetch-Site`** must be `same-origin` or `none` on browser-originated mutating requests. **No CORS headers ever**; browser HTTP reaches core through a same-origin Next rewrite. Response headers: `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`; no `Server` header. |
| SEC-HTTP-6 | **Rate limits**: 60 mutating requests/min per token; 600 hook events/min per session id; 30 pasted images/min (SEC-FS-5 — Ctrl+V is a hand, not a machine); 429 beyond. Protects against a runaway hook or a malicious page hammering a leaked token. |
| SEC-HTTP-7 | **Stable ingest key**, for `POST /hooks` and — only when core was started with `FLIGHTDECK_OTLP=1` — the OTLP receiver's `POST /v1/metrics` and `POST /v1/logs` (P7-T5), and no other route. 256-bit random, created once by core and kept at `%LOCALAPPDATA%\flightdeck\ingest-key` with the same per-user ACL as the token (SEC-FS-4); **not** deleted on shutdown and **not** rotated on restart. Compared in constant time, alongside the token, on every ingest request — never instead of it. It exists because a Claude Code session interpolates its hook `Authorization` header from the environment it was spawned with and can never refresh it (RESEARCH.md F.1.7), so a per-boot secret would `401` every session older than the current core — and a `401` on a hook is an error banner in that session for every turn until it is restarted (F.1.5). **A secret a client cannot re-read must not rotate under it.** **The OTLP exporter carries it through `otelHeadersHelper` (`scripts/otel-headers.ts`), which reads the key file when Claude Code runs it** — the key is never written into a settings file, and Flightdeck writes neither the helper line nor the exporter variables into `$CFG` (SEC-FS-3); `npm run otlp` prints them for the owner to add. The same reasoning holds: an exporter's headers are fixed until the helper next runs, up to 29 minutes, so a per-boot token would be refused after every restart. The receiver reads only numbers and four allowlisted labels (`session.id`, `type`, `model`, `event.name`) — never `user.email`, account ids, prompt or response text — and holds its sums in memory. The key buys strictly less than the token: it cannot launch a session, read `/sessions`, open a stream or mint a PTY ticket, and the worst a holder can do is post fabricated hook events into the local log and the deck. `Rotate token` (SEC-OPS-2) rotates it too, which costs every running session a restart — acceptable when a person asked for it, which is why core restarting never does. DECISIONS.md D33. |

### WebSocket — SEC-WS
| Id | Control |
|---|---|
| SEC-WS-1 | Upgrade accepted only with a valid `Host`, an allowed `Origin`, and a **single-use ticket** in the first frame within 2 s; otherwise close `1008`. The ticket is minted by `POST /pty-ticket` (authenticated with the token server-side, SEC-HTTP-3), is bound to one PTY target, expires in 10 s and is burnt on presentation — so the per-boot token never enters the browser (D32). Nothing is spawned before the ticket is redeemed. |
| SEC-WS-2 | One connection = one PTY, bound at handshake to a session id or shell request. No frame can retarget it. Max frame 1 MB; ping every 30 s; close after 30 min idle. |
| SEC-WS-3 | PTY input is accepted **only** over an authenticated WebSocket. No HTTP route writes to a PTY. Attach exclusivity is enforced server-side, not trusted from the client. |

### Ingress from Claude Code — SEC-ING
| Id | Control |
|---|---|
| SEC-ING-1 | Hook and statusline payloads are **untrusted data**: validated by zod schemas in `contracts/`, size-limited, never executed, never used to build a command or a path. `session_id` must match the UUID pattern; `cwd`/`transcript_path` must resolve under an allowlisted root before use. |
| SEC-ING-2 | Hooks authenticate with the token via the hook `headers` field. Core acks in < 5 ms and processes asynchronously so a slow core can never slow a session. |
| SEC-ING-3 | `statusline.py` changes are additive and marker-delimited so Disconnect removes exactly what Connect added: read the token file, POST with a **25 ms connect timeout and a 150 ms read timeout**, swallow every exception, output byte-identical. The token file is also the liveness check — no token, no connection attempt. It never reads anything else Flightdeck writes. Two timeouts, not one: a connect to a closed loopback port is not refused to Python on this machine, it is dropped, so a single 150 ms budget would charge every render the full 150 ms whenever core is down (RESEARCH.md F.3.3). |

### Processes — SEC-PROC
| Id | Control |
|---|---|
| SEC-PROC-1 | **No shell strings.** `spawn`/`execFile` with argument arrays only; `exec`, `execSync`, `shell: true` are lint errors. PowerShell is invoked with `-EncodedCommand` whose script calls one **allowlisted profile function** and reads the prompt and name from **environment variables** (`FD_PROMPT`, `FD_NAME`) — user text never enters a command string. |
| SEC-PROC-2 | Allowlists: profile functions `{claude-365, claude-isg, claude-isg-ticket, claude-isg-orch}`; flags from a fixed set (`--bg`, `-n`, `--resume`, `--fork-session`, `-w`, `--model`, `--agent`, `--effort`, `--permission-mode`, `--add-dir`, `-p`, `--output-format`, `--json-schema`, `--max-budget-usd`, `--max-turns`); binaries by absolute path resolved once at start (`claude.exe` from the npm shim target, `wt.exe` from the AppX package). `--agent`'s VALUE is allowlisted too (P9-T1): `[a-z0-9-]{1,64}` and on the roster of the project the session starts in (`.claude/agents/*.md`, read fresh at save and again at launch), never on `claude-isg-orch`, which pins its own; it reaches the script as `$env:FD_AGENT`, never composed in. |
| SEC-PROC-3 | Every launch, stop, rm, respawn, resume, adopt, take-over, pop-out and settings write appends an **audit row** (timestamp, action, target, arguments, outcome). Audit rows are visible in the UI. |
| SEC-PROC-4 | Ask runs always carry `--max-budget-usd` (default 2, ceiling 20) and `--max-turns`; a request outside either bound is **refused, not clamped** — a cap that silently lowers a request runs something nobody asked for. Ask never runs with `--dangerously-skip-permissions`. **Enforced by not going through a profile function** (P4-T4, D47): all four pass that flag unconditionally, and `--permission-mode` beside it is not refused but SILENTLY IGNORED — measured on all three values (RESEARCH.md F.9.3) — so through a function this control is unenforceable by construction and the permission-mode picker would be a dropdown that does nothing. Ask spawns `claude.exe` with `CLAUDE_CONFIG_DIR` set, as `stop`, `rm` and `resume` already do. `bypassPermissions` is **absent from `ASK_PERMISSION_MODES`**, so the control is a type rather than a rule: a value the deck cannot send is a run core cannot be asked for, and a body naming it takes the safe default (`plan`) rather than being honoured. The deck prints the mode the run REPORTED, off its `system/init` record, so a regression that routed Ask back through a function is visible on screen rather than only in an argv. |
| SEC-PROC-5 | Core never touches ports 4200/4201 or any process it did not start, except through the `claude` CLI verbs — **and one stated exception (P6-T8, D63)**: `POST /sessions/takeover` ends an interactive session's `claude.exe` tree with `taskkill /PID <pid> /FI "IMAGENAME eq claude.exe" /T /F`. The pid is read from `claude agents --json --all` at the moment of the request, never from the request or a remembered sweep; only an explicit `kind: interactive` with `status: idle` and a known folder qualifies, each checked before anything is ended; the image filter leaves a reissued pid alone, and success is read from `ProcessProbe`, not taskkill's exit code (RESEARCH.md G.60). The deck arms the control behind a warning, and every attempt is audited. |

### Filesystem — SEC-FS
| Id | Control |
|---|---|
| SEC-FS-1 | **Read allowlist**: the two config dirs (`sessions/`, `jobs/`, `projects/`, `history.jsonl`, `settings.json`, `keybindings.json`, `daemon.log`) and imported project folders. `daemon/roster.json` is allowlisted **by field, not as a file**: only `proto`, `supervisorPid`, `updatedAt` and `workers.<id>.{pid,sessionId,cwd,startedAt,cliVersion}` may be read — the three top-level fields are named because D24 justifies keeping this file allowlisted at all on `supervisorPid`, and the list previously forbade the one field its own rationale depended on (RESEARCH.md F.7.7), and the parse discards everything else before the value leaves the adapter — `FsRosterSource` (P1-T14), which **derives the path from a `SubscriptionId`** and accepts none, screens it through `ReadPolicy` anyway, and returns only `projectRoster`'s allowlist. What is not narrowed, and the code says so: the file is read whole, because there is no way to read half a JSON document — the narrowing is about what leaves the adapter, not what `readFileSync` touches. Paths are canonicalised with `realpath`, must be directories/files under a root, and are rejected if they contain `..` after normalisation or resolve through a junction outside the root. Sessions are addressed by id, never by client-supplied path. **Imported project folders are P3-T1**, and the four checks above are where they are enforced: `ProjectImport` (domain) screens what was typed before any syscall and screens what `realpath` returned afterwards, refusing a relative path, a `..`, a file, and a folder that is, is under, or *contains* a config directory; `FsPathCanonicaliser` is the only thing that resolves one; and `ProjectRegistry.resolve` composes them, so a path under a project is canonicalised **before** it is screened — the only order that catches a junction out of the root, measured against a real one in `tests/win/project-junction.test.ts` (RESEARCH.md G.25). A project root carries a **different rule set** from a config directory — allowed unless the deny-list takes it, rather than refused unless named — and D36 is the argument; what makes that safe is that a path under a config directory is screened by the config-directory rules first, whatever else contains it. **The registry ships empty, nothing scans the disk, and it grows only by an explicit `POST /projects`** (D26), which writes an audit row whether it is taken or refused, as does `POST /projects/forget` — the allowlist can be narrowed as well as widened (SEC-PROC-3, and the SEC-OPS-2 argument). **Installed plugins are P9-T5, one allowlisted subtree per config dir, read-only:** `plugins\installed_plugins.json` by name (on both lists — a file, and a `.json` the deny rule would otherwise take), and under `plugins\cache\<marketplace>\<plugin>\<version>\` exactly six patterns — the `agents`, `commands` and `skills` directories, `agents\*.md`, `commands\*.md` and `skills\*\SKILL.md` — which are the three asset shapes a project's own `.claude` has. Nothing else in an install is readable (a plugin is a whole repository: `src\`, `package.json`, `plugin.json`), and **`plugins\marketplaces\` is not read at all**: it is a clone of every plugin ever published, not what is installed. `PluginAssetReader` sends every path — the index, each directory, each head — through the registry's `resolve`, so an `installPath` pointing anywhere else resolves to a refusal and contributes nothing; which installs apply (`user` everywhere, `project`/`local` only where `projectPath` is the project being mapped) is decided after the policy, never instead of it (`tests/core/domain/read-policy-plugins.test.ts`, `tests/core/application/plugin-asset-reader.test.ts`). So is **enablement**, which opens nothing new: `enabledPlugins` from the config dir's already-allowlisted `settings.json` and the project's `.claude\settings.json` and `.claude\settings.local.json` (project files, under the project rule set), local over project over user per id, through the same `resolve` (`contracts/plugin-enablement.ts`). |
| SEC-FS-2 | **Never read**: `sessions/*.key`, `daemon/*.key`, `daemon/control.key`, `.credentials*`, `*.json` under `$CFG` not on the allowlist, and — inside the one allowlisted `daemon/roster.json` — the fields `rvAuth`, `ptyAuth` and `dispatch`. The first two are 32 hex characters of pipe auth, equivalent to the `.key` files above; `dispatch` carries full prompt text (RESEARCH.md F.2.10). Never read, never logged, never served. **The file half is `core/domain/read-policy.ts` (P1-T12)**: `ReadPolicy` holds SEC-FS-1's allowlist and this deny-list, and `TranscriptReader` asks it before a reported `transcript_path` is ever opened — attribution by `SubscriptionPaths` proves only *whose* config dir a path is under, so a hook payload naming `daemon\control.key` as its transcript had passed that check and would have been parsed into a digest the deck displays. The field half is the roster adapter (P1-T14). A deny-list check runs before every open, and a test asserts it. |
| SEC-FS-3 | **Writes into `$CFG`** are limited to `settings.json` (hooks + statusLine merge) and `keybindings.json`, each: parse → validate structure → back up (`*.bak-<timestamp>`) → write temp → atomic rename. Refuse if the file is not valid JSON or has an unexpected top-level shape. **Re-print in the file's own line endings, indent and trailing-newline convention** — the two config dirs disagree (365 is LF, isg is CRLF) and `JSON.stringify` always emits LF, which turned an additive merge into a whole-file rewrite of one of them (RESEARCH.md G.13). Everything else Flightdeck writes lives under `%LOCALAPPDATA%\flightdeck\`. **There are three writers, not two** (P5a-T7): Connect, Disconnect, and the keyboard helper, which is the narrowest of them. It touches one file per subscription, whose entire content it re-prints from a parse; it writes only the four key/value pairs in `RECLAIMED_KEYS` and removes exactly those, by VALUE, so a binding the owner later put on one of the same keys survives a restore; and it is reached through a GET that computes the plan and a POST that cannot be given a path, contents or a key — only a direction from a closed union. A file it cannot parse is refused, and ONE refusal fails the whole plan, because a Ctrl+T that moved on one subscription and not the other is worse than one that did not move: it is unpredictable per session. |
| SEC-FS-4 | **`%LOCALAPPDATA%\flightdeck\` and everything in it carry an ACL for the current user only** — the token, the ingest key and the SQLite store. Set by **core at boot** (`buildCore` → `restrictDataDirectory`, before the store is opened), not by the installer: a machine that never ran an installer still gets it, and it is the first thing core does rather than something a separate step could be skipped for. The grant is on the **directory**, inheritable (`/inheritance:r /remove:g *S-1-5-18 /remove:g *S-1-5-32-544 /grant:r *<SID>:(OI)(CI)F`), because SQLite creates `flightdeck.db-wal` and `-shm` *after* anything could have restricted the database and the WAL holds the most recently committed rows; the token file also gets its own explicit ACE when it is written. **By SID, never by `%USERNAME%`** — on a machine whose computer name equals the account name, `icacls` resolves a bare name to the computer, grants an empty account, exits 0, and leaves a file its own owner cannot read (RESEARCH.md F.7 / tests/win/token-file.test.ts). `/inheritance:r` alone is not enough where the parent's ACEs are explicit, which is why SYSTEM and Administrators are removed by SID as well. Checked by `doctor` on all four paths, which reads the ACL back rather than assuming the write worked. Honest limit: an Administrator can take ownership and rewrite any DACL; this makes elevation a deliberate act, not a free one. |

### Data, logs, UI — SEC-DATA / SEC-UI
| Id | Control |
|---|---|
| SEC-DATA-1 | The SQLite store holds transcript **excerpts and the FTS index**, i.e. the same sensitivity as the transcripts. It is never copied into the repo, fixtures, or any cloud. Beside them, since P7-T2, the **names** of the tools each session called (`transcript_tools`) — never a tool's input, which holds the command or the file and is not read (contracts/transcript-tools.ts). |
| SEC-DATA-2 | **Redaction** before any log line or fixture: bearer tokens, `sk-ant-*`, `Authorization` headers, `.key` contents, anything matching `(?i)(secret\|token\|password\|api[_-]?key)\s*[:=]`. Logs are local files under `%LOCALAPPDATA%\flightdeck\logs`, rotated, 14 days. |
| SEC-DATA-3 | SQL is parameterised. No string-built queries. |
| SEC-FS-5 | **A pasted image is the one byte stream the page may put on disk** (P5a-T8), and every degree of freedom is taken away from it. It lands in `%LOCALAPPDATA%\flightdeck\pasted\`, which is inside the directory SEC-FS-4 has already restricted to this user — never `$CFG`, never a project, never a path from the request. **Core names the file, the client never does**: `PasteInbox.nextName` builds it from a timestamp, a counter and an extension this project chose from the kind, so no character the browser supplied reaches a name — which matters because the path is handed back and then typed into a live session as text. **The kind is verified against the bytes**, not taken from the claim: `PastedImage` refuses a body whose first bytes are not a PNG, JPEG, GIF or WebP header, so a `.png` there is a PNG. Decoded size is capped at 6 MB and the transfer at 8 MB (SEC-HTTP-4); the directory keeps its newest 64 files and trims on write, so it cannot grow without bound. Written temp-then-rename, so nothing ever opens a half-written image. **Nothing here writes to a PTY** — the route answers with a path and the page types it over the socket bound to that pane, which keeps SEC-WS-3 whole. |
| SEC-UI-1 | Strict **CSP**, issued per request by `proxy.ts` (not `next.config.ts` — it carries a nonce, and not `middleware.ts` — only proxy runs on Node, D27): `default-src 'self'; script-src 'self' 'nonce-<per-request>' 'strict-dynamic'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' ws://127.0.0.1:4950; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'`. **The nonce and `'strict-dynamic'` are not a relaxation of the flat `script-src 'self'` this row used to name — they are what makes it work at all**: without them Next's own hydration scripts are blocked, the page renders and never hydrates, and the only evidence is a minified React #412 (RESEARCH.md F.5.1). `'unsafe-inline'` on styles is xterm.js writing cursor and selection geometry, which cannot execute script. Plus `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy: clipboard-read=(self)` and `Cache-Control: no-store` from `next.config.ts`, on documents only — `contracts/deck-routes.ts` carries why. |
| SEC-UI-2 | **Model-generated text is displayed, never interpreted**: React text nodes only; `dangerouslySetInnerHTML` is banned; URLs from transcripts are shown as text, not links, unless they match an allowlisted scheme and host; ANSI is rendered by xterm.js, never by hand. |

### Operations — SEC-OPS
| Id | Control |
|---|---|
| SEC-OPS-1 | **`npm run doctor`** (`scripts/doctor.ts` decides, `scripts/doctor-cli.ts` looks things up) verifies, in sixteen checks: Node satisfies `engines`; `claude.exe` is found and answers `--version`; both ports are held on loopback **and nothing else** — a wildcard bind is a failure, not a note (RESEARCH.md G.6), and the deck's port is required once its logon task is registered (P8-T1); the ACL on the data directory, the token, the ingest key and the store (SEC-FS-4), read back from `icacls`; that `ReadPolicy` refuses every `.key` and `.credentials*` path SEC-FS-2 names **plus every one actually on the machine** — the named ones are listed whether they exist or not, so the check cannot pass by finding nothing; that the hooks and statusLine blocks match the template, by asking `Connector.plan` (the dry-run half of Connect by construction) whether anything is left to change; that both logon tasks exist, are neither elevated nor credential-backed (SEC-OPS-3), carry a `cmd /c` line that can actually start node (RESEARCH.md G.57), and which node each one runs; that the deck task has a `.next` build to serve; that `node:sqlite` still has FTS5, re-run because an older Node did not (D9); that the newest transcripts carry no record type this build has never seen (SPEC §8 R2 — the 15 most recently *written*, because that is where a new release shows up, not the largest); and that nothing has been dropped by the store or the audit log. `fail` exits non-zero; `warn` does not — an absent logon task or a core that is not running is not a broken control. **It writes nothing.** |
| SEC-OPS-2 | **Disconnect** removes the hooks and statusLine blocks from a subscription's settings (with backup) in one click, and withdraws the `FLIGHTDECK_TOKEN` user environment variable that carries the ingest key. It never asks whether core is running: a dead core is the likeliest reason somebody is running it. **Rotate token** regenerates the token and drops every WebSocket; it also rotates the ingest key (SEC-HTTP-7), which costs every running session a restart. |
| SEC-OPS-3 | Core and the deck run as the owner's user, never elevated. Both logon tasks (`Flightdeck Core`, and `Flightdeck Deck` since P8-T1 — the same definition with a different entry point and log) use "run only when user is logged on", no stored credentials — `<LogonType>InteractiveToken</LogonType>` and `<RunLevel>LeastPrivilege</RunLevel>`, registered by `npm run task:install` (dry run by default, `--apply` to write, as Connect is). **`doctor` checks this as the ABSENCE of `HighestAvailable`**, because Task Scheduler omits default values on export and a correctly registered task reads back with no `<RunLevel>` element at all (RESEARCH.md G.18) — the positive assertion failed against the task the installer had just written. A non-elevated shell cannot register an elevated task at all: `schtasks` answers `Access is denied`. The console window at logon is the price of this control, not an oversight: a window-less task has to store a credential. |

### Supply chain and CI — SEC-SUP
| Id | Control |
|---|---|
| SEC-SUP-1 | `package-lock.json` committed; CI installs with `npm ci`; `save-exact=true`. Runtime dependencies are few and named in BUILD-PLAN §… (`ws`, `node-pty`, `yaml`, `zod`, `toasted-notifier`, Next/React/Tailwind, xterm). |
| SEC-SUP-2 | CI fails on `npm audit --audit-level=high`, on `npm audit signatures` failures, on gitleaks findings, on dependency-review high severity (PRs), and CodeQL runs on every push and weekly. |
| SEC-SUP-3 | Dependabot for npm and GitHub Actions weekly; actions pinned by major tag and updated by Dependabot; workflow `permissions` are least-privilege (`contents: read` by default). |
| SEC-SUP-4 | No secrets in the repo, ever: no `.env`, no tokens in fixtures (scrubber), `gitleaks` in CI, `.gitignore` covers `fixtures/raw/`. The app needs no secrets — the token is generated at runtime. |
| SEC-SUP-5 | `main` is protected by the **`main` branch ruleset** (active, applied to the default branch, **bypass list empty — the repo admin included**): PR required with 0 approvals and thread resolution, linear history, no force-push, no deletion, merge methods limited to squash and rebase (merge commits are off at the repository level too). Required status checks, with **"branches must be up to date"** on: `Lint · types · format · roadmap · unit tests`, `Windows integration (ConPTY, paths, ACLs)`, `Audit · signatures · secrets · dependency review`, `Analyze JavaScript / TypeScript`. The up-to-date requirement is the one that matters most: on 2026-09-10 two Dependabot PRs that were each green against a stale base turned `main` red once both landed (D25). `Next.js build` is deliberately not required until the UI exists. |

---

## 3. Secure-coding rules (checked in every review)

1. Validate at the boundary with zod; everything from outside is `unknown` until it passes.
2. Argument arrays, parameterised SQL, canonicalised allowlisted paths, escaped text. Never
   interpolate user or model text into commands, SQL, paths, HTML or URLs.
3. Fail closed with a generic message; details go to the local log, redacted.
4. Constant-time comparison for tokens (`crypto.timingSafeEqual`).
5. Least privilege for every handle: read-only file opens, minimal env for child processes
   (only `CLAUDE_CONFIG_DIR`, `FD_*`, `PATH`, `USERPROFILE`, `APPDATA`, `LOCALAPPDATA`, `TEMP`).
6. One audit row per mutating action; one test per control id that can be tested.
7. Treat every transcript, hook payload and CLI output as attacker-influenced.

---

## 4. Phase checklist

| Phase | Controls that must be in place before the gate is declared |
|---|---|
| P0 | SEC-HTTP-1..5, SEC-WS-1 proven by the spike (P0-T7) |
| P1 | all SEC-NET, SEC-HTTP (incl. SEC-HTTP-7, P1-T11), SEC-ING, SEC-FS-1..3, SEC-DATA-1..3, SEC-OPS-1..2, SEC-SUP-1..4 |
| P2 | SEC-UI-1, SEC-UI-2 |
| P3-T1 | SEC-FS-1's imported project folders — all four checks, D26 and D36 |
| P4 | SEC-PROC-1..5 |
| P5 | SEC-WS-2, SEC-WS-3, SEC-FS-3 for keybindings |
| P5a-T8 | SEC-FS-5, and the `paste` row of SEC-HTTP-4 / -6 |
| P1-T12 | SEC-FS-4, SEC-OPS-3 |
| P8 | SEC-NET-1 re-proven by `netstat` with the proxy up; SEC-NET-3; SEC-HTTP-1, SEC-HTTP-2 and SEC-WS-1 asserted against the remote pair by the P0-T7 probe; SEC-OPS-3 for the deck's logon task (P8-T1) |
| P7-T5 | SEC-NET-1 (no new bind — the receiver is two routes on core's port, absent unless `FLIGHTDECK_OTLP=1`); SEC-HTTP-4 (`application/json` only, the ingest caps); SEC-HTTP-7 for the two OTLP routes; SEC-FS-3 (nothing written into `$CFG`) |
| P9 | SEC-PROC-1..3 for `--agent` from the roster (P9-T1); SEC-FS-1 and SEC-UI-2 for the ticket picker (P9-T3): two directory listings under an imported root, names only, screened against `TICKET_SHAPE` in core and again in the deck before a `<datalist>` draws them; SEC-FS-1 and SEC-FS-2 for the `plugins\cache\` subtree (P9-T5) |

---

## 5. Incident response (single-user, local)

1. **Suspected token leak** → `Rotate token` (or restart core). All sessions stay running.
2. **Suspicious launch in the audit log** → `claude stop <id>` from the deck, then review the
   audit row's arguments and the hook payloads around that time.
3. **A hook misbehaves or Claude Code changes shape** → `Disconnect` both subscriptions; the
   deck falls back to the 10 s reconciler and keeps working read-only.
4. **Dependency advisory** → Dependabot PR; if high/critical with a runtime path, update the same
   day; `npm audit` blocks releases anyway.
5. Record what happened in `DECISIONS.md` if a control changes as a result.

## 6. Reporting

**Public** repository, single maintainer (DECISIONS.md D23). The app needs no secrets — the
bearer token is generated per boot at runtime (SEC-HTTP-3), `fixtures/raw/` is git-ignored, every
committed fixture is scrubbed, and the transcripts and SQLite store never leave the machine
(SEC-DATA-1). Findings go into a GitHub issue labelled `security`; anything involving transcript
content is described, not pasted — in a public issue tracker that rule is absolute.
