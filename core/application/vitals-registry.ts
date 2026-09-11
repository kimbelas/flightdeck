// The newest vitals for each session, and the question "is this worth telling anyone about?"
//
// The statusLine posts on **every render** — a fresh `python.exe` each time (RESEARCH.md F.3.1) —
// and almost none of those renders carry news. Publishing an event per render would put hundreds of
// lines a minute per session into the log and, from P1-T8, into the store, to say the same thing
// over and over. So this holds the last report and answers whether the new one differs in a way
// anybody downstream would draw differently. It is the same shape as the reconciler's `sameRow`,
// for the same reason: a `changed` event for something that did not change is worse than no event.
//
// **What counts as different is deliberately short**: context percentage, cost, the two quota
// percentages, the model and the session name. Not `total_duration_ms`, which moves every render
// by definition; not `prompt_cache`, which moves constantly and is nobody's decision. The test is
// "would the deck paint a different pixel".
//
// **`undefined` is not zero.** A fresh session reports `used_percentage: null` and a session that
// has spoken reports a number; the transition between them is a real change and the comparison
// below sees it, because both sides stay `undefined` rather than being coerced (F.3.5).
import type { StatuslineReport } from '../../contracts/statusline-report.ts';
import type { SubscriptionId } from '../../contracts/session.ts';

/**
 * How many sessions to remember vitals for.
 *
 * There are ten on this machine and a few hundred in a long week of a core that never restarts.
 * The cap is not about memory — each entry is small — it is about a map that only ever grows being
 * the kind of thing nobody notices until it matters. Eviction is least-recently-updated.
 */
const MAX_SESSIONS = 200;

export interface Vitals {
  readonly report: StatuslineReport;
  readonly subscription: SubscriptionId;
  /** When this render was received, epoch ms. What makes a stale entry visible as stale. */
  readonly at: number;
}

export class VitalsRegistry {
  private readonly latest = new Map<string, Vitals>();

  /** How many sessions are remembered. Capped — see `MAX_SESSIONS`. */
  public get size(): number {
    return this.latest.size;
  }

  /**
   * Records one render.
   *
   * @returns whether it said something new. `true` for the first report of a session, because
   * "this session now has vitals" is itself the news.
   */
  public record(report: StatuslineReport, subscription: SubscriptionId, at: number): boolean {
    const previous = this.latest.get(report.sessionId);
    // Delete before set, so the insertion order stays least-recently-updated first and the
    // eviction below drops the session nobody has heard from in the longest.
    this.latest.delete(report.sessionId);
    this.latest.set(report.sessionId, { report, subscription, at });
    this.evictOldest();
    return previous === undefined || differs(previous.report, report);
  }

  /** The newest vitals for one session, or `undefined` if none have arrived. */
  public get(sessionId: string): Vitals | undefined {
    return this.latest.get(sessionId);
  }

  /** Everything known, newest-updated last. `flightdeck-core status` reads this (P1-T12). */
  public all(): readonly Vitals[] {
    return [...this.latest.values()];
  }

  private evictOldest(): void {
    if (this.latest.size <= MAX_SESSIONS) return;
    const oldest = this.latest.keys().next();
    if (!oldest.done) this.latest.delete(oldest.value);
  }
}

/** Field by field, and only the fields a reader would draw differently. See the header. */
function differs(previous: StatuslineReport, next: StatuslineReport): boolean {
  return (
    previous.usedPercentage !== next.usedPercentage ||
    previous.costUsd !== next.costUsd ||
    previous.modelId !== next.modelId ||
    previous.sessionName !== next.sessionName ||
    previous.fiveHour.usedPercentage !== next.fiveHour.usedPercentage ||
    previous.sevenDay.usedPercentage !== next.sevenDay.usedPercentage
  );
}
