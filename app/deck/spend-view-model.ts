// What the cost panel draws — P7-T3, SPEC §6(9): cost per project, subscription and week.
//
// **Every decision the panel makes is here, with a test** (CODING-STANDARDS §3): which weeks, how
// tall a bar is, what a slug is called, and the sentence that says the ledger is still reading.
// The component only lays these out.
//
// **A slug is named by the registry, or not at all.** A transcript records the folder it ran in as
// a slug, and the only folders the deck can put a NAME to are the ones the owner imported —
// matched through `projectSlug`, the spelling core uses to find their transcripts. Anything else is
// shown as the slug itself, which is honest: it is the only thing anyone knows about it.
import { projectSlug, type ProjectRecord } from '../../contracts/project.ts';
import { SUBSCRIPTION_IDS, type SubscriptionId } from '../../contracts/session.ts';
import {
  NO_SPEND,
  addFigures,
  totalOf,
  type SpendCoverage,
  type SpendSummary,
  type SubscriptionSpend,
} from '../../contracts/spend-summary.ts';

/** A worktree under `.claude\worktrees` is `<project slug>--claude-worktrees-<name>`. */
const WORKTREE_INFIX = '--claude-worktrees-';

export interface SpendBar {
  readonly subscription: SubscriptionId;
  /** Share of the TALLEST week, 0–100, so the bars compare across weeks. */
  readonly percent: number;
  readonly cost: string;
}

export interface SpendWeekLine {
  readonly weekStart: number;
  /** `Sep 21` — the Monday that starts it. */
  readonly label: string;
  readonly cost: string;
  readonly sessions: number;
  readonly bars: readonly SpendBar[];
  readonly current: boolean;
}

export interface SpendProjectLine {
  readonly key: string;
  /** The imported project's name, or the slug when it is not one. */
  readonly label: string;
  readonly imported: boolean;
  readonly cost: string;
  readonly sessions: number;
  /** `365 $4.10 · isg $0.40` — which account it went on. */
  readonly split: string;
  readonly lines: string;
}

export interface SpendTotalLine {
  readonly subscription: SubscriptionId;
  readonly cost: string;
}

export class SpendViewModel {
  private readonly summary: SpendSummary;
  private readonly slugs: ReadonlyMap<string, string>;

  /** @param projects the imported folders — what names a slug. */
  constructor(summary: SpendSummary, projects: readonly ProjectRecord[]) {
    this.summary = summary;
    this.slugs = new Map(
      projects.map((project) => [projectSlug(project.path).toLowerCase(), project.name]),
    );
  }

  /** Oldest first, as the summary gives them — a chart reads left to right. */
  public get weeks(): readonly SpendWeekLine[] {
    const tallest = Math.max(
      0,
      ...this.summary.weeks.map((week) => totalOf(week.subscriptions).costUsd),
    );
    const last = this.summary.weeks.at(-1)?.weekStart;
    return this.summary.weeks.map((week) => {
      const total = totalOf(week.subscriptions);
      return {
        weekStart: week.weekStart,
        label: weekLabel(week.weekStart),
        cost: money(total.costUsd),
        sessions: total.sessions,
        bars: ordered(week.subscriptions).map((share) => ({
          subscription: share.subscription,
          percent: tallest === 0 ? 0 : Math.round((share.figures.costUsd / tallest) * 100),
          cost: money(share.figures.costUsd),
        })),
        current: week.weekStart === last,
      };
    });
  }

  /** The window's cost per subscription. Summed over weeks — costs add, sessions would not. */
  public get totals(): readonly SpendTotalLine[] {
    return SUBSCRIPTION_IDS.map((subscription) => ({
      subscription,
      cost: money(
        this.summary.weeks
          .flatMap((week) => week.subscriptions)
          .filter((share) => share.subscription === subscription)
          .reduce((sum, share) => sum + share.figures.costUsd, 0),
      ),
    }));
  }

  /**
   * This week, both accounts — the header's figure on the State board (P10-T1).
   *
   * The newest week the summary carries, which is the one that contains its `at`: the summary
   * always ends on the current week, empty or not, because a gap is data (`SPEND_WEEKS`).
   */
  public get thisWeek(): string {
    return money(cost(this.summary.weeks.at(-1)?.subscriptions ?? []));
  }

  /** The whole window, both accounts. */
  public get total(): string {
    return money(this.summary.weeks.reduce((sum, week) => sum + cost(week.subscriptions), 0));
  }

  public get projects(): readonly SpendProjectLine[] {
    return this.summary.projects.map((project) => {
      const total = project.subscriptions.reduce(
        (sum, share) => addFigures(sum, share.figures),
        NO_SPEND,
      );
      const label = this.labelFor(project.projectKey);
      return {
        key: project.projectKey,
        label: label ?? project.projectKey,
        imported: label !== undefined,
        cost: money(total.costUsd),
        sessions: total.sessions,
        split: ordered(project.subscriptions)
          .map((share) => `${share.subscription} ${money(share.figures.costUsd)}`)
          .join(' · '),
        lines: `+${String(total.linesAdded)} −${String(total.linesRemoved)}`,
      };
    });
  }

  /** `and 3 more folders`, or `undefined` when every folder that spent is listed. */
  public get more(): string | undefined {
    const more = this.summary.otherProjects;
    if (more === 0) return undefined;
    return `and ${String(more)} more folder${more === 1 ? '' : 's'}`;
  }

  /** Whether any week in the window spent anything — an empty window says so in words. */
  public get empty(): boolean {
    return this.summary.weeks.every((week) => week.subscriptions.length === 0);
  }

  /**
   * How much of the history is in these numbers.
   *
   * P7-T1's lesson, said out loud: a first boot reads the transcripts over a few minutes, and a
   * week that looks cheap because it has not been read yet must not read as a cheap week.
   */
  public get coverage(): string {
    return coverageLine(this.summary.coverage);
  }

  /** Whether the ledger is still catching up — the panel dims the note until it is not. */
  public get filling(): boolean {
    const { passes, behind } = this.summary.coverage;
    return passes === 0 || behind > 0;
  }

  /**
   * An imported folder's name for a slug, or `undefined`. Case-blind, because the slug is spelt
   * from the cwd a session was started in and the registry holds the path `realpath` returned.
   */
  private labelFor(key: string): string | undefined {
    const lower = key.toLowerCase();
    const exact = this.slugs.get(lower);
    if (exact !== undefined) return exact;
    const at = lower.indexOf(WORKTREE_INFIX);
    if (at === -1) return undefined;
    const parent = this.slugs.get(lower.slice(0, at));
    return parent === undefined
      ? undefined
      : `${parent} · ${key.slice(at + WORKTREE_INFIX.length)}`;
  }
}

function coverageLine(coverage: SpendCoverage): string {
  if (coverage.passes === 0) return 'Core has not read the transcripts yet since it started.';
  if (coverage.behind > 0) {
    return `Still reading: ${String(coverage.behind)} of ${String(coverage.transcripts)} transcripts have more to read, so these numbers are low.`;
  }
  return `Every one of ${String(coverage.transcripts)} transcripts read. A session's cost lands when it exits.`;
}

/** The two accounts in their fixed order, so a bar never swaps colour between weeks. */
function ordered(shares: readonly SubscriptionSpend[]): readonly SubscriptionSpend[] {
  return SUBSCRIPTION_IDS.flatMap((id) => shares.filter((share) => share.subscription === id));
}

function cost(shares: readonly SubscriptionSpend[]): number {
  return totalOf(shares).costUsd;
}

/** Dollars to the cent — the header's and the observed panel's spelling. */
function money(usd: number): string {
  return `$${usd.toFixed(2)}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `Sep 21`. Spelt by hand rather than by `toLocaleDateString`, so every browser says the same. */
function weekLabel(weekStart: number): string {
  const day = new Date(weekStart);
  return `${MONTHS[day.getMonth()] ?? ''} ${String(day.getDate())}`;
}
