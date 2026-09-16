# Flightdeck — session brief

A control tower for every Claude Code session on this machine, across both subscriptions
(`~/.claude-365`, `~/.claude-isg`). Two loopback processes: `flightdeck-core` (plain Node,
127.0.0.1:4950) owns the PTYs, the WebSocket and the token; the deck (Next 16 / React 19,
127.0.0.1:4949) is the page. Two processes on purpose — see DECISIONS.md D2.

## Read before you build

| Doc | Answers |
| --- | --- |
| [ROADMAP.yaml](ROADMAP.yaml) | what to work on. **Read the task's notes before implementing it.** `npm run roadmap` |
| [SPEC.md](SPEC.md) | what it is and why (rev 3) |
| [BUILD-PLAN.md](BUILD-PLAN.md) | repo shape, data model, API contract |
| [CODING-STANDARDS.md](CODING-STANDARDS.md) | layering, OOP, tests — enforced by `npm run check` |
| [SECURITY.md](SECURITY.md) | threat model, `SEC-*` controls |
| [DECISIONS.md](DECISIONS.md) · [RESEARCH.md](RESEARCH.md) | why a thing is the way it is, with measurements |

Work is tracked in `ROADMAP.yaml`, not in chat. A task's `status` is updated in the same PR that
finishes it.

## Skills

Three procedures live in `.claude/skills/`, loaded on demand rather than read every session:
`run` (launching and verifying the app — it overrides the built-in fallback that would reach for
`npm run dev`), `ship` (branch, gate, roadmap update, commit, PR) and `capture` (the raw → scrubbed
fixture pipeline). The rules below are the summary; the skills are the procedure.

## Rules that are easy to get wrong

- **Run it with `flightdeck.cmd`.** That is the production bundle, which is what the owner uses.
  `npm run dev` hydrates again (P2-T6b) and is fine for editing — just never measure against it.
- **`main` is protected with an empty bypass list** (D25). Everything lands by PR, including
  one-line fixes. Branch `feat/P1-T4-short-name`, commit `feat(core): summary [P1-T4]`.
- **`npm run check` must be green before the PR** — lint, typecheck, format, roadmap, tests.
- **`npm run check` says nothing about the deck.** `app/**` is not in `coverage.include`. Touching
  anything under `app/` means `npm run build && npm run smoke` (P2-T7) — 101 checks against a
  fixture core, no real core or Claude session needed.
- **The dependency rule** (CODING-STANDARDS §2): imports point inward only. `domain/` may not
  import `node:*`, `ws`, `node-pty`, or anything under `adapters/` or `http/`.
- **Banned in new code:** `any`, `!`, `as`, `export default`, `exec`, `shell: true`.
- **Only background sessions are attachable.** `claude attach` takes `--bg` sessions only, so an
  interactive session is permanently read-only in a pane (SPEC §5.2). This is a constraint to
  design around, not a bug to fix.
- **Never write to anything under `~/.claude*` without showing the diff first and backing the
  file up.** That is the owner's live config on both profiles; a bad write costs them working sessions.
  `npm run connect` / `npm run disconnect` are the only sanctioned writers (P1-T11): dry run is the
  default, `--apply` is the opt-in, every file is backed up `*.bak-<timestamp>` before an atomic
  rename, and Disconnect restores byte for byte. Re-print JSON in the file's OWN line endings —
  365 is LF and isg is CRLF, and `JSON.stringify` turns that into a whole-file rewrite (G.13).
  The change is additive and reversible
  (SEC-ING-3 / SEC-OPS-2).
- **Dependency bumps land as a set or not at all** — two Dependabot PRs green in isolation turned
  `main` red together. Check `main`'s CI after each merge.

## The standing lesson

Six real bugs shipped past a green unit suite and were only found by running the thing
(RESEARCH.md §G). Budget time for running it, not just for testing it.
