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

import { SUBSCRIPTION_IDS, type SubscriptionId } from './session.ts';

/**
 * What a socket is attached to. Decided at the handshake, never afterwards.
 *
 * A session carries its `SubscriptionId`, not a config-dir path. The two directories are named
 * server-side from that closed union, so a page cannot steer `CLAUDE_CONFIG_DIR` at an arbitrary
 * folder by asking for one — the allowlist is the type (SECURITY.md §11 rule 2).
 */
export type PtyTarget =
  | { readonly kind: 'shell' }
  | {
      readonly kind: 'session';
      readonly sessionId: string;
      readonly subscription: SubscriptionId;
    };

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
  if (sessionId === null) return query.get('shell') === '1' ? { kind: 'shell' } : undefined;

  const subscription = query.get('subscription');
  if (!isSessionId(sessionId) || !isSubscriptionId(subscription)) return undefined;
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
  if (fields['kind'] === 'shell') return { kind: 'shell' };
  if (fields['kind'] !== 'session') return undefined;

  const sessionId = fields['sessionId'];
  const subscription = fields['subscription'];
  if (typeof sessionId !== 'string' || !isSessionId(sessionId)) return undefined;
  if (typeof subscription !== 'string' || !isSubscriptionId(subscription)) return undefined;
  return { kind: 'session', sessionId, subscription };
}

/**
 * Whether two targets name the same PTY — what binds a ticket to one pane (SEC-WS-1).
 *
 * Every shell equals every other shell: shells carry no identity, they are never held (PaneRegistry
 * `holderKey`), and a ticket minted for one is a ticket for a new one. Sessions compare on both
 * fields, because the same id under the other subscription is a different session entirely.
 */
export function sameTarget(a: PtyTarget, b: PtyTarget): boolean {
  if (a.kind === 'shell' || b.kind === 'shell') return a.kind === b.kind;
  return a.sessionId === b.sessionId && a.subscription === b.subscription;
}

// `.some` rather than `.includes`: includes() would need an `as` cast to compare a string against
// the narrowed union, and a cast is exactly what a type guard exists to avoid.
function isSubscriptionId(value: string | null): value is SubscriptionId {
  return value !== null && SUBSCRIPTION_IDS.some((id) => id === value);
}

/**
 * A session id reaches a command line, so it is checked against the shape, not merely escaped.
 *
 * The FULL lowercase uuid, not the short form, even though `attach` wants the short one. The deck
 * has the uuid from `/sessions` and it is the stable identity; narrowing it to the eight characters
 * the CLI happens to take is the adapter's job (WindowsPtyCommands), not the wire's. Lowercase
 * specifically, matching SessionId.parse — F.2.7 measured that an id `--resume` does not recognise
 * silently forks a copy rather than failing.
 */
function isSessionId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
}

export function encodeServerFrame(frame: ServerFrame): string {
  return JSON.stringify(frame);
}
