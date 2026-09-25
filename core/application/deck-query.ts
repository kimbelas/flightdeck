// Both subscriptions, one snapshot — the read side of the deck.
//
// The two sweeps run concurrently and are independent: RESEARCH.md B.2 measured ~763 ms per config
// dir, so serialising them doubles the wait for no reason, and one subscription being unreadable
// must never hide the other's sessions. A failed sweep is reported as `unreadable`, not as empty —
// "no sessions" and "I could not look" are different answers and the deck shows them differently.
//
// **A sweep cannot see an ended interactive session, so the reconciler's memory is merged in**
// (P6-T7). `claude agents --json --all` forgets one the moment its terminal closes (G.55), which
// is precisely why the reconciler holds it; a `GET /sessions` built from the listing alone would
// clear the adopt offer on every refresh and the next stream frame would put it back. Merged
// rather than preferred: a sweep that DOES carry the session — because somebody adopted it, and
// it is a background job now — is the newer answer and wins.
import {
  byAttentionThenAge,
  sessionKey,
  type DeckSnapshot,
  type SessionRow,
} from '../../contracts/session-row.ts';
import { SUBSCRIPTION_IDS, type SubscriptionId } from '../../contracts/session.ts';
import type { Clock } from '../ports/clock.ts';
import type { SessionSource } from '../ports/session-source.ts';
import { toSessionRow } from './session-rows.ts';

/**
 * Who remembers the sessions a sweep can no longer see — P6-T7.
 *
 * An interface rather than the `Reconciler` itself, for `SessionForker`'s reason: this class needs
 * one getter, and taking the whole reconciler would make the read side of the deck depend on the
 * timer, the watcher and the event sink to answer one question.
 */
export interface EndedSessions {
  readonly ended: readonly SessionRow[];
  /**
   * The row with the ending the reconciler read off `daemon.log` for it (D62). A fresh sweep says
   * `state: done` and nothing more; without this a refresh would turn "retired while waiting for
   * you" back into "done" until the next stream frame.
   */
  explain(row: SessionRow): SessionRow;
}

const NOTHING_REMEMBERED: EndedSessions = { ended: [], explain: (row) => row };

export class DeckQuery {
  private readonly source: SessionSource;
  private readonly clock: Clock;
  private readonly memory: EndedSessions;

  /**
   * @param memory what a sweep cannot see. Defaulted to nothing so a caller that only wants the
   * listing — every test of this class before P6-T7 — does not have to supply an empty one.
   */
  constructor(source: SessionSource, clock: Clock, memory: EndedSessions = NOTHING_REMEMBERED) {
    this.source = source;
    this.clock = clock;
    this.memory = memory;
  }

  public async snapshot(): Promise<DeckSnapshot> {
    const sweeps = await Promise.all(SUBSCRIPTION_IDS.map((id) => this.source.sweep(id)));

    const rows: SessionRow[] = [];
    const unreadable: SubscriptionId[] = [];
    const swept = new Set<string>();
    for (const sweep of sweeps) {
      if (sweep.failed) unreadable.push(sweep.subscription);
      for (const session of sweep.sessions) {
        const row = this.memory.explain(toSessionRow(session));
        swept.add(sessionKey(row));
        rows.push(row);
      }
    }
    // P6-T7. Only the ones the listing did not carry, and only for a subscription that answered:
    // a sweep that failed had no gone-detection run against it either (`Reconciler`), so adding
    // its remembered rows here would be this class forming an opinion the reconciler declined to.
    for (const row of this.memory.ended) {
      if (swept.has(sessionKey(row))) continue;
      if (unreadable.includes(row.subscription)) continue;
      rows.push(row);
    }

    // Attention first, then newest — the comparator moved to contracts/ in P1-T9, when the stream's
    // replay and the browser's re-sort became the second and third callers. The deck's real
    // ordering arrives with P2-T4; this is enough to keep a blocked session off the bottom.
    rows.sort(byAttentionThenAge);
    return { rows, unreadable, takenAt: this.clock.now().getTime() };
  }
}
