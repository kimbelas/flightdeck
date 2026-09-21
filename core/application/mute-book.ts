// Which sessions are muted, held in memory over the store — P6-T3, SPEC §5.5.
//
// **In memory because the reader is on the toast path.** `ToastAnnouncer` asks "is this one muted?"
// for every reconciler event that could toast, which is several a second across both
// subscriptions, and `EventSink.publish` promises to return as soon as the event is accepted
// (core/ports/event-sink.ts). A SELECT per event would put the database in front of a sweep.
//
// **In the store because core raises the toast with no browser open** (D16). A mute that lived in
// the page would be one core could not read at 2 a.m., which is the hour this feature is for. The
// set is read once at construction and written through on every change — the store is the truth,
// this is the copy that is fast to ask.
//
// It answers "is this muted?" and nothing else. Whether a muted session should have toasted at all
// is `ToastAnnouncer`'s question, and a class that decided both would be two responsibilities (R1).
import { sessionKey } from '../../contracts/session-row.ts';
import type { SubscriptionId } from '../../contracts/session.ts';
import type { Clock } from '../ports/clock.ts';
import type { Logger } from '../ports/logger.ts';
import type { Store } from '../ports/store.ts';

export interface MuteBookParts {
  readonly store: Store;
  readonly clock: Clock;
  readonly logger: Logger;
}

export interface MuteTarget {
  readonly sessionId: string;
  readonly subscription: SubscriptionId;
}

export class MuteBook {
  private readonly store: Store;
  private readonly clock: Clock;
  private readonly logger: Logger;
  /** `sessionKey` strings. One definition of "the same row", shared with the deck and the grid. */
  private readonly muted: Set<string>;

  constructor(parts: MuteBookParts) {
    this.store = parts.store;
    this.clock = parts.clock;
    this.logger = parts.logger;
    this.muted = new Set(parts.store.mutedSessions().map((one) => sessionKey(one)));
  }

  /** @throws never — see the class header's first paragraph. */
  public isMuted(target: MuteTarget): boolean {
    return this.muted.has(sessionKey(target));
  }

  /** Every muted session as `sessionKey` strings, sorted so two reads compare equal. */
  public keys(): readonly string[] {
    return [...this.muted].sort();
  }

  /**
   * Mutes or unmutes one session, and answers with the whole set.
   *
   * The whole set rather than an acknowledgement, because the deck holds a copy of it: a reply
   * that said only "done" would leave the page to guess at what it now believes, and a page that
   * guessed wrong about a mute shows a switch in the wrong position.
   *
   * **The store is written first and the memory second.** The other order would leave a mute that
   * works until the next restart and then silently stops, which is the failure this whole class
   * exists to avoid.
   *
   * @throws never — a store that cannot be written is logged and the set is left alone, so the
   * deck's reply disagrees with the button the owner just pressed. That is the honest answer: the
   * mute really did not happen.
   */
  public set(target: MuteTarget, muted: boolean): readonly string[] {
    try {
      if (muted) this.store.muteSession(target.subscription, target.sessionId, this.now());
      else this.store.unmuteSession(target.subscription, target.sessionId);
    } catch {
      this.logger.warn('mute_not_stored', { subscription: target.subscription, muted });
      return this.keys();
    }
    if (muted) this.muted.add(sessionKey(target));
    else this.muted.delete(sessionKey(target));
    return this.keys();
  }

  private now(): number {
    return this.clock.now().getTime();
  }
}
