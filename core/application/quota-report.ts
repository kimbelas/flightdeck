// What the `quota` frame carries, assembled from the registry — P2-T3.
//
// The twin of `StatusReport` and deliberately as thin: it owns nothing and decides nothing. The
// decisions — which reading represents a subscription, what counts towards today's spend — are in
// `summariseQuota`, which is pure and in `contracts/`, because both of those are rules the deck
// and the CLI must apply identically and neither is a rule about time or I/O.
//
// **What is left here is the clock**, and it is here rather than in the projection for the usual
// reason (CODING-STANDARDS §10.1): "today" is a question about the machine's timezone and the
// instant it is asked, and a projection that read `Date.now()` could not be tested against a fixed
// boundary. The `Clock` port answers both, and the projection takes two numbers.
//
// **It reads, it never sweeps** — the same promise `StatusReport` makes. This runs once per
// subscriber connect and once per vitals event, and a vitals event can arrive every few seconds on
// a busy machine, so it must stay a walk over at most `MAX_SESSIONS` in-memory entries.
import { summariseQuota, type QuotaSummary } from '../../contracts/quota-summary.ts';
import type { Clock } from '../ports/clock.ts';
import { vitalsLines } from './vitals-lines.ts';
import type { VitalsRegistry } from './vitals-registry.ts';

export interface QuotaReportParts {
  readonly vitals: VitalsRegistry;
  readonly clock: Clock;
}

export class QuotaReport {
  private readonly vitals: VitalsRegistry;
  private readonly clock: Clock;

  constructor(parts: QuotaReportParts) {
    this.vitals = parts.vitals;
    this.clock = parts.clock;
  }

  /** Both subscriptions, now. Always both, even when neither has ever reported (summariseQuota). */
  public summary(): QuotaSummary {
    const now = this.clock.now();
    return summariseQuota(vitalsLines(this.vitals), {
      at: now.getTime(),
      spendSince: startOfLocalDay(now).getTime(),
    });
  }
}

/**
 * Local midnight, not UTC midnight.
 *
 * "Spend today" is a question the owner asks about their own day. A UTC boundary would roll the
 * number over at 8 pm or 1 am depending on the season, which is the kind of wrongness that looks
 * like a lost session rather than like a timezone.
 */
function startOfLocalDay(now: Date): Date {
  const start = new Date(now.getTime());
  start.setHours(0, 0, 0, 0);
  return start;
}
