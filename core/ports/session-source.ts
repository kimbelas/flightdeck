// Where the list of live sessions comes from.
//
// One sweep answers for one subscription, because the two config dirs are two separate `claude`
// invocations and one being slow or broken must not lose the other (RESEARCH.md B.2: ~763 ms per
// dir). The reconciler in P1-T4 will call this on a timer; for now the route calls it on demand.
import type { SubscriptionId } from '../../contracts/session.ts';
import type { Session } from '../domain/session.ts';

export interface Sweep {
  readonly subscription: SubscriptionId;
  readonly sessions: readonly Session[];
  /** True when the CLI could not be read at all — distinct from "no sessions", which is normal. */
  readonly failed: boolean;
  /** Records the listing carried that this build could not name (contracts/agents-listing.ts). */
  readonly skipped: number;
}

export interface SessionSource {
  /** @throws never — a subscription that cannot be read comes back as `failed`, not an exception. */
  sweep(subscription: SubscriptionId): Promise<Sweep>;
}
