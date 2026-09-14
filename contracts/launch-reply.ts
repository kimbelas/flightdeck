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
 * `no_claude` is the one that is the operator's to fix rather than the request's — core is running
 * and answered; it just cannot find claude.exe.
 */
export type LaunchFailure = 'no_claude' | 'bad_request' | 'launch_failed';

export const LAUNCH_FAILURES: readonly LaunchFailure[] = [
  'no_claude',
  'bad_request',
  'launch_failed',
];

/** The code off a refusal body, or `undefined` for a body that carries none. */
export function parseLaunchFailure(value: unknown): LaunchFailure | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const fields: Readonly<Record<string, unknown>> = Object.fromEntries(Object.entries(value));
  const code: unknown = fields['error'];
  return LAUNCH_FAILURES.find((failure) => failure === code);
}
