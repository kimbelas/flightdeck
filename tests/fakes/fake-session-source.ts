// In-memory SessionSource — CODING-STANDARDS §10.1.
//
// Promoted out of tests/core/application/deck-query.test.ts, where it was `StubSource`. The
// reconciler (P1-T4) needs the same thing, and the half that matters to it is the half a stub
// built for DeckQuery did not have: a subscription that FAILS. One dir being unreadable must not
// lose the other (RESEARCH.md B.2), and that is not testable against a source that always answers.
import type { SubscriptionId } from '../../contracts/session.ts';
import type { Session } from '../../core/domain/session.ts';
import type { SessionSource, Sweep } from '../../core/ports/session-source.ts';

export class FakeSessionSource implements SessionSource {
  public readonly swept: SubscriptionId[] = [];
  private readonly sweeps = new Map<SubscriptionId, Sweep>();
  private readonly rejecting = new Set<SubscriptionId>();

  /** How many times each subscription was swept — the reconciler's timer asserts on this. */
  public sweepCount(subscription: SubscriptionId): number {
    return this.swept.filter((id) => id === subscription).length;
  }

  /** The primitive: answer this subscription with exactly this sweep. */
  public willSweep(sweep: Sweep): void {
    this.sweeps.set(sweep.subscription, sweep);
  }

  public willReturn(subscription: SubscriptionId, sessions: readonly Session[]): void {
    this.willSweep({ subscription, sessions, failed: false, skipped: 0 });
  }

  /** A subscription whose CLI could not be read at all — distinct from one with no sessions. */
  public willFail(subscription: SubscriptionId): void {
    this.willSweep({ subscription, sessions: [], failed: true, skipped: 0 });
  }

  /**
   * A source that REJECTS rather than reporting a failure — what a synchronous `spawn` throw looked
   * like before the adapter stopped doing it (RESEARCH.md G.10). Nothing may die of this.
   */
  public willReject(subscription: SubscriptionId): void {
    this.rejecting.add(subscription);
  }

  /** A sweep that read the listing but could not name some of it (`Sweep.skipped`). */
  public willSkip(subscription: SubscriptionId, skipped: number): void {
    this.willSweep({ subscription, sessions: [], failed: false, skipped });
  }

  public sweep(subscription: SubscriptionId): Promise<Sweep> {
    this.swept.push(subscription);
    if (this.rejecting.has(subscription)) return Promise.reject(new Error('spawn UNKNOWN'));
    return Promise.resolve(
      this.sweeps.get(subscription) ?? { subscription, sessions: [], failed: false, skipped: 0 },
    );
  }
}
