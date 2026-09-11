// SEC-HTTP-6 — the last of P1-T10's controls, landed with the first route that needs it (P1-T5).
//
// Two budgets, because the two callers are nothing alike. A person clicking the deck makes a few
// mutating requests a minute and 60 is generous; a machine sending hook events makes one per turn
// per session and 600 is generous. One number for both would have to be the larger, which is not a
// limit on the deck at all.
//
// **What this is actually for.** Not a hostile page — SEC-HTTP-1/2/5 refuse one before it gets
// here, and a leaked token is the case where this is the last line rather than the first. It is for
// the runaway: a hook loop, a session respawning itself, a script wedged on retry. Those look
// exactly like traffic and the only thing that distinguishes them is rate.
//
// **Fixed windows, not a sliding log.** A window boundary lets through up to two budgets in one
// minute, and that is accepted: the alternative keeps a timestamp per request, which is a data
// structure that grows with the attack it is defending against. A counter per key cannot.
import type { Clock } from '../ports/clock.ts';

const WINDOW_MS = 60_000;

/**
 * How many keys may be tracked before expired ones are swept.
 *
 * A key is a session id, so the honest number is "how many sessions exist" — ten on this machine.
 * The cap exists because a caller that could invent keys could otherwise grow this map without
 * limit, and sweeping on every call would make the common case pay for the hostile one.
 */
const SWEEP_ABOVE = 256;

interface Window {
  /** When the current window began, in epoch ms. */
  startedAt: number;
  count: number;
}

export class RateLimiter {
  private readonly clock: Clock;
  private readonly windows = new Map<string, Window>();

  constructor(clock: Clock) {
    this.clock = clock;
  }

  /** How many keys are being tracked. A key per dead session that never expires is a leak. */
  public get tracked(): number {
    return this.windows.size;
  }

  /**
   * Counts one request against `key` and says whether it may proceed.
   *
   * @param key what is being limited — the token for control routes, `hook:<session id>` for
   * ingestion. Distinct prefixes so a session can never spend the deck's budget.
   * @param perMinute the budget, from the two constants above.
   * @returns `false` when the budget is spent, which the caller turns into a `429`.
   */
  public allow(key: string, perMinute: number): boolean {
    const now = this.clock.now().getTime();
    if (this.windows.size > SWEEP_ABOVE) this.sweep(now);

    const window = this.windows.get(key);
    if (window === undefined || now - window.startedAt >= WINDOW_MS) {
      this.windows.set(key, { startedAt: now, count: 1 });
      return true;
    }
    window.count += 1;
    return window.count <= perMinute;
  }

  /** Drops every window that has expired. Called only when the map is larger than it should be. */
  private sweep(now: number): void {
    for (const [key, window] of [...this.windows]) {
      if (now - window.startedAt >= WINDOW_MS) this.windows.delete(key);
    }
  }
}
