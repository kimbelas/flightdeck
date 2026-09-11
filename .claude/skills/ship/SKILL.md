---
name: ship
description: Land a change on Flightdeck's protected main — branch naming, the roadmap status update that belongs in the same PR, commit format, the check gate and the PR. Use when finishing a task, opening a PR, or asked to commit or ship work here.
---

# Shipping a change

`main` is protected by a ruleset with an **empty bypass list** (D25). Nothing lands by pushing to
it, including one-line fixes and documentation. Everything is a PR.

## 1. Know which task this is

```bash
npm run roadmap
```

Work is tracked in `ROADMAP.yaml`, not in chat. **Read the task's `notes` before implementing
it** — they carry the decisions and the traps, and they are the reason a task looks smaller than
it is.

## 2. Branch

```bash
git checkout -b feat/P1-T4-short-name
```

`feat/` · `fix/` · `chore/` · `docs/`, then the task id, then a short name. No task id only when
there genuinely is not one.

## 3. Build it, then run it

`npm run check` being green is not evidence the change works. Six real bugs shipped past a green
unit suite and were only found by running the thing (RESEARCH.md §G) — including the one this
project keeps re-learning, that `next dev` never hydrates. Use the `run` skill and actually look
at the deck.

## 4. Update the roadmap in the same PR

A task's `status` is updated in the PR that finishes it, never in a follow-up. `npm run roadmap:check`
is part of the gate and will fail on a deliverable that does not exist.

## 5. The gate

```bash
npm run check
```

Lint, typecheck, format, roadmap validation, unit tests with coverage. It must be green **before**
the PR, not after review. On Windows expect `Error: AttachConsole failed` lines from node-pty's
console-list agent during the test run — they are noise from a child process, not a failure; the
run still exits 0.

## 6. Commit

```
feat(core): summary in the imperative [P1-T4]
```

Scope is the layer touched (`core`, `deck`, `contracts`, `run`, `ci`). The task id in brackets at
the end. Do **not** add a `Co-Authored-By` trailer — a commit-guard hook rejects the commit.

The body is for what the diff cannot say: why this shape, what was tried and rejected, what an
error taught you. The existing history is the model.

## 7. PR

```bash
gh pr create --fill
```

`.github/pull_request_template.md` is the checklist. Four checks are required and must all pass:
`Lint · types · format · roadmap · unit tests`, `Windows integration (ConPTY, paths, ACLs)`,
`Audit · signatures · secrets · dependency review`, `Analyze JavaScript / TypeScript`. Squash and
rebase merges are allowed, merge commits are not, and the branch is deleted on merge.

## Things that bite

- **Dependency bumps land as a set or not at all.** Two Dependabot PRs green in isolation turned
  `main` red together. Check `main`'s CI after each merge.
- **Banned in new code:** `any`, `!`, `as`, `export default`, `exec`, `shell: true`. ESLint
  enforces these; do not reach for a disable comment without a reason in the PR body.
- **The dependency rule** (CODING-STANDARDS §2): imports point inward only. `domain/` may not
  import `node:*`, `ws`, `node-pty`, or anything under `adapters/` or `http/`.
- **Never write to anything under `~/.claude*`** without showing the diff and backing the file up
  first. That is a live config on both profiles. `scripts/statusline-patch.ts` is the only
  sanctioned writer, and it is additive and reversible (SEC-ING-3 / SEC-OPS-2).
- **Fixtures are generated.** Never hand-edit one — see the `capture` skill.
