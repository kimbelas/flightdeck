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
  const leftBlocked = left.runState === 'blocked' ? 0 : 1;
  const rightBlocked = right.runState === 'blocked' ? 0 : 1;
  if (leftBlocked !== rightBlocked) return leftBlocked - rightBlocked;
  if (left.live !== right.live) return left.live ? -1 : 1;
  return right.startedAt - left.startedAt;
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
