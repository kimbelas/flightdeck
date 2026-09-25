// The ledger's tables, as the summary `GET /analytics/spend` answers with — P7-T3.
//
// **Two queries and a pivot, and it is cheap enough to answer on every open.** The ledger has done
// the reading; what is left is two GROUP BYs over a table with one row per transcript per week — a
// few hundred rows on this machine — so unlike the observed reading (P3-T5) there is no button and
// no cache. The panel asks when it is opened and when somebody presses refresh.
//
// **It names nothing.** A row is keyed by the slug folder a transcript sits in, and whether that
// slug is an imported project is the deck's to say: it already holds the registry, and a name
// resolved here would be a second copy of "which folders are imported" that could disagree with
// the one on screen.
import {
  MAX_SPEND_PROJECTS,
  recentWeekStarts,
  totalOf,
  type ProjectSpend,
  type SpendCoverage,
  type SpendFigures,
  type SpendSummary,
  type SubscriptionSpend,
  type WeekSpend,
} from '../../contracts/spend-summary.ts';
import type { Clock } from '../ports/clock.ts';
import type { SpendCell, SpendStore } from '../ports/spend-store.ts';

export interface SpendReportParts {
  /** The store, narrowed to its two reads — a report writes nothing. */
  readonly store: Pick<SpendStore, 'spendByWeek' | 'spendByProject'>;
  /** How far the ledger has got — the "still reading" line in the panel. */
  readonly ledger: { progress(): SpendCoverage };
  readonly clock: Clock;
}

export class SpendReport {
  private readonly parts: SpendReportParts;

  constructor(parts: SpendReportParts) {
    this.parts = parts;
  }

  /** The last `SPEND_WEEKS` weeks, per subscription, and the projects they went to. */
  public summary(): SpendSummary {
    const now = this.parts.clock.now().getTime();
    const starts = recentWeekStarts(now);
    const since = starts[0] ?? now;
    const projects = byKey(this.parts.store.spendByProject(since))
      .map(([projectKey, subscriptions]) => ({ projectKey, subscriptions }))
      .sort(costliestFirst);
    return {
      at: now,
      weeks: weeksOf(starts, this.parts.store.spendByWeek(since)),
      projects: projects.slice(0, MAX_SPEND_PROJECTS),
      otherProjects: Math.max(0, projects.length - MAX_SPEND_PROJECTS),
      coverage: this.parts.ledger.progress(),
    };
  }
}

/** Every week in the window, oldest first — including the ones with nothing in them. */
function weeksOf(starts: readonly number[], cells: readonly SpendCell<number>[]): WeekSpend[] {
  const held = new Map(byKey(cells));
  return starts.map((weekStart) => ({ weekStart, subscriptions: held.get(weekStart) ?? [] }));
}

/** Cells grouped by their key, each group a subscription list in the store's order. */
function byKey<Key>(cells: readonly SpendCell<Key>[]): [Key, SubscriptionSpend[]][] {
  const grouped = new Map<Key, SubscriptionSpend[]>();
  for (const cell of cells) {
    const shares = grouped.get(cell.key) ?? [];
    shares.push({ subscription: cell.subscription, figures: figuresOf(cell) });
    grouped.set(cell.key, shares);
  }
  return [...grouped];
}

function figuresOf(cell: SpendCell<unknown>): SpendFigures {
  return { ...cell.amount, sessions: cell.sessions };
}

/** Costliest first, then by key, so a tie does not reorder between two opens. */
function costliestFirst(left: ProjectSpend, right: ProjectSpend): number {
  const difference = totalOf(right.subscriptions).costUsd - totalOf(left.subscriptions).costUsd;
  return difference !== 0 ? difference : left.projectKey.localeCompare(right.projectKey);
}
