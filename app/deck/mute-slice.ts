// Which sessions the deck believes are silenced — P6-T3, SPEC §5.5.
//
// **The deck holds a copy and core holds the truth**, and every method here exists to keep those
// from drifting. Core raises the toast with no browser open (D16), so the set cannot live in the
// page; but the switch on a pane has to know which way up it is without asking, so it cannot live
// only in core either.
//
// The rule that keeps them together is that **the copy is only ever replaced by what core
// answered**. Nothing here toggles a local boolean and hopes: a press sends the new position and
// takes the whole set back, so a mute the store refused to keep shows the switch springing back
// rather than staying where the finger left it. That is the honest picture — the mute really did
// not happen (`MuteBook.set`).
//
// **It is a slice, not a second store.** One `DeckState`, one set of subscribers; it is handed the
// API port and a way to publish, and holds nothing of its own.
import { CORE_MUTES_PATH } from '../../contracts/deck-routes.ts';
import { parseMuteState } from '../../contracts/session-mute.ts';
import type { SubscriptionId } from '../../contracts/session.ts';
import type { DeckApi } from './deck-api.ts';

/** `sessionKey` strings — `${subscription}:${sessionId}`, the deck's one name for a row. */
export type Muted = readonly string[];

export class MuteSlice {
  private readonly api: DeckApi;
  private readonly publish: (muted: Muted) => void;
  private held: Muted = [];

  constructor(api: DeckApi, publish: (muted: Muted) => void) {
    this.api = api;
    this.publish = publish;
  }

  /**
   * Reads the set core is actually working from.
   *
   * Called on connect and on refresh, because a mute outlives the page: the owner may have set it
   * yesterday, or from another tab, and a deck that assumed an empty set would draw every switch
   * in the wrong position until something was pressed.
   *
   * A read that fails leaves the set alone rather than emptying it. An unreachable core is an
   * ordinary state the deck renders (F.3.3), and "we could not ask" is not "nothing is muted".
   */
  public async load(): Promise<void> {
    this.accept(await this.api.get(CORE_MUTES_PATH));
  }

  /**
   * Sets one session's switch and takes the whole set back.
   *
   * `muted` is the position being ASKED for rather than a toggle, so two presses that raced would
   * agree about where the switch ends up rather than swapping it twice.
   */
  public async set(subscription: SubscriptionId, sessionId: string, muted: boolean): Promise<void> {
    this.accept(await this.api.post(CORE_MUTES_PATH, { sessionId, subscription, muted }));
  }

  private accept(reply: { readonly status: number; readonly body: unknown } | undefined): void {
    if (reply?.status !== 200) return;
    const state = parseMuteState(reply.body);
    if (state === undefined) return;
    this.held = state.muted;
    this.publish(this.held);
  }
}
