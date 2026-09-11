// The frames on `GET /stream`, and the parser that admits them — the deck's live feed (P1-T9).
//
// Two paths, because the stream does not ride the rewrite that everything else does. `/api/core/*`
// is forwarded to core verbatim; the stream is handled by a `force-dynamic` route handler in the
// deck, so the anti-buffering fix lives in the same file as the request that needs it rather than
// in another process (DECISIONS.md D27, RESEARCH.md F.6.3). The two spellings are here so "this
// one is proxied, that one is handled" is a fact both sides read rather than a comment.
//
// **Names come from BUILD-PLAN §4**, and `snapshot` is the replay: a subscriber's first frame is
// the whole picture — every session plus the subscriptions core could not read — and everything
// after it is a delta. One frame rather than a burst of upserts because `unreadable` is a property
// of the sweep, not of any row, and a replay made of rows could not carry it.
//
// **Hand-rolled parsing, matching pty-protocol.ts**: the project carries no schema library. Every
// frame is `unknown` until the parser below rebuilds it (CODING-STANDARDS §11 rule 1), and a frame
// that does not match is dropped rather than coerced — a deck that received a half-shaped row
// should ignore it, not render a session with blank fields.
import {
  byAttentionThenAge,
  parseSessionRow,
  type DeckSnapshot,
  type SessionRow,
} from './session-row.ts';
import { SUBSCRIPTION_IDS, type SubscriptionId } from './session.ts';

/** Core's own route. Screened by SEC-HTTP-1, -2, -5 and -3; no Content-Type to check (F.6.5). */
export const CORE_STREAM_PATH = '/stream';

/** The deck's route handler, deliberately outside `/api/core/*` so the two are told apart (D27). */
export const DECK_STREAM_PATH = '/api/stream';

/** Which session ended. The row is gone by then, so only its identity is left to send. */
export interface SessionGone {
  readonly sessionId: string;
  readonly subscription: SubscriptionId;
}

/** What a subscriber receives. A discriminated union on `name`, exhaustively switched (R12). */
export type StreamFrame =
  | { readonly name: 'snapshot'; readonly data: DeckSnapshot }
  | { readonly name: 'session.upsert'; readonly data: SessionRow }
  | { readonly name: 'session.gone'; readonly data: SessionGone };

export type StreamFrameName = StreamFrame['name'];

export const STREAM_FRAME_NAMES: readonly StreamFrameName[] = [
  'snapshot',
  'session.upsert',
  'session.gone',
];

/**
 * One frame from the wire, or `undefined` for anything unrecognised.
 *
 * @param name the SSE `event:` field. An unknown name is dropped rather than guessed at, which is
 * what lets core add a frame type without breaking a deck that has not been rebuilt.
 * @param data the SSE `data:` field, still JSON text.
 * @throws never — malformed JSON is an unrecognised frame, not an exception.
 */
export function parseStreamFrame(name: string, data: string): StreamFrame | undefined {
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    return undefined;
  }
  switch (name) {
    case 'snapshot': {
      const snapshot = parseDeckSnapshot(value);
      return snapshot === undefined ? undefined : { name: 'snapshot', data: snapshot };
    }
    case 'session.upsert': {
      const row = parseSessionRow(value);
      return row === undefined ? undefined : { name: 'session.upsert', data: row };
    }
    case 'session.gone': {
      const gone = parseSessionGone(value);
      return gone === undefined ? undefined : { name: 'session.gone', data: gone };
    }
    default:
      return undefined;
  }
}

/**
 * A snapshot, with rows that did not parse dropped.
 *
 * Dropped, not rejected: one unreadable row must not cost the deck the other nine and the
 * `unreadable` list with them. The rows are re-sorted here because the wire does not promise an
 * order — the same comparator the sender used, so nothing moves on arrival.
 */
function parseDeckSnapshot(value: unknown): DeckSnapshot | undefined {
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
    unreadable: unreadable.filter(isSubscriptionId),
    takenAt,
  };
}

function parseSessionGone(value: unknown): SessionGone | undefined {
  const fields = asRecord(value);
  if (fields === undefined) return undefined;
  const sessionId = fields['sessionId'];
  const subscription = fields['subscription'];
  if (typeof sessionId !== 'string' || !isSubscriptionId(subscription)) return undefined;
  return { sessionId, subscription };
}

function isSubscriptionId(value: unknown): value is SubscriptionId {
  return SUBSCRIPTION_IDS.some((id) => id === value);
}

/** As in daemon-roster.ts: an annotated return is what keeps `any` from escaping `Object.entries`. */
function asRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return Object.fromEntries(Object.entries(value));
}
