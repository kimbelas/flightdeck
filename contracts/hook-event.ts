// What arrives on `POST /hooks`, and the parser that admits it — SEC-ING-1 (P1-T5).
//
// Shapes measured in P0-T3 and captured in `fixtures/hooks/` (RESEARCH.md F.1.2). Four fields are
// on every payload; the rest depend on the event and on whether the session is headless or `--bg`,
// so everything past the four is optional and absence is ordinary rather than an error.
//
// **`hook_event_name` stays a `string`.** The same argument as `FdEvent.type`: the set is Claude
// Code's to choose and it adds to it between releases (SPEC §3 lists nine today). A union here
// would make an unrecognised event a type error in the component whose whole job is to record it.
// Nine names are listed below as a comment rather than a type for exactly that reason.
//
// **This is the most untrusted input core takes.** `Stop` carries `last_assistant_message` — model
// text, arriving over HTTP, on the one route with no `Origin` to check (F.1.3) — so:
//
//   - `session_id` is checked against the UUID shape, because it reaches a command line later
//     (SEC-ING-1, and the `--resume` finding in F.2.7: an id the CLI does not recognise silently
//     forks a copy rather than failing).
//   - every path is kept as a STRING here and resolved by nobody. `transcript_path` is matched
//     against the two config-dir roots by `SubscriptionPaths` before anything reads it (SEC-FS-1),
//     and P1-T7 is the task that opens it.
//   - `last_assistant_message` is never logged, never put in an event payload that reaches the
//     browser, and never interpreted (SEC-UI-2, SEC-DATA-2). It is carried because the store wants
//     it (P1-T8) and for no other reason.
//
// Hand-rolled rather than zod, matching contracts/session.ts, daemon-roster.ts and
// pty-protocol.ts: the project carries no schema library and a receiver that must ack in under
// 5 ms (SEC-ING-2) is not the place to add one.

/**
 * One hook payload, reduced to the fields P0-T3 actually observed.
 *
 * Snake_case because it is a wire format and renaming it would hide what Claude Code sent
 * (eslint's naming rule exempts `typeProperty` for exactly this).
 */
export interface HookPayload {
  readonly session_id: string;
  readonly hook_event_name: string;
  readonly transcript_path: string;
  readonly cwd: string;
  /** `--bg` only. The per-session temp dir; present on background sessions (F.1.2). */
  readonly scratchpad_dir: string | undefined;
  /** `SessionStart` only, and `--bg` only: the `-n` name. `Stop` does not carry it. */
  readonly session_title: string | undefined;
  /** `SessionStart` only, `--bg` only. */
  readonly model: string | undefined;
  /** `SessionStart` only: `startup`, `resume`, … */
  readonly source: string | undefined;
  /** `Stop` only. */
  readonly prompt_id: string | undefined;
  readonly permission_mode: string | undefined;
  readonly stop_hook_active: boolean | undefined;
  /**
   * `Stop` only — **model-generated text**. Never logged, never rendered, never interpreted
   * (SEC-UI-2). Parsed so the store can keep it (P1-T8); nothing in P1-T5 reads it.
   */
  readonly last_assistant_message: string | undefined;
}

/**
 * The nine events SPEC §3 names, for reference only — deliberately not a type.
 *
 * P0-T3 measured that `SessionStart` is never delivered over the `http` transport at all, so a
 * receiver that depended on this list would be depending on something untrue (RESEARCH.md F.1.1).
 * What actually arrives is whatever Connect installed and Claude Code chose to send.
 */
export const KNOWN_HOOK_EVENTS: readonly string[] = [
  'SessionStart',
  'SessionEnd',
  'UserPromptSubmit',
  'Stop',
  'SubagentStop',
  'Notification',
  'PreCompact',
  'PreToolUse',
  'PostToolUse',
];

/** Lowercase, hyphenated, 8-4-4-4-12 — as `SessionId.parse` demands, and for the same reason. */
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A hook event name is a label, not a sentence. Long enough for anything Claude Code has sent. */
const MAX_EVENT_NAME = 64;

/**
 * One payload, or `undefined` for anything that is not one.
 *
 * Rejects rather than coerces (CODING-STANDARDS §11 rule 1): a payload missing its session id or
 * its transcript path cannot be attributed to a session or a subscription, and an event attributed
 * to the wrong session is worse than one that was refused.
 *
 * @throws never — a malformed body is a `400`, not an exception.
 */
export function parseHookPayload(value: unknown): HookPayload | undefined {
  const fields = asRecord(value);
  if (fields === undefined) return undefined;

  const sessionId = stringAt(fields, 'session_id');
  const eventName = stringAt(fields, 'hook_event_name');
  const transcriptPath = stringAt(fields, 'transcript_path');
  const cwd = stringAt(fields, 'cwd');
  if (sessionId === undefined || !SESSION_ID.test(sessionId)) return undefined;
  if (eventName === undefined || eventName === '' || eventName.length > MAX_EVENT_NAME) {
    return undefined;
  }
  if (transcriptPath === undefined || cwd === undefined) return undefined;

  return {
    session_id: sessionId,
    hook_event_name: eventName,
    transcript_path: transcriptPath,
    cwd,
    scratchpad_dir: stringAt(fields, 'scratchpad_dir'),
    session_title: stringAt(fields, 'session_title'),
    model: stringAt(fields, 'model'),
    source: stringAt(fields, 'source'),
    prompt_id: stringAt(fields, 'prompt_id'),
    permission_mode: stringAt(fields, 'permission_mode'),
    stop_hook_active: booleanAt(fields, 'stop_hook_active'),
    last_assistant_message: stringAt(fields, 'last_assistant_message'),
  };
}

/** `JSON.parse` that answers `undefined` instead of throwing. An unparseable body is a 400. */
export function parseJsonBody(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

/** As in daemon-roster.ts: an annotated return is what keeps `any` from escaping `Object.entries`. */
function asRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return Object.fromEntries(Object.entries(value));
}

function stringAt(source: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const value = source[key];
  return typeof value === 'string' ? value : undefined;
}

function booleanAt(source: Readonly<Record<string, unknown>>, key: string): boolean | undefined {
  const value = source[key];
  return typeof value === 'boolean' ? value : undefined;
}
