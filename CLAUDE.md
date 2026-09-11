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

## Rules that are easy to get wrong

- **Run it with `flightdeck.cmd`, not `npm run dev`.** Dev mode renders the deck and never
  hydrates (P2-T6b, RESEARCH.md G.3). Editing the deck means rebuilding.
- **`main` is protected with an empty bypass list** (D25). Everything lands by PR, including
  one-line fixes. Branch `feat/P1-T4-short-name`, commit `feat(core): summary [P1-T4]`.
- **`npm run check` must be green before the PR** — lint, typecheck, format, roadmap, tests.
- **The dependency rule** (CODING-STANDARDS §2): imports point inward only. `domain/` may not
  import `node:*`, `ws`, `node-pty`, or anything under `adapters/` or `http/`.
- **Banned in new code:** `any`, `!`, `as`, `export default`, `exec`, `shell: true`.
- **Only background sessions are attachable.** `claude attach` takes `--bg` sessions only, so an
  interactive session is permanently read-only in a pane (SPEC §5.2). This is a constraint to
  design around, not a bug to fix.
- **Never write to anything under `~/.claude*` without showing the diff first and backing the
  file up.** That is the owner's live config on both profiles; a bad write costs them working sessions.
  `scripts/statusline-patch.ts` is the only sanctioned writer, and it is additive and reversible
  (SEC-ING-3 / SEC-OPS-2).
- **Dependency bumps land as a set or not at all** — two Dependabot PRs green in isolation turned
  `main` red together. Check `main`'s CI after each merge.

## The standing lesson

Six real bugs shipped past a green unit suite and were only found by running the thing
(RESEARCH.md §G). Budget time for running it, not just for testing it.
