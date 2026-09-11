# Flightdeck — coding standards

**Three goals, in the owner's words: object-oriented, readable, scalable, maintainable.** This document
turns them into rules a linter can enforce and a reviewer can point at. Where a rule is enforced
by a tool, the tool is named; the PR checklist covers the rest.

Enforced automatically: `npm run check` = ESLint (strict, type-aware) + `tsc --noEmit` + Prettier +
roadmap validation + Vitest. CI runs the same command. A PR that fails any of them is not reviewed.

---

## 1. What the three words mean here

**Readable** — a new reader understands a file in one pass.
- One class per file, named after the class. A file is ≤ 250 lines, a method ≤ 40 lines, a
  class ≤ 200 lines. *(ESLint `max-lines`, `max-lines-per-function`)*
- Cyclomatic complexity ≤ 10, nesting ≤ 3, ≤ 4 parameters (pass an options object or a value
  object beyond that). *(ESLint `complexity`, `max-depth`, `max-params`)*
- Names say what, not how: `SessionReconciler`, not `Manager`, `Helper`, `Utils`, `Handler2`.
- No clever code. If it needs a comment to be understood, rewrite it; if it still needs one,
  the comment says *why*, never *what*.

**Scalable** — adding a feature means adding a class, not editing ten.
- Dependencies point inward (§2). Domain code knows nothing about HTTP, files, processes or
  Claude Code's CLI.
- Every external thing is behind a **port** (an interface). New sources, sinks and shells are
  new **adapters**; nothing else changes.
- Events are the spine: adapters emit typed events, the domain reacts. No adapter calls another.

**Maintainable** — a change six months from now is safe.
- Every class has a unit test with fakes, not mocks (§10). Every observed external shape has a
  fixture (§10.3).
- Errors are typed and carry a code (§6). Nothing swallows an error silently.
- Strict TypeScript (§4): `any` is banned, indexes are checked, optional means optional.

---

## 2. Architecture: layers and the dependency rule

```
core/
├─ domain/        entities, value objects, state machine, domain events   ← imports nothing outside domain/ and contracts/
├─ application/   use cases / services that orchestrate domain + ports    ← imports domain, ports, contracts
├─ ports/         interfaces only (SessionSource, EventSink, ProcessRunner, Clock, Store, Notifier, PtyHost)
├─ adapters/      one folder per external thing: claude-cli/, hooks/, statusline/, transcript/, sqlite/, node-pty/, windows/
├─ http/          server, routes → controllers → use cases; security middleware
├─ shared/        tiny pure helpers only (Result, TypedError, time formatting). No IO. No state.
└─ main.ts        composition root: constructs adapters, injects them, starts the server
contracts/        types + zod schemas shared by core and UI (the only code both import)
app/              Next.js views (see §5)
```

**The dependency rule:** an import may only point *inward*: `http → application → domain`,
`adapters → ports/domain`, never the reverse. `domain/` may not import `node:*`, `ws`,
`node-pty`, `node:sqlite` or anything under `adapters/` or `http/`. *(ESLint
`no-restricted-imports` per folder)*

**Composition root:** `main.ts` is the only place that does `new SomeAdapter(...)` for real
adapters and wires them into use cases. No DI framework, no service locator, no globals.
Constructor injection everywhere.

---

## 3. Object-oriented rules

| # | Rule | Enforced by |
|---|---|---|
| R1 | **Every unit of behaviour is a class with one responsibility.** If you cannot name it with one noun, split it. | review |
| R2 | **Program to interfaces.** Every port is an `interface`; use cases depend on the interface, never on an adapter class. | review, `no-restricted-imports` |
| R3 | **Constructor injection only.** Dependencies arrive as constructor parameters and are stored in `private readonly` fields. No `new` of a collaborator inside a class except value objects and errors. | review, `prefer-readonly` |
| R4 | **Composition over inheritance.** Inheritance only for a true is-a with one abstract base and one level. Prefer strategy objects and small collaborators. | review |
| R5 | **Encapsulate state.** Fields are `private` or `private readonly`; no public mutable fields; no setters. State changes through intention-revealing methods (`session.markWaiting(reason)`, not `session.status = 'waiting'`). | `explicit-member-accessibility` |
| R6 | **Value objects are immutable.** `readonly` fields, no mutators, equality by value (`equals()`); construct through a validating static factory (`SessionId.parse(text)`). | `prefer-readonly` |
| R7 | **Entities own their transitions.** The `Session` state machine lives in `domain/`, as methods that return the next state or a typed error, table-tested. | tests |
| R8 | **No static utility bags.** A class with only static members is a smell (`no-extraneous-class`); pure helpers live in `shared/` as plain exported functions, small and side-effect free. | `no-extraneous-class` |
| R9 | **Explicit member accessibility and return types** on everything public. | `explicit-member-accessibility`, `explicit-function-return-type` |
| R10 | **Member order:** static fields, instance fields, constructor, public methods, private methods. | `member-ordering` |
| R11 | **Named exports only.** No `export default` outside framework-required files (`app/**/page.tsx`, `layout.tsx`, `*.config.*`). | `no-restricted-syntax` |
| R12 | **Discriminated unions for events and results**, exhaustively switched. | `switch-exhaustiveness-check` |
| R13 | **Interfaces are nouns without an `I` prefix**; implementations say how: `SessionSource` ← `ClaudeCliSessionSource`, `FakeSessionSource`. | `naming-convention` |
| R14 | **No `enum`** (not erasable syntax; also a runtime object). Use `type Status = 'todo' \| 'done'` plus a `readonly` tuple of allowed values when iteration is needed. | `erasableSyntaxOnly`, `no-restricted-syntax` |
| R15 | **A class does not know what called it.** No `if (caller === 'ui')` branches; polymorphism or a strategy instead. | review |

### React is not exempt from OOP — it is the view layer

React components are functions by framework design. The rule is therefore **zero business logic
in components**:

- Every screen has a **ViewModel class** (`DeckViewModel`, `SessionRowViewModel`) that owns
  derivation, sorting, formatting decisions and commands. Components render a view model's
  fields and call its methods. View models are unit-tested without React.
- Client state lives in **store classes** (`DeckStore`) that subscribe to core's SSE stream and
  expose immutable snapshots; a thin hook (`useDeckStore()`) bridges to React via
  `useSyncExternalStore`.
- Components are ≤ 150 lines, typed props, no `useEffect` for data transformation, no fetch
  calls (the store does it), no `dangerouslySetInnerHTML` (§11).
- Formatting (durations, money, tokens, percentages) lives in `Formatter` classes in
  `contracts/` so core and UI print the same thing.

---

## 4. TypeScript rules

`tsconfig.json` is strict plus: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
`noImplicitOverride`, `noImplicitReturns`, `noFallthroughCasesInSwitch`,
`noPropertyAccessFromIndexSignature`, `useUnknownInCatchVariables`, `verbatimModuleSyntax`,
`isolatedModules`, **`erasableSyntaxOnly`** (so `core/` runs on Node 26 with no build).

- **No `any`.** Unknown input is `unknown` and narrowed by a zod schema or a type guard at the
  boundary (§11).
- **No non-null assertions (`!`)**, no `as` casts except `as const` and narrowing after a
  guard. If a cast feels necessary, the type is wrong.
- **Prefer `readonly`** arrays and fields; return `readonly T[]` from queries.
- **Relative imports carry the `.ts` extension** (`import { Session } from '../domain/session.ts'`)
  because Node's type stripping needs them. `import type` for types.
- **No parameter properties, no enums, no namespaces** (not erasable).
- Public API of every class has JSDoc explaining the *why* and the contract (thrown errors,
  units, ordering guarantees).

---

## 5. Next.js and UI rules

- The UI never talks to `claude.exe`, the filesystem or child processes. It talks to core.
- All HTTP goes through the same-origin rewrite; WebSocket goes to core with the token (§11).
- Security headers and a strict CSP are set in `next.config.ts` (SECURITY.md SEC-UI-1).
- Fonts are self-hosted; no third-party scripts, analytics, or CDNs at runtime.
- Tailwind for layout and spacing; semantic colours only through tokens defined once.
- Every interactive element is keyboard reachable and has a visible focus state.

---

## 6. Errors

- `shared/typed-error.ts` defines `abstract class FlightdeckError extends Error` with a
  `readonly code: string` and `readonly details?: Record<string, unknown>`. Every thrown error
  is a subclass: `InvalidTokenError`, `SessionNotFoundError`, `ProcessTimeoutError`…
- **Expected failures return `Result<T, E>`** (`shared/result.ts`) — parsing, lookups,
  validation. **Bugs throw.** A use case never `catch`es a bug to keep going.
- Adapters translate foreign errors into typed ones at the boundary; nothing above adapters
  sees a raw `Error` from `node:fs` or `ws`.
- Log with structure (`{ code, sessionId, subscription }`), never by string interpolation of a
  payload. Secrets are redacted before logging (SECURITY.md SEC-DATA-2).

---

## 7. Async and processes

- No floating promises (`no-floating-promises`, `no-misused-promises`). Fire-and-forget is
  written explicitly with `void this.queue.push(...)` and a comment on why.
- Every external call takes an `AbortSignal` and has a timeout. `agents --json` = 5 s;
  hook ack < 5 ms (queue, then return); statusline POST 150 ms.
- Child processes: `spawn`/`execFile` with an **argument array**. `exec`, `execSync` and
  `shell: true` are banned (`no-restricted-syntax`). Prompt text never enters a command string
  (SECURITY.md SEC-PROC-1).
- Long-lived resources (watchers, PTYs, DB handle, timers) are owned by one class that
  implements `Disposable` and is disposed by the composition root on shutdown.

---

## 8. Naming and files

| Thing | Convention | Example |
|---|---|---|
| File | kebab-case, one class per file, named after the class | `session-reconciler.ts` |
| Class / type / interface | PascalCase, no `I` prefix | `SessionReconciler`, `SessionSource` |
| Method / variable | camelCase, verbs for methods, `is/has/can` for booleans | `reconcile()`, `isRetired` |
| Constant | UPPER_CASE only for true module constants | `RECONCILE_INTERVAL_MS` |
| Test | `<file>.test.ts` next to a `tests/` mirror of the source tree | `tests/core/application/session-reconciler.test.ts` |
| Fixture | `fixtures/<source>/<shape>.json`, scrubbed | `fixtures/agents/background-done.json` |
| Ids | domain value objects, never bare strings across a boundary | `SessionId`, `SubscriptionId` |

No abbreviations except `id`, `cwd`, `pty`, `url`, `json`. `configDir`, not `cfg`.

---

## 9. Comments and documentation

- **Why, not what.** A comment explains a constraint, a trade-off, or a surprising fact with a
  pointer (`// daemon retires idle sessions — RESEARCH.md B.3`). Narrating code is deleted.
- Public classes and methods carry JSDoc; private ones do not unless the why is non-obvious.
- Architecture decisions go in `DECISIONS.md` as a new `D-n`, never in a code comment.
- Every observed-shape parser links the RESEARCH.md section it was derived from.
- `TODO` is only allowed with a roadmap task id: `// TODO [P3-T7]: …`.

---

## 10. Testing standard

### 10.1 Unit tests (Vitest)
- One test file per class. Test behaviour through the public API only.
- **Fakes, not mocks.** For every port there is a `Fake*` class in `tests/fakes/` with an
  in-memory implementation (`FakeClock.advance(ms)`, `FakeProcessRunner.willReturn(...)`).
  Mocking libraries are not used; spying on a real class is a smell.
- Table tests for the state machine: `(currentState, event) → (nextState, flags)`.
- Coverage gates (enabled in P1-T13): `core/domain` ≥ 95 %, `core` ≥ 80 %, `contracts` ≥ 90 %.

### 10.2 Integration tests
- `tests/win/**` runs on `windows-latest` in CI: node-pty spawn/resize, path handling, ACLs.
- Adapters are tested against fixtures, never against the live `claude.exe` in CI.

### 10.3 Fixtures
- Captured with `scripts/capture-fixtures.mjs`, which keeps structure and replaces every string
  longer than 12 characters with a deterministic placeholder. **Raw transcripts and hook payloads
  never enter the repo** (`fixtures/raw/` is git-ignored).
- Each fixture records the Claude Code version it came from; `scripts/doctor` diffs shapes after
  `claude update`.

### 10.4 UI
- View models and stores: unit tests without React.
- Playwright smoke: deck loads from a fixture SSE stream, rows render, palette opens, a pane
  mounts against a fake PTY echo server.

---

## 11. Security rules that are also coding rules

Full policy in `SECURITY.md`; these are the ones a reviewer checks in every diff:

1. **Validate at the boundary.** Every HTTP body, WebSocket frame, hook payload, statusline
   payload, CLI output and file read is `unknown` until a zod schema in `contracts/` accepts
   it. Reject, don't coerce.
2. **Never interpolate user or model text into a command, path, SQL or HTML.** Arguments go in
   arrays; SQL uses parameters; paths are canonicalised and checked against the allowlist;
   React escapes text — `dangerouslySetInnerHTML` is banned.
3. **Model-generated text is untrusted.** Away summaries, titles, prompts and tool inputs are
   displayed as text, never interpreted, never used to build a command or a link.
4. **Secrets never reach logs, fixtures, the UI, or git.** The token, `.key` files, credentials
   and anything matching the redaction patterns are filtered before write.
5. **Every mutating action writes an audit row** (who = token id, what, target, when, outcome).
6. **Fail closed.** Missing token, unknown Origin, oversize body, unparseable JSON → reject
   with a generic message; details go to the local log only.

---

## 12. Git and review

- **Branches:** `main` is protected (CI green required, no force-push). Work on
  `feat/P3-T3-workflow-map`, `fix/P1-T5-hook-ack`, `chore/...`.
- **Commits:** Conventional Commits with the roadmap task id in brackets:
  `feat(core): reconciler sweep with stat-poll nudge [P1-T4]`. Small, single-purpose commits.
- **PRs:** ≤ 400 changed lines where possible; the template checklist must be complete; the
  roadmap `status` is updated in the same PR that finishes a task.
- **Review looks for**, in order: a security rule broken (§11), the dependency rule broken (§2),
  a class doing two things (R1), a missing test or fixture (§10), a name that lies (§8).

---

## 13. Definition of done (per task)

- [ ] Behaviour covered by unit tests with fakes; fixtures added for any new external shape
- [ ] `npm run check` green locally and in CI (lint, types, format, roadmap, tests)
- [ ] No new `any`, `!`, `as`, `export default`, `exec`, `shell: true`
- [ ] Security rules in §11 satisfied; the relevant `SEC-*` control referenced in the PR
- [ ] Public API documented (JSDoc with the why)
- [ ] `ROADMAP.yaml` task status updated; `DECISIONS.md` updated if a decision was made
- [ ] No TODO without a task id; no console output outside `scripts/` and `main.ts`

---

## 14. Worked example — the pattern every feature follows

```ts
// core/ports/session-source.ts
import type { SubscriptionId } from '../../contracts/subscription.ts';
import type { LiveSessionRecord } from '../../contracts/session.ts';

/** Anything that can list the live sessions of one subscription. */
export interface SessionSource {
  list(subscription: SubscriptionId, signal: AbortSignal): Promise<readonly LiveSessionRecord[]>;
}
```

```ts
// core/adapters/claude-cli/claude-cli-session-source.ts
import type { ProcessRunner } from '../../ports/process-runner.ts';
import type { SessionSource } from '../../ports/session-source.ts';
import type { SubscriptionId } from '../../../contracts/subscription.ts';
import { liveSessionListSchema, type LiveSessionRecord } from '../../../contracts/session.ts';
import { ClaudeCliError } from './claude-cli-error.ts';

/**
 * Lists sessions with `claude agents --json` under the subscription's CLAUDE_CONFIG_DIR.
 * Costs ~760 ms per call (RESEARCH.md B.2) — callers schedule it, never loop it.
 */
export class ClaudeCliSessionSource implements SessionSource {
  private static readonly TIMEOUT_MS = 5_000;

  private readonly runner: ProcessRunner;
  private readonly configDirs: ReadonlyMap<SubscriptionId, string>;

  constructor(runner: ProcessRunner, configDirs: ReadonlyMap<SubscriptionId, string>) {
    this.runner = runner;
    this.configDirs = configDirs;
  }

  public async list(subscription: SubscriptionId, signal: AbortSignal): Promise<readonly LiveSessionRecord[]> {
    const configDir = this.configDirs.get(subscription);
    if (configDir === undefined) throw new ClaudeCliError('unknown_subscription', { subscription });

    const result = await this.runner.run({
      file: 'claude.exe',
      args: ['agents', '--json'],
      env: { CLAUDE_CONFIG_DIR: configDir },
      timeoutMs: ClaudeCliSessionSource.TIMEOUT_MS,
      signal,
    });
    const parsed = liveSessionListSchema.safeParse(JSON.parse(result.stdout));
    if (!parsed.success) throw new ClaudeCliError('unexpected_shape', { issues: parsed.error.issues });
    return parsed.data;
  }
}
```

```ts
// tests/core/adapters/claude-cli/claude-cli-session-source.test.ts
import { describe, expect, it } from 'vitest';
import { ClaudeCliSessionSource } from '../../../../core/adapters/claude-cli/claude-cli-session-source.ts';
import { FakeProcessRunner } from '../../../fakes/fake-process-runner.ts';
import agentsInteractive from '../../../../fixtures/agents/interactive-two.json';

describe('ClaudeCliSessionSource', () => {
  it('parses the interactive listing shape', async () => {
    const runner = new FakeProcessRunner().willReturn({ stdout: JSON.stringify(agentsInteractive) });
    const source = new ClaudeCliSessionSource(runner, new Map([['isg', 'C:\\Users\\dev\\.claude-isg']]));

    const sessions = await source.list('isg', AbortSignal.timeout(1_000));

    expect(sessions).toHaveLength(2);
    expect(runner.lastCall?.env).toEqual({ CLAUDE_CONFIG_DIR: 'C:\\Users\\dev\\.claude-isg' });
  });
});
```

A port, an adapter that translates the outside world into a validated contract, a fake for the
test, and a use case (not shown) that depends only on the port. Every feature in Flightdeck is
built from this shape.
