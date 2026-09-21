// What the deck receives for one session. The wire shape between core and the browser.
//
// A DTO rather than the `Session` entity: the entity has behaviour and a state machine, and
// serialising it would leak both into the page and freeze them as a contract. This is data.
//
// **`attachable` is the product fact this whole file exists to carry.** `claude attach` takes
// background sessions only — SPEC §5.2, *"vitals but read-only — interactive sessions cannot be
// attached"* — so a deck that offers a pane on every row offers one that cannot open. The answer
// is computed once, here, rather than re-derived by each caller from `kind`.
import {
  ACTIVITY_STATUSES,
  RUN_STATES,
  SESSION_KINDS,
  SUBSCRIPTION_IDS,
  type ActivityStatus,
  type RunState,
  type SessionKind,
  type SubscriptionId,
} from './session.ts';

export interface SessionRow {
  readonly sessionId: string;
  readonly shortId: string;
  readonly subscription: SubscriptionId;
  readonly kind: SessionKind;
  readonly name: string | undefined;
  readonly cwd: string;
  readonly startedAt: number;
  readonly live: boolean;
  readonly runState: RunState | undefined;
  readonly status: ActivityStatus | undefined;
  /** Whether a pane can be opened on it, and if not, the reason the deck should show. */
  readonly attachable: boolean;
  readonly notAttachableBecause: string | undefined;
}

export interface DeckSnapshot {
  readonly rows: readonly SessionRow[];
  /** Subscriptions whose sweep failed. The deck shows these rather than pretending they are empty. */
  readonly unreadable: readonly SubscriptionId[];
  readonly takenAt: number;
}

/** The reason shown on every interactive row. Written once so the wording cannot drift. */
export const INTERACTIVE_NOT_ATTACHABLE =
  'Interactive session — already bound to its own terminal. Only background sessions can be attached.';

export const NOT_LIVE = 'Not running. Resume it to attach.';

/**
 * The identity of a row, as one string.
 *
 * Both fields, because a session id is only unique within a config dir: the same uuid under the
 * other subscription is a different session. One definition so the React key, the store's upsert
 * and the pane registry cannot disagree about what "the same row" means.
 */
export function sessionKey(row: Pick<SessionRow, 'sessionId' | 'subscription'>): string {
  return `${row.subscription}:${row.sessionId}`;
}

/**
 * The deck's order: what needs you, then what is live, then newest first.
 *
 * In contracts/ rather than in either caller because three now sort the same list — the on-demand
 * sweep (`DeckQuery`), the stream's replay (`Reconciler.snapshot`) and the browser re-sorting after
 * an upsert. That is the `toSessionRow` lesson from P1-T4: a second opinion about the order would
 * make a row jump when it arrived by a different route.
 */
export function byAttentionThenAge(left: SessionRow, right: SessionRow): number {
  const leftAttention = needsAttention(left) ? 0 : 1;
  const rightAttention = needsAttention(right) ? 0 : 1;
  if (leftAttention !== rightAttention) return leftAttention - rightAttention;
  if (left.live !== right.live) return left.live ? -1 : 1;
  return right.startedAt - left.startedAt;
}

/**
 * Blocked **and still running** — and the second half was missing until P2's gate was measured.
 *
 * `runState` is the last state a session was seen in, so a session that ended while blocked keeps
 * `blocked` forever. Sorting on that alone put a five-day-dead session at the top of a real deck,
 * above four that were busy, under the heading the whole page exists to answer (RESEARCH.md G.24).
 * It is not waiting on anybody: it is not waiting at all.
 *
 * `SessionRowViewModel.tone` already got this right — `ended` is tested before `blocked` — which is
 * why the row was correctly dimmed while sitting in the attention slot. Two opinions about one
 * question, and only the quiet one was wrong.
 *
 * Exported since P6-T3, which is the third caller: the toast for **needs-you** fires on the same
 * condition the deck sorts on, and a toast that disagreed with the row it is about would be worse
 * than no toast. G.24 is what a second opinion about this sentence already cost once.
 */
export function needsAttention(row: SessionRow): boolean {
  return row.live && row.runState === 'blocked';
}

/**
 * Rebuilds a row from parsed JSON, or `undefined` if it is not one.
 *
 * A parser rather than a type guard, and the difference is `exactOptionalPropertyTypes`:
 * `JSON.stringify` drops `name: undefined` entirely, so what comes back off the wire is missing a
 * property the type requires. A guard would have to lie about that; this puts the `undefined` back.
 *
 * It exists because the payload the stream carries is typed `unknown` on purpose (`DraftEvent`),
 * and the frame that reaches a browser is the one place that has to be proven a row rather than
 * assumed to be — the same field is the one most likely to carry model text (SEC-UI-2). Unknown
 * values in the closed unions are dropped rather than coerced (CODING-STANDARDS §11 rule 1).
 */
export function parseSessionRow(value: unknown): SessionRow | undefined {
  const row = asRecord(value);
  if (row === undefined) return undefined;
  const sessionId = stringAt(row, 'sessionId');
  const shortId = stringAt(row, 'shortId');
  const cwd = stringAt(row, 'cwd');
  const subscription = oneOf(SUBSCRIPTION_IDS, row['subscription']);
  const kind = oneOf(SESSION_KINDS, row['kind']);
  const startedAt = row['startedAt'];
  if (sessionId === undefined || shortId === undefined || cwd === undefined) return undefined;
  if (subscription === undefined || kind === undefined) return undefined;
  if (typeof startedAt !== 'number' || !Number.isFinite(startedAt)) return undefined;
  return {
    sessionId,
    shortId,
    subscription,
    kind,
    name: stringAt(row, 'name'),
    cwd,
    startedAt,
    live: row['live'] === true,
    runState: oneOf(RUN_STATES, row['runState']),
    status: oneOf(ACTIVITY_STATUSES, row['status']),
    attachable: row['attachable'] === true,
    notAttachableBecause: stringAt(row, 'notAttachableBecause'),
  };
}

/**
 * A whole snapshot, with rows that did not parse dropped.
 *
 * Dropped, not rejected: one unreadable row must not cost the deck the other nine and the
 * `unreadable` list with them. The rows are re-sorted here because the wire does not promise an
 * order — the same comparator the sender used, so nothing moves on arrival.
 *
 * It lives here rather than in `stream-event.ts`, where it was written, because P1-T12 gave it a
 * second reader: `flightdeck-core status` reads `GET /sessions`, which answers this exact shape.
 * Two parsers for one wire format is the `toSessionRow` lesson again.
 */
export function parseDeckSnapshot(value: unknown): DeckSnapshot | undefined {
  const fields = asRecord(value);
  if (fields === undefined) return undefined;
  const rows = fields['rows'];
  const unreadable = fields['unreadable'];
  const takenAt = fields['takenAt'];
  if (!Array.isArray(rows) || !Array.isArray(unreadable)) return undefined;
  if (typeof takenAt !== 'number') return undefined;
  const parsed: SessionRow[] = [];
  for (const row of rows) {
    const session = parseSessionRow(row);
    if (session !== undefined) parsed.push(session);
  }
  return {
    rows: parsed.sort(byAttentionThenAge),
    unreadable: unreadable
      .map((entry: unknown) => oneOf(SUBSCRIPTION_IDS, entry))
      .filter((id): id is SubscriptionId => id !== undefined),
    takenAt,
  };
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return Object.fromEntries(Object.entries(value));
}

function stringAt(source: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const value = source[key];
  return typeof value === 'string' ? value : undefined;
}

/** `.some` rather than `.includes`, which would need the `as` cast a guard exists to avoid. */
function oneOf<T extends string>(allowed: readonly T[], value: unknown): T | undefined {
  return allowed.find((candidate) => candidate === value);
}
