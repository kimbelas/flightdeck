// An in-memory roster — the fake for `RosterSource` (CODING-STANDARDS §10.1).
//
// It takes what the real adapter RETURNS (a `RosterView`), not what the real file contains, and
// that is the point: a fake that accepted raw roster JSON would need its own copy of
// `projectRoster`, and a second projection is a second opinion about which fields are allowed.
// The allowlist is proven once, against the contract, in tests/contracts/daemon-roster.test.ts.
import type { RosterView } from '../../contracts/daemon-roster.ts';
import type { SubscriptionId } from '../../contracts/session.ts';
import type { RosterSource } from '../../core/ports/roster-source.ts';

export class FakeRosterSource implements RosterSource {
  /** Which subscriptions have been asked about, in order — for asserting a caller's reach. */
  public readonly reads: SubscriptionId[] = [];

  private readonly rosters = new Map<SubscriptionId, RosterView>();

  /** Gives one subscription a roster. A subscription with none returns `undefined`, as the real one does. */
  public willReturn(subscription: SubscriptionId, view: RosterView): this {
    this.rosters.set(subscription, view);
    return this;
  }

  public read(subscription: SubscriptionId): RosterView | undefined {
    this.reads.push(subscription);
    return this.rosters.get(subscription);
  }
}

/** A view with the allowlisted fields set, for a test that does not care about the numbers. */
export function rosterView(overrides: Partial<RosterView> = {}): RosterView {
  return {
    proto: 1,
    supervisorPid: 3828,
    updatedAt: 1_789_123_114_141,
    workers: {},
    ...overrides,
  };
}
