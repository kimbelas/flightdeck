// The frames that cross the PTY socket, and the guards that admit them — SEC-WS-2.
//
// Hand-rolled guards rather than zod, matching contracts/session.ts and daemon-roster.ts: the
// project carries no schema library and this is not the place to add one. Every frame is `unknown`
// until a guard here accepts it (CODING-STANDARDS §11 rule 1), and a frame that does not match is
// dropped rather than coerced — a terminal that receives a malformed resize should do nothing, not
// guess at a size.
//
// **The bind target is not in any frame.** It is read from the upgrade URL and fixed for the life
// of the socket, because SEC-WS-2 requires that no frame can retarget a connection: a socket
// authorised for one session must not be steerable onto another by its own next message.
//
// **The first frame carries a ticket, not the per-boot token** (DECISIONS.md D32, P5a-T2b). The
// same target therefore arrives twice by two different routes — named in the body when the ticket
// is minted, and again in the upgrade URL when it is redeemed — so `parseTargetPayload` and
// `sameTarget` exist alongside `parsePtyTarget`, and the socket binds only where the two agree.

import { MAX_PROJECT_PATH_CHARS } from './project.ts';
import { SUBSCRIPTION_IDS, type SubscriptionId } from './session.ts';

/**
 * What a socket is attached to. Decided at the handshake, never afterwards.
 *
 * A session carries its `SubscriptionId`, not a config-dir path. The two directories are named
 * server-side from that closed union, so a page cannot steer `CLAUDE_CONFIG_DIR` at an arbitrary
 * folder by asking for one — the allowlist is the type (SECURITY.md §11 rule 2).
 */
export type PtyTarget =
  | {
      readonly kind: 'shell';
      /**
       * Which shell — P6-T1.
       *
       * A shell carried no identity until now, which is why only one could ever be open:
       * every shell target equalled every other, so the grid had one key for all of them
       * and a ticket minted for one opened any. SPEC §5.7(3) wants a pane per repository
       * (`git` in one, `npm run dev` in another), so a shell is now a thing you can name.
       *
       * A deck-generated slug, screened by shape because it reaches a URL, a JSON payload
       * and a log field. It is NOT a pane id: core assigns those, and this one survives a
       * reload in `localStorage`.
       */
      readonly id: string;
      /**
       * The imported project to start in, as a `projectKey`, or `undefined` for home.
       *
       * **A key that is MATCHED, never used as a path** — `/projects/observed`'s rule, for
       * the same reason (D26, SEC-FS-1). Core looks it up among the imported folders and
       * uses the stored path it finds; a key nobody imported refuses the pane rather than
       * falling back to home, because a shell that opened somewhere other than where the
       * button said is the one failure a terminal must not have.
       */
      readonly project: string | undefined;
    }
  | {
      readonly kind: 'session';
      readonly sessionId: string;
      readonly subscription: SubscriptionId;
    };

/**
 * What a shell's `id` may be — a slug, and nothing that needs escaping anywhere.
 *
 * It travels through a query string, a JSON body, a `Map` key and a log line, so the
 * narrow shape is what makes all four safe at once rather than four escapings that have to
 * agree. `shell-1` is what the deck generates.
 */
const SHELL_ID = /^[a-z0-9][a-z0-9-]{0,31}$/u;

/** Whether a value can be a shell's id. Exported so the deck and core cannot drift. */
export function isShellPaneId(value: unknown): value is string {
  return typeof value === 'string' && SHELL_ID.test(value);
}

/**
 * Whether a value can be a project key on a shell target.
 *
 * Shape only, and deliberately loose: the security is the exact-match lookup in the
 * registry, not this. What this stops is an unbounded string reaching a log line.
 */
function isProjectKey(value: unknown): value is string {
  return typeof value === 'string' && value !== '' && value.length <= MAX_PROJECT_PATH_CHARS;
}

export type ClientFrame =
  | { readonly type: 'auth'; readonly ticket: string }
  | { readonly type: 'input'; readonly data: string }
  | { readonly type: 'resize'; readonly cols: number; readonly rows: number };

export type ServerFrame =
  | { readonly type: 'ready'; readonly pid: number; readonly target: PtyTarget }
  | { readonly type: 'output'; readonly data: string }
  | { readonly type: 'exit'; readonly code: number }
  | { readonly type: 'error'; readonly reason: string };

/** Bounds a resize to something a terminal can actually be, so a hostile frame cannot allocate. */
const MAX_COLS = 1000;
const MAX_ROWS = 1000;

export function parseClientFrame(raw: string): ClientFrame | undefined {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof value !== 'object' || value === null) return undefined;
  const frame = value as Record<string, unknown>;

  switch (frame['type']) {
    case 'auth':
      return typeof frame['ticket'] === 'string'
        ? { type: 'auth', ticket: frame['ticket'] }
        : undefined;
    case 'input':
      return typeof frame['data'] === 'string' ? { type: 'input', data: frame['data'] } : undefined;
    case 'resize':
      return parseResize(frame['cols'], frame['rows']);
    default:
      return undefined;
  }
}

function parseResize(cols: unknown, rows: unknown): ClientFrame | undefined {
  if (!isDimension(cols, MAX_COLS) || !isDimension(rows, MAX_ROWS)) return undefined;
  return { type: 'resize', cols, rows };
}

function isDimension(value: unknown, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= max;
}

/**
 * Reads the bind target out of the upgrade URL.
 *
 * `undefined` for anything unrecognised, which the socket server turns into a refused upgrade.
 * Fails closed: an unparseable target must never quietly become a shell.
 */
export function parsePtyTarget(url: string | undefined): PtyTarget | undefined {
  if (url === undefined) return undefined;
  const query = new URLSearchParams(url.split('?')[1] ?? '');
  const sessionId = query.get('session');
  if (sessionId === null) return shellIn(query);

  const subscription = query.get('subscription');
  if (!isFullSessionId(sessionId) || !isSubscriptionId(subscription)) return undefined;
  return { kind: 'session', sessionId, subscription };
}

/**
 * Reads the bind target out of a `POST /pty-ticket` body.
 *
 * The same union as `parsePtyTarget`, reached from JSON rather than a query string, and checked
 * just as hard: a ticket is minted against this value and the socket later compares the redeemed
 * ticket's target to the URL's, so a payload that parsed loosely here would widen what a ticket
 * admits. Fails closed for the same reason — an unrecognised shape must never become a shell.
 */
export function parseTargetPayload(value: unknown): PtyTarget | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const fields = value as Record<string, unknown>;
  if (fields['kind'] === 'shell') return shellPayload(fields);
  if (fields['kind'] !== 'session') return undefined;

  const sessionId = fields['sessionId'];
  const subscription = fields['subscription'];
  if (typeof sessionId !== 'string' || !isFullSessionId(sessionId)) return undefined;
  if (typeof subscription !== 'string' || !isSubscriptionId(subscription)) return undefined;
  return { kind: 'session', sessionId, subscription };
}

/**
 * Whether two targets name the same PTY — what binds a ticket to one pane (SEC-WS-1).
 *
 * **Shells used to all be equal, and as of P6-T1 they are not.** A ticket minted for a shell at
 * home must not redeem into one inside a repository: the two run in different directories, and the
 * whole point of the second is that `git` and `npm` do something there. So both fields are
 * compared, exactly as a session's two are — the same id under the other subscription is a
 * different session, and the same shell id in another folder is a different shell.
 */
export function sameTarget(a: PtyTarget, b: PtyTarget): boolean {
  if (a.kind === 'shell' && b.kind === 'shell') return a.id === b.id && a.project === b.project;
  if (a.kind === 'shell' || b.kind === 'shell') return false;
  return a.sessionId === b.sessionId && a.subscription === b.subscription;
}

/**
 * The shell half of `parseTargetPayload`, split out for its complexity budget.
 *
 * Screened exactly as the URL's is: a ticket is minted against this value and redeemed
 * against the other, so a payload that parsed more loosely here would widen what a ticket
 * admits (SEC-WS-1).
 */
function shellPayload(fields: Record<string, unknown>): PtyTarget | undefined {
  const { id, project } = fields;
  if (!isShellPaneId(id)) return undefined;
  if (project !== undefined && project !== null && !isProjectKey(project)) return undefined;
  return { kind: 'shell', id, project: isProjectKey(project) ? project : undefined };
}

/**
 * The shell target in an upgrade URL, or `undefined`.
 *
 * `?shell=<id>`, where the id used to be the literal `1`. That spelling is gone rather than kept as
 * a fallback: a URL this build cannot name a shell from must not quietly become the home shell,
 * which is `parsePtyTarget`'s own fail-closed rule applied to its history.
 */
function shellIn(query: URLSearchParams): PtyTarget | undefined {
  const id = query.get('shell');
  if (!isShellPaneId(id)) return undefined;
  const project = query.get('project');
  if (project !== null && !isProjectKey(project)) return undefined;
  return { kind: 'shell', id, project: project ?? undefined };
}

// `.some` rather than `.includes`: includes() would need an `as` cast to compare a string against
// the narrowed union, and a cast is exactly what a type guard exists to avoid.
function isSubscriptionId(value: string | null): value is SubscriptionId {
  return value !== null && SUBSCRIPTION_IDS.some((id) => id === value);
}

/**
 * A session id reaches a command line, so it is checked against the shape, not merely escaped.
 *
 * Exported since P4-T2a, because `--bg --resume` needs exactly the same rule for a stronger
 * reason: a SHORT id there does not fail, it silently forks a copy of the session under a new id
 * and loses its name (RESEARCH.md F.2.7). One definition, so the two cannot drift.
 *
 * The FULL lowercase uuid, not the short form, even though `attach` wants the short one. The deck
 * has the uuid from `/sessions` and it is the stable identity; narrowing it to the eight characters
 * the CLI happens to take is the adapter's job (WindowsPtyCommands), not the wire's. Lowercase
 * specifically, matching SessionId.parse — F.2.7 measured that an id `--resume` does not recognise
 * silently forks a copy rather than failing.
 */
export function isFullSessionId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
}

export function encodeServerFrame(frame: ServerFrame): string {
  return JSON.stringify(frame);
}
