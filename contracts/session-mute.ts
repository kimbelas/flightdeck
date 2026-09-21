// Which sessions the owner has told to stop toasting — P6-T3, SPEC §5.5.
//
// In contracts/ because both ends need the same answer and the identity is not obvious: a session
// id is unique only within a config dir, so the same uuid under the other subscription is a
// different session (`sessionKey`). A mute keyed on the uuid alone would silence two sessions the
// owner can see side by side in the deck, which is the kind of bug that looks like a lost toast.
//
// **The wire carries `sessionKey` strings, not pairs.** One definition of "the same row" already
// exists and the React key, the store's upsert and the pane registry all use it; a mute set
// spelled any other way would be a fourth opinion about the same question.
import { SUBSCRIPTION_IDS, type SubscriptionId } from './session.ts';

/** The route's reply, and the whole set every time — see `parseMuteState`. */
export interface MuteState {
  /** `sessionKey` strings — `${subscription}:${sessionId}`. Sorted, so two replies compare equal. */
  readonly muted: readonly string[];
}

/** What a browser asks for: this session, muted or not. */
export interface MuteRequest {
  readonly sessionId: string;
  readonly subscription: SubscriptionId;
  readonly muted: boolean;
}

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * One mute request, or `undefined` if it is not one.
 *
 * `shortId` is NOT part of it, unlike every other session verb. The reason is the rule
 * `session-ref.ts` states rather than an exception to it: a short id is screened so hard there
 * because it is interpolated into a job-directory path and a command line. Nothing here reaches
 * either — a mute is a row in a local database keyed by two values that are checked for shape
 * anyway — so asking the deck for a third field it would only have to send back is ceremony.
 *
 * @throws never.
 */
export function parseMuteRequest(value: unknown): MuteRequest | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const fields: Readonly<Record<string, unknown>> = Object.fromEntries(Object.entries(value));
  const sessionId = fields['sessionId'];
  const muted = fields['muted'];
  const subscription = SUBSCRIPTION_IDS.find((id) => id === fields['subscription']);
  if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId)) return undefined;
  if (subscription === undefined || typeof muted !== 'boolean') return undefined;
  return { sessionId, subscription, muted };
}

/**
 * The set as it came back off the wire, or `undefined` if it is not one.
 *
 * A parser rather than a cast for the reason `parseSessionRow` gives: this is the frame that
 * reaches a browser, and the one place it has to be proven rather than assumed. A non-string entry
 * is dropped rather than coerced (CODING-STANDARDS §11 rule 1) — a `null` that became `"null"`
 * would be a mute nobody could ever clear.
 */
export function parseMuteState(value: unknown): MuteState | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const fields: Readonly<Record<string, unknown>> = Object.fromEntries(Object.entries(value));
  const held = fields['muted'];
  if (!Array.isArray(held)) return undefined;
  return { muted: held.filter((entry: unknown): entry is string => typeof entry === 'string') };
}
