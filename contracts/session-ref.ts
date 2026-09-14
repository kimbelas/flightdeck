// Which session an expanded row is asking about — P2-T4, SEC-ING-1.
//
// Three strings that arrive from a browser and end up composing a filesystem path, so this is a
// boundary and not a convenience type. It lives in contracts/ because both ends need the same
// answer: the deck builds the query, core screens it, and a deck that spelled a parameter
// differently from the route that reads it would be a 400 nobody could see the cause of.
//
// **The shapes are the ones P0 measured, not guesses.** A session id is a lowercase 8-4-4-4-12
// uuid everywhere it crosses a boundary (the rule `statusline-report.ts` set), and a short id is
// its first block — eight hex characters, which is what names the job directory (F.7.1). Anything
// else is refused rather than cleaned up: `shortId` is interpolated into a path, and the only safe
// thing to do with a value that will name a directory is to prove it is eight hex characters.
// `..\..\daemon` does not survive that, which is why the check is a shape and not an escape.
import { SUBSCRIPTION_IDS, type SubscriptionId } from './session.ts';

export interface SessionRef {
  readonly sessionId: string;
  readonly shortId: string;
  readonly subscription: SubscriptionId;
}

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHORT_ID = /^[0-9a-f]{8}$/;

/** The query parameter names, so the two ends cannot spell them differently. */
export const SESSION_REF_PARAMS = {
  sessionId: 'session',
  shortId: 'short',
  subscription: 'subscription',
} as const;

/**
 * One reference, or `undefined` if it is not one.
 *
 * All three are required. `shortId` could be derived from `sessionId` — it is the first block —
 * but it is sent rather than computed, because the derivation is an observation about how Claude
 * Code names job directories today (F.7.1) and the deck already has the real value on the row it
 * is expanding. Deriving it here would be this file guessing at a filename.
 *
 * @throws never.
 */
export function parseSessionRef(query: Readonly<Record<string, string>>): SessionRef | undefined {
  const sessionId = query[SESSION_REF_PARAMS.sessionId] ?? '';
  const shortId = query[SESSION_REF_PARAMS.shortId] ?? '';
  const subscription = SUBSCRIPTION_IDS.find((id) => id === query[SESSION_REF_PARAMS.subscription]);
  if (!SESSION_ID.test(sessionId) || !SHORT_ID.test(shortId)) return undefined;
  if (subscription === undefined) return undefined;
  return { sessionId, shortId, subscription };
}

/** The query string for one reference, without the `?`. The deck's half of the same agreement. */
export function sessionRefQuery(ref: SessionRef): string {
  return new URLSearchParams({
    [SESSION_REF_PARAMS.sessionId]: ref.sessionId,
    [SESSION_REF_PARAMS.shortId]: ref.shortId,
    [SESSION_REF_PARAMS.subscription]: ref.subscription,
  }).toString();
}
