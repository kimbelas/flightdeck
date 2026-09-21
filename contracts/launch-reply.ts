// What `POST /sessions` answers with — the wire shape both sides read (P2-T2).
//
// One definition rather than two, for the `toSessionRow` reason: core building `{ sessionId }` by
// hand and the deck reading it with a cast are two opinions about one format, and the cast is the
// half that cannot notice when they diverge. `LaunchRoute` constructs this type; `DeckStore`
// rebuilds it through the parser below.
//
// The parser is not ceremony. The id it carries becomes a pane target and a WebSocket attach
// argument, so "core answered 201 with something else" has to be distinguishable from "core
// started a session" — CODING-STANDARDS §11 rule 1, reject rather than coerce.

/** A started background session. The reconciler publishes the row itself, a sweep later. */
export interface LaunchAccepted {
  readonly sessionId: string;
}

/**
 * Rebuilds the reply, or `undefined` if it is not one.
 *
 * An empty `sessionId` is rejected rather than passed on: it would reach the pane registry as a
 * key that matches nothing and present as a pane that silently never connects.
 */
export function parseLaunchAccepted(value: unknown): LaunchAccepted | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const fields: Readonly<Record<string, unknown>> = Object.fromEntries(Object.entries(value));
  const sessionId = fields['sessionId'];
  if (typeof sessionId !== 'string' || sessionId === '') return undefined;
  return { sessionId };
}

/**
 * Why core would not start a session.
 *
 * A code, never a sentence: core names the cause and the deck decides the wording, which is the
 * same split as everywhere else that model or system text reaches a page. It lives here rather
 * than in `SessionLauncher` because the deck has to read it, and a second copy of the list on this
 * side is how a rename becomes a message nobody sees.
 *
 * **`no_claude` became `no_shell` in P4-T2** and the rename is the task in one word: a launch goes
 * through `powershell.exe` and one of the owner's four profile functions now (D4), not through
 * `claude.exe` with a config directory set, so "cannot find claude.exe" was about to become a
 * sentence that named the wrong binary. It is still the one code that is the operator's to fix
 * rather than the request's.
 *
 * **`no_session_id` is the distinct outcome P4-T2 owes** — a launch that exited 0 and printed
 * nothing a session id could be read out of. It used to be folded into `launch_failed`, which is
 * the one reading that is actively unhelpful: the process may well have started a session, and
 * "it failed" would have the owner start a second one. RESEARCH.md F.3.6 predicted this as a HANG
 * for an untrusted folder; F.8.3 measured that `--bg` does not hang there, so what is left is the
 * general case — any exit-0 run whose output this build cannot read.
 */
export type LaunchFailure = 'no_shell' | 'bad_request' | 'launch_failed' | 'no_session_id';

export const LAUNCH_FAILURES: readonly LaunchFailure[] = [
  'no_shell',
  'bad_request',
  'launch_failed',
  'no_session_id',
];

/** The code off a refusal body, or `undefined` for a body that carries none. */
export function parseLaunchFailure(value: unknown): LaunchFailure | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const fields: Readonly<Record<string, unknown>> = Object.fromEntries(Object.entries(value));
  const code: unknown = fields['error'];
  return LAUNCH_FAILURES.find((failure) => failure === code);
}

/**
 * Why core would not wake a stopped session — P4-T2a.
 *
 * A separate union from `LaunchFailure` even though two codes read alike, because the deck says
 * different things about them: a launch that fails leaves nothing behind, and a resume that fails
 * leaves a row still sitting there saying "not running". `bad_session` is the one that is neither
 * the operator's nor a transient failure — the id was not a full lowercase uuid, and RESEARCH.md
 * F.2.7 is why that is refused here rather than passed to the CLI: a SHORT id does not fail, it
 * forks a copy of the session under a new id and loses its name.
 */
export type ResumeFailure = 'no_claude' | 'bad_session' | 'resume_failed';

/**
 * Why core would not hand a session off to a new working tree — P6-T6.
 *
 * Its own union rather than a widened `ResumeFailure`, for the reason `launch-reply.ts` gives about
 * the other four: the verbs sound alike and are not. A resume WAKES a session under its own id; a
 * handoff FORKS it into a second one. "Could not resume" after a failed handoff would send somebody
 * looking for a session that is exactly where they left it.
 *
 * `bad_cwd` and `bad_name` are the two a resume cannot have, because a resume takes neither.
 */
export type HandoffFailure =
  'no_claude' | 'bad_session' | 'bad_cwd' | 'bad_name' | 'handoff_failed' | 'no_session_id';

export const HANDOFF_FAILURES: readonly HandoffFailure[] = [
  'no_claude',
  'bad_session',
  'bad_cwd',
  'bad_name',
  'handoff_failed',
  'no_session_id',
];

/** One off the wire, or `undefined`. The deck has a sentence per code and none for anything else. */
export function parseHandoffFailure(value: unknown): HandoffFailure | undefined {
  return HANDOFF_FAILURES.find((known) => known === value);
}

export const RESUME_FAILURES: readonly ResumeFailure[] = [
  'no_claude',
  'bad_session',
  'resume_failed',
];

/** The code off a refused resume, or `undefined` for a body that carries none. */
export function parseResumeFailure(value: unknown): ResumeFailure | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const fields: Readonly<Record<string, unknown>> = Object.fromEntries(Object.entries(value));
  const code: unknown = fields['error'];
  return RESUME_FAILURES.find((failure) => failure === code);
}

/**
 * Why core would not stop a running session — P4-T2b.
 *
 * Stopping is NOT destructive and deliberately has no confirmation step: the session survives, its
 * transcript survives, and P4-T2a's resume wakes it again under its own id. `rm` is the verb that
 * deletes (RESEARCH.md F.2.8) and it is not here for exactly that reason — it needs a confirm of
 * its own and must not ride in behind a button that looks like this one.
 */
export type StopFailure = 'no_claude' | 'bad_session' | 'stop_failed';

export const STOP_FAILURES: readonly StopFailure[] = ['no_claude', 'bad_session', 'stop_failed'];

/** The code off a refused stop, or `undefined` for a body that carries none. */
export function parseStopFailure(value: unknown): StopFailure | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const fields: Readonly<Record<string, unknown>> = Object.fromEntries(Object.entries(value));
  const code: unknown = fields['error'];
  return STOP_FAILURES.find((failure) => failure === code);
}

/**
 * Why core would not DELETE a session — P4-T2.
 *
 * Its own union beside `StopFailure`, although the three codes read alike, because the two verbs
 * are not alike at all: stopping keeps the session and its transcript and is undone by a resume,
 * while `rm` deletes `jobs/<shortId>/` and there is nothing to undo. A shared union would make it
 * one line's work to point the stop button at the destructive route.
 *
 * `rm` takes the SHORT id and refuses the full uuid, exactly as `stop` does (F.2.8b, and F.8.4
 * measured the same for `rm`), so `bad_session` is the code for a row that does not carry both.
 */
/**
 * Why a pop-out did not happen — P6-T2.
 *
 * Its own union beside the three above, for `RemoveFailure`'s reason: the verbs differ in what can
 * go wrong. `no_terminal` covers Windows Terminal not being installed AND Claude Code not being
 * installed, because from the deck they are one sentence: there is nothing here to pop out into.
 */
export type PopoutFailure = 'bad_session' | 'no_terminal' | 'popout_failed';

export const POPOUT_FAILURES: readonly PopoutFailure[] = [
  'bad_session',
  'no_terminal',
  'popout_failed',
];

/** One refusal off `POST /sessions/popout`. @throws never. */
export function parsePopoutFailure(value: unknown): PopoutFailure | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const error: unknown = Object.fromEntries(Object.entries(value))['error'];
  return POPOUT_FAILURES.find((known) => known === error);
}

export type RemoveFailure = 'no_claude' | 'bad_session' | 'remove_failed';

export const REMOVE_FAILURES: readonly RemoveFailure[] = [
  'no_claude',
  'bad_session',
  'remove_failed',
];

/** The code off a refused delete, or `undefined` for a body that carries none. */
export function parseRemoveFailure(value: unknown): RemoveFailure | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const fields: Readonly<Record<string, unknown>> = Object.fromEntries(Object.entries(value));
  const code: unknown = fields['error'];
  return REMOVE_FAILURES.find((failure) => failure === code);
}
