// What Connect writes, and the shape of the answer it gives before it writes anything (P1-T11).
//
// In contracts/ because two sides have to agree: `ConnectPlanner` produces a plan and the CLI (and
// later the deck, D13) renders it. A plan is always computed in full and shown before a byte is
// written — SEC-FS-3 and D13 both say the owner sees the diff first, and the only way to keep that
// promise structurally is for computing and writing to be different objects.
import { CORE_PORT, LOOPBACK_ADDRESS } from './origins.ts';

/**
 * The environment variable the hooks block names, and the one the launcher exports (SEC-HTTP-7).
 *
 * It lives HERE rather than beside the key it carries, and that is a build constraint as much as a
 * tidiness one: `contracts/ingest-key.ts` reads the key off the disk, so it touches `node:fs` and
 * nothing under a `'use client'` boundary may import it — and since P4-T6 the deck imports this
 * module for real, to draw the Connect panel. The name needs no filesystem; the key does.
 *
 * Two sides have to agree on the spelling: what Connect writes into `settings.json` as
 * `${FLIGHTDECK_TOKEN}`, and what puts a value there. A name Claude Code does not find is
 * interpolated to the empty string rather than left alone (RESEARCH.md F.1.6), so a typo is a 401
 * rather than an error anyone can read.
 */
export const INGEST_KEY_ENV_VAR = 'FLIGHTDECK_TOKEN';

/** Where a hook posts. The one string Disconnect recognises its own handlers by. */
export const CORE_HOOKS_URL = `http://${LOOPBACK_ADDRESS}:${String(CORE_PORT)}/hooks`;

/**
 * The events Connect installs, and nothing else.
 *
 * Every one of them was verified to arrive over `http` against a real receiver on Claude Code
 * 2.1.269 (RESEARCH.md F.1.6). Three deliberate absences:
 *
 * - **`SessionStart`** — it fires, but the `http` transport does not carry it, on this version as
 *   on 2.1.267 (F.1.1). A `command` handler would collect it, and it is not installed anyway: the
 *   reconciler already learns of a new session from the 10 s sweep and `fs.watch` (D3 feeds 3 and
 *   5), so a handler here would be a second mechanism that has to be kept in agreement with the
 *   first, for news the first already has.
 * - **`PreToolUse` / `PostToolUse`** — they work, and they fire per tool call rather than per turn.
 *   Nothing in P1 or P2 reads them, and `tool_response` is the payload SEC-HTTP-4 sized the 4 MB
 *   cap for. Adding them later is one line; taking back a per-tool-call POST is not.
 * - **`PreCompact` / `SubagentStart`** — both verified working, both news nothing reads yet.
 */
export const CONNECTED_EVENTS: readonly string[] = [
  'UserPromptSubmit',
  'Notification',
  'Stop',
  'SubagentStop',
  'SessionEnd',
];

/**
 * Seconds. Claude Code waits for a hook before giving up and showing an error (F.1.5).
 *
 * Five, not the default sixty: core acks in 2–4 ms (P1-T5), so anything approaching a second means
 * core is wedged, and a session should not spend a minute finding that out once per turn.
 */
export const HOOK_TIMEOUT_SECONDS = 5;

/** One `http` handler, exactly as it appears in `settings.json`. */
export interface HttpHandler {
  readonly type: 'http';
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  /**
   * SEC-HTTP-7. Required for `${VAR}` in a header to resolve at all — an undeclared name is
   * interpolated to the empty string rather than left alone, so omitting this is a 401 rather
   * than anything a reader would recognise (RESEARCH.md F.1.6).
   *
   * Only the per-hook list is written. The global `httpHookAllowedEnvVars` would also work and is
   * deliberately NOT written: when it is present Claude Code intersects every hook's list with it,
   * so Connect would be silently narrowing http hooks the owner adds later (F.1.6).
   */
  readonly allowedEnvVars: readonly string[];
  readonly timeout: number;
}

export function flightdeckHandler(): HttpHandler {
  return {
    type: 'http',
    url: CORE_HOOKS_URL,
    // The value is the stable ingest key, taken from the session's environment. Never the literal
    // secret: a token in settings.json is a credential in a config file AND stale on every core
    // restart, which is the pair of problems SEC-HTTP-7 exists to avoid.
    headers: { Authorization: `Bearer \${${INGEST_KEY_ENV_VAR}}` },
    allowedEnvVars: [INGEST_KEY_ENV_VAR],
    timeout: HOOK_TIMEOUT_SECONDS,
  };
}

/** One file Connect would rewrite. `before` and `after` are whole contents, so the diff is honest. */
export interface FileChange {
  readonly path: string;
  readonly label: string;
  readonly before: string;
  readonly after: string;
}

/** Why Connect will not proceed. Every one of these is reported, never thrown (F.3.7). */
export interface PlanRefusal {
  readonly path: string;
  readonly reason: string;
}

/**
 * What Connect would do to the session environment, alongside the files (SEC-HTTP-7).
 *
 * It is part of the plan rather than a separate step because it is not optional: the hooks block
 * references `${FLIGHTDECK_TOKEN}`, and a name with no value behind it is interpolated to the
 * empty string and 401s (RESEARCH.md F.1.6). Installing one without the other is the banner this
 * whole task exists to avoid.
 *
 * It carries the variable's NAME and never its value — see core/ports/session-environment.ts.
 */
export type EnvironmentStep = 'publish' | 'withdraw' | 'none';

export type ConnectPlan =
  | {
      readonly ok: true;
      readonly changes: readonly FileChange[];
      readonly alreadyDone: readonly string[];
      readonly environment: EnvironmentStep;
      /** How the environment step is described to the owner. Never a secret. */
      readonly environmentLabel: string;
    }
  | { readonly ok: false; readonly refusals: readonly PlanRefusal[] };

/**
 * Which way round. A closed union, and the only thing the browser gets a say in (P4-T6).
 *
 * It is here rather than in `Connector` because the deck asks for a plan now, and a direction the
 * page could spell freely would be a page choosing what gets written. `ConnectPlanRoute` matches
 * what arrives against these two and 400s anything else.
 */
export type ConnectDirection = 'connect' | 'disconnect';

/** One file that was written, and where its previous contents went. The backup is the point. */
export interface AppliedChange {
  readonly path: string;
  readonly backup: string;
}

/**
 * What a write actually did — `POST /connect`'s body (P4-T6).
 *
 * `applied` is reported on a FAILURE too, and that is the field this shape exists for: a Connect
 * that stopped half way has already backed files up, and the operator needs to be told where they
 * are (`Connector.apply`). So the deck renders `applied` before it renders `reason`.
 */
export interface ConnectWrite {
  readonly direction: ConnectDirection;
  readonly applied: readonly AppliedChange[];
  readonly environment: EnvironmentStep;
  /** Never the key — the variable's name and the file it is read from (SEC-DATA-4). */
  readonly environmentLabel: string;
  readonly alreadyDone: readonly string[];
}

/** Reads `GET /connect`'s body. Anything unrecognised is `undefined` — the deck renders that. */
export function parseConnectPlanReply(value: unknown): ConnectPlan | undefined {
  const plan = asRecord(asRecord(value)?.['plan']);
  if (plan === undefined) return undefined;
  if (plan['ok'] === false) return parseRefused(plan);
  if (plan['ok'] !== true) return undefined;

  const changes = parseAll(plan['changes'], parseFileChange);
  const alreadyDone = parseAll(plan['alreadyDone'], asString);
  const environment = plan['environment'];
  const environmentLabel = plan['environmentLabel'];
  if (changes === undefined || alreadyDone === undefined) return undefined;
  if (!isEnvironmentStep(environment) || typeof environmentLabel !== 'string') return undefined;
  return { ok: true, changes, alreadyDone, environment, environmentLabel };
}

/** Reads `POST /connect`'s body — the 200 shape only. A refusal is read by `connectRefusal`. */
export function parseConnectWrite(value: unknown): ConnectWrite | undefined {
  const fields = asRecord(value);
  if (fields === undefined) return undefined;
  const direction = fields['direction'];
  const applied = parseAll(fields['applied'], parseAppliedChange);
  const alreadyDone = parseAll(fields['alreadyDone'], asString);
  const environment = fields['environment'];
  const environmentLabel = fields['environmentLabel'];
  if (direction !== 'connect' && direction !== 'disconnect') return undefined;
  if (applied === undefined || alreadyDone === undefined) return undefined;
  if (!isEnvironmentStep(environment) || typeof environmentLabel !== 'string') return undefined;
  return { direction, applied, environment, environmentLabel, alreadyDone };
}

/**
 * One `FileChange` off the wire — exported because `keybinding-plan.ts` reads the same shape.
 *
 * It reads the same shape because it IS the same shape: that file imports `FileChange` rather than
 * declaring its own, so two parsers would be two opinions about one type (P5a-T7's header).
 */
export function parseFileChange(value: unknown): FileChange | undefined {
  const fields = asRecord(value);
  if (fields === undefined) return undefined;
  const { path, label, before, after } = fields;
  if (typeof path !== 'string' || typeof label !== 'string') return undefined;
  if (typeof before !== 'string' || typeof after !== 'string') return undefined;
  return { path, label, before, after };
}

/** One `PlanRefusal` off the wire. Shared with `keybinding-plan.ts` for `parseFileChange`'s reason. */
export function parsePlanRefusal(value: unknown): PlanRefusal | undefined {
  const fields = asRecord(value);
  if (fields === undefined) return undefined;
  const { path, reason } = fields;
  if (typeof path !== 'string' || typeof reason !== 'string') return undefined;
  return { path, reason };
}

/**
 * Core's own sentence for a refused write, so the deck never invents one.
 *
 * A 409 from `ConnectWriteRoute` carries `reason` and whatever it had already applied; the panel
 * wants both, and `applied` comes back through `refusedApplied` below.
 */
export function connectRefusal(value: unknown): string | undefined {
  const reason = asRecord(value)?.['reason'];
  return typeof reason === 'string' && reason !== '' ? reason : undefined;
}

/** What a refused write had already written before it stopped. Empty is the ordinary answer. */
export function refusedApplied(value: unknown): readonly AppliedChange[] {
  return parseAll(asRecord(value)?.['applied'], parseAppliedChange) ?? [];
}

function parseAppliedChange(value: unknown): AppliedChange | undefined {
  const fields = asRecord(value);
  if (fields === undefined) return undefined;
  const { path, backup } = fields;
  if (typeof path !== 'string' || typeof backup !== 'string') return undefined;
  return { path, backup };
}

function parseRefused(plan: Readonly<Record<string, unknown>>): ConnectPlan | undefined {
  const refusals = parseAll(plan['refusals'], parsePlanRefusal);
  return refusals === undefined ? undefined : { ok: false, refusals };
}

/**
 * Every entry, or `undefined` if any one of them is not readable.
 *
 * All or nothing rather than filtering: a plan with a change silently dropped out of it is a diff
 * that does not describe the write, which is the one thing this whole contract promises.
 */
function parseAll<T>(
  value: unknown,
  one: (entry: unknown) => T | undefined,
): readonly T[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const parsed: T[] = [];
  for (const entry of value) {
    const item = one(entry);
    if (item === undefined) return undefined;
    parsed.push(item);
  }
  return parsed;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function isEnvironmentStep(value: unknown): value is EnvironmentStep {
  return value === 'publish' || value === 'withdraw' || value === 'none';
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return Object.fromEntries(Object.entries(value));
}
