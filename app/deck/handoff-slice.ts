// Pressing hand off — P6-T6, SPEC §6(8).
//
// **The one verb in the deck that ADDS a session without being able to lose one.** The original
// keeps its id, its name and its conversation; the fork is a second row that appears on the next
// sweep. That is what makes this safe to press, and it is why there is no confirm step in front of
// it where `rm` has an armed second button.
//
// It keeps the last refusal and nothing else. There is no report to hold, unlike a group press: a
// handoff either made one session or did not, and the session itself is the result — it arrives in
// the list through the stream like every other row, rather than being drawn from this reply.
//
// **There is no `clear`, and that is not an omission.** `handOff` clears the refusal before it
// posts, so the next press always starts from silence; a separate dismiss would only exist to hide
// a refusal without acting on it, which is a button that makes the deck less true.
//
// **It is a slice, not a second store.** One `DeckState`, one set of subscribers.
import { CORE_HANDOFF_PATH } from '../../contracts/deck-routes.ts';
import { parseHandoffFailure, type HandoffFailure } from '../../contracts/launch-reply.ts';
import type { SessionRef } from '../../contracts/session-ref.ts';
import type { DeckApi } from './deck-api.ts';

/** The field of `DeckState` this slice touches. */
export interface HandoffHeld {
  /** Why the last handoff was refused, as core's code. `undefined` once one is accepted. */
  readonly handoffRefusal: HandoffFailure | undefined;
}

export class HandoffSlice {
  private readonly api: DeckApi;
  private readonly publish: (changes: Partial<HandoffHeld>) => void;

  constructor(api: DeckApi, publish: (changes: Partial<HandoffHeld>) => void) {
    this.api = api;
    this.publish = publish;
  }

  /**
   * Forks one session into a worktree.
   *
   * @returns whether core made the fork. The new session is NOT returned to the caller and must
   * not be: it arrives on the stream a sweep later like every other row, and a deck that drew it
   * from this reply would be holding a row core has not yet said exists.
   */
  public async handOff(ref: SessionRef, cwd: string, name: string): Promise<boolean> {
    this.publish({ handoffRefusal: undefined });
    const reply = await this.api.post(CORE_HANDOFF_PATH, {
      sessionId: ref.sessionId,
      shortId: ref.shortId,
      subscription: ref.subscription,
      cwd,
      name,
    });
    if (reply?.status === 201) return true;
    this.publish({ handoffRefusal: refusalOf(reply?.body) });
    return false;
  }
}

/**
 * Core's code out of an error body, or `handoff_failed`.
 *
 * `handoff_failed` is the honest fallback for a reply that never came: the fork may well have
 * happened, and every other code here would claim to know something about why it did not.
 */
function refusalOf(body: unknown): HandoffFailure {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return 'handoff_failed';
  const fields: Readonly<Record<string, unknown>> = Object.fromEntries(Object.entries(body));
  return parseHandoffFailure(fields['error']) ?? 'handoff_failed';
}
