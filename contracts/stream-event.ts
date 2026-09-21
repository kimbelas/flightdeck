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
// **`quota` is replayed too, and that is why the header is on the stream rather than polling**
// (P2-T3). It is whole-state, not a delta: quota belongs to a subscription and the deck draws both
// at once, so a frame carrying one session's reading would be a frame the header could not use.
// Replaying it on connect is also the only thing that fills the header when nothing is running —
// the statusLine posts on every render and therefore posts nothing at all when no session is open,
// so a deck that waited for an event would show two empty gauges until somebody started work.
//
// **Hand-rolled parsing, matching pty-protocol.ts**: the project carries no schema library. Every
// frame is `unknown` until the parser below rebuilds it (CODING-STANDARDS §11 rule 1), and a frame
// that does not match is dropped rather than coerced — a deck that received a half-shaped row
// should ignore it, not render a session with blank fields.
import { parseAskFrame, type AskFrame } from './ask-record.ts';
import { parseQuotaSummary, type QuotaSummary } from './quota-summary.ts';
import {
  parseDeckSnapshot,
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

/**
 * What a subscriber receives. A discriminated union on `name`, exhaustively switched (R12).
 *
 * **`ask` is the one frame that is NOT replayed on connect** (P4-T4, D48). Everything else here is
 * whole-state or a delta against a snapshot, and a subscriber that joins late is caught up by the
 * replay. An Ask record is an event in a conversation: replaying the last one would put a stray
 * sentence in a panel nobody opened, and replaying all of them would need core to keep every run's
 * transcript to no purpose. A deck that connects mid-run picks the answer up from the next record,
 * which is the honest thing a live feed can offer.
 */
export type StreamFrame =
  | { readonly name: 'snapshot'; readonly data: DeckSnapshot }
  | { readonly name: 'session.upsert'; readonly data: SessionRow }
  | { readonly name: 'session.gone'; readonly data: SessionGone }
  | { readonly name: 'quota'; readonly data: QuotaSummary }
  | { readonly name: 'ask'; readonly data: AskFrame };

export type StreamFrameName = StreamFrame['name'];

export const STREAM_FRAME_NAMES: readonly StreamFrameName[] = [
  'snapshot',
  'session.upsert',
  'session.gone',
  'quota',
  'ask',
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
  return frameOf(name, value);
}

/**
 * Which parser answers for which name.
 *
 * Split out of `parseStreamFrame` when `ask` became the fifth frame: one switch carrying a parse
 * and a drop per branch runs out of complexity budget at exactly five, and the limit is right — a
 * function nobody can hold in their head is where a missing `undefined` check hides. Each branch is
 * now one call, and the drop lives in the five one-line functions below, where it cannot be
 * forgotten without deleting something visible. No cast: each helper names its own frame, so the
 * union is checked at five small sites instead of asserted at one big one.
 */
function frameOf(name: string, value: unknown): StreamFrame | undefined {
  switch (name) {
    case 'snapshot':
      return snapshotFrame(value);
    case 'session.upsert':
      return upsertFrame(value);
    case 'session.gone':
      return goneFrame(value);
    case 'quota':
      return quotaFrame(value);
    case 'ask':
      return askFrame(value);
    default:
      return undefined;
  }
}

function snapshotFrame(value: unknown): StreamFrame | undefined {
  const data = parseDeckSnapshot(value);
  return data === undefined ? undefined : { name: 'snapshot', data };
}

function upsertFrame(value: unknown): StreamFrame | undefined {
  const data = parseSessionRow(value);
  return data === undefined ? undefined : { name: 'session.upsert', data };
}

function goneFrame(value: unknown): StreamFrame | undefined {
  const data = parseSessionGone(value);
  return data === undefined ? undefined : { name: 'session.gone', data };
}

function quotaFrame(value: unknown): StreamFrame | undefined {
  const data = parseQuotaSummary(value);
  return data === undefined ? undefined : { name: 'quota', data };
}

function askFrame(value: unknown): StreamFrame | undefined {
  const data = parseAskFrame(value);
  return data === undefined ? undefined : { name: 'ask', data };
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
