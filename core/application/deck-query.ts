// Both subscriptions, one snapshot — the read side of the deck.
//
// The two sweeps run concurrently and are independent: RESEARCH.md B.2 measured ~763 ms per config
// dir, so serialising them doubles the wait for no reason, and one subscription being unreadable
// must never hide the other's sessions. A failed sweep is reported as `unreadable`, not as empty —
// "no sessions" and "I could not look" are different answers and the deck shows them differently.
import type { DeckSnapshot, SessionRow } from '../../contracts/session-row.ts';
import { SUBSCRIPTION_IDS, type SubscriptionId } from '../../contracts/session.ts';
import type { Clock } from '../ports/clock.ts';
import type { SessionSource } from '../ports/session-source.ts';
import { toSessionRow } from './session-rows.ts';

export class DeckQuery {
  private readonly source: SessionSource;
  private readonly clock: Clock;

  constructor(source: SessionSource, clock: Clock) {
    this.source = source;
    this.clock = clock;
  }

  public async snapshot(): Promise<DeckSnapshot> {
    const sweeps = await Promise.all(SUBSCRIPTION_IDS.map((id) => this.source.sweep(id)));

    const rows: SessionRow[] = [];
    const unreadable: SubscriptionId[] = [];
    for (const sweep of sweeps) {
      if (sweep.failed) unreadable.push(sweep.subscription);
      for (const session of sweep.sessions) rows.push(toSessionRow(session));
    }

    // Attention first, then newest. The deck's real ordering arrives with P2-T4; this is enough
    // to keep a blocked session off the bottom of the list.
    rows.sort(byAttentionThenAge);
    return { rows, unreadable, takenAt: this.clock.now().getTime() };
  }
}

function byAttentionThenAge(left: SessionRow, right: SessionRow): number {
  const leftBlocked = left.runState === 'blocked' ? 0 : 1;
  const rightBlocked = right.runState === 'blocked' ? 0 : 1;
  if (leftBlocked !== rightBlocked) return leftBlocked - rightBlocked;
  if (left.live !== right.live) return left.live ? -1 : 1;
  return right.startedAt - left.startedAt;
}
