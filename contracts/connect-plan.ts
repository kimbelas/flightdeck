// What Connect writes, and the shape of the answer it gives before it writes anything (P1-T11).
//
// In contracts/ because two sides have to agree: `ConnectPlanner` produces a plan and the CLI (and
// later the deck, D13) renders it. A plan is always computed in full and shown before a byte is
// written — SEC-FS-3 and D13 both say the owner sees the diff first, and the only way to keep that
// promise structurally is for computing and writing to be different objects.
import { CORE_PORT, LOOPBACK_ADDRESS } from './origins.ts';
import { INGEST_KEY_ENV_VAR } from './ingest-key.ts';

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
