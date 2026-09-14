// One expanded row's presentation, decided outside React — P2-T4, CODING-STANDARDS §3.
//
// The same job `SessionRowViewModel` does for a collapsed row, and the reason is sharper here:
// almost every field of a detail is absent most of the time, so the component would otherwise be a
// wall of `?.` and `??`. What is left in the component is markup.
//
// **"Doing now" has three sources and a precedence, and that precedence is the product.** The
// daemon's `state.json` says what the session is doing in a sentence it wrote itself (F.2.4); the
// transcript's last `tool_use` is SPEC §5.5's ◇ fallback; and a blocked session's `needs` outranks
// both, because "what does this want from me" is the question the deck exists to answer. So:
// `needs` first, then `detail`, then the tool. A component choosing that with nested ternaries is
// a component nobody can test.
//
// **Every string here is model-written and display-only** (SEC-UI-2). Nothing below interprets one,
// branches on its contents, or turns a `files` entry into a link — a path in that list came out of
// a transcript, and making it clickable would be making model output actionable. They are already
// capped upstream (contracts/job-state.ts); this only decides what is shown.
import type { JobState, TimelineEntry } from '../../contracts/job-state.ts';
import type { SessionDetail, TokenPoint } from '../../contracts/session-detail.ts';

/** How many timeline entries the recap shows. The rest are read in the session, not here. */
const RECAP_ENTRIES = 8;

/** How many touched files are listed before the count takes over. */
const SHOWN_FILES = 8;

/** What the row says it is doing, and where that came from — the badge differs per source. */
export type DoingSource = 'needs' | 'detail' | 'tool' | 'none';

export interface DoingNow {
  readonly text: string;
  readonly source: DoingSource;
}

export class SessionDetailViewModel {
  private readonly detail: SessionDetail;

  constructor(detail: SessionDetail) {
    this.detail = detail;
  }

  /**
   * What this session is doing, in one line, from whichever source has the best answer.
   *
   * See the header for the precedence. `none` is an honest state and not a failure: an interactive
   * session has no job file, and one that has not run a tool has nothing to report yet.
   */
  public get doingNow(): DoingNow {
    const job: JobState | undefined = this.detail.job;
    if (job?.needs !== undefined) return { text: job.needs, source: 'needs' };
    if (job?.detail !== undefined) return { text: job.detail, source: 'detail' };
    const tool = this.detail.extras.lastTool;
    if (tool !== undefined) return { text: `running ${tool}`, source: 'tool' };
    return { text: 'nothing to report yet', source: 'none' };
  }

  /** True when this session is waiting on the owner — the one thing worth colouring (D29). */
  public get needsYou(): boolean {
    return this.detail.job?.needs !== undefined;
  }

  /** The owner's first prompt. Not model text — the one string here that a person typed. */
  public get intent(): string | undefined {
    return this.detail.job?.intent ?? this.detail.extras.lastPrompt;
  }

  public get title(): string | undefined {
    return this.detail.extras.title;
  }

  public get agent(): string | undefined {
    return this.detail.extras.agent;
  }

  /**
   * The away recap, newest first, capped.
   *
   * Reversed here rather than in the contract: the file is oldest-first and that is the right order
   * on disk, but "what happened while I was away" is read newest-first, like a notification list.
   */
  public get recap(): readonly TimelineEntry[] {
    return [...this.detail.timeline].reverse().slice(0, RECAP_ENTRIES);
  }

  /**
   * The best single sentence about what happened while the owner was away.
   *
   * `awaySummary` is Claude Code's own recap and beats the timeline's newest `text`, which is one
   * transition rather than a summary of several.
   */
  public get awaySummary(): string | undefined {
    return (
      this.detail.extras.awaySummary ?? this.recap.find((entry) => entry.text !== undefined)?.text
    );
  }

  public get files(): readonly string[] {
    return this.detail.extras.files.slice(0, SHOWN_FILES);
  }

  /** How many more than `files` there are, or 0. The row says "and 14 more" rather than lying. */
  public get moreFiles(): number {
    return Math.max(0, this.detail.extras.files.length - SHOWN_FILES);
  }

  /** Context used, as a percentage — from the statusLine, which is the only thing that knows. */
  public get contextPercent(): number | undefined {
    return this.detail.vitals?.usedPercentage;
  }

  public get modelName(): string | undefined {
    return this.detail.vitals?.modelName;
  }

  /** What this session has cost, preferring Claude Code's own statusLine figure (D5). */
  public get costLabel(): string | undefined {
    const cost = this.detail.vitals?.costUsd ?? this.detail.extras.costUsd;
    return cost === undefined ? undefined : `$${cost.toFixed(2)}`;
  }

  /** `+128 −34`, or nothing. From the transcript's cost record, never recomputed. */
  public get linesLabel(): string | undefined {
    const { linesAdded, linesRemoved } = this.detail.extras;
    if (linesAdded === undefined && linesRemoved === undefined) return undefined;
    return `+${String(linesAdded ?? 0)} −${String(linesRemoved ?? 0)}`;
  }

  public get tokenTrail(): readonly TokenPoint[] {
    return this.detail.tokenTrail;
  }

  /**
   * The sparkline's points as an SVG polyline, in a 0–100 by 0–100 box, or `undefined`.
   *
   * Normalised to its own extremes rather than to an absolute scale, and the y-axis is deliberately
   * unlabelled: the trail starts wherever feed 4 began reading the transcript, so its FLOOR is an
   * artefact of when core started and only the SHAPE is meaningful (TranscriptDigest). The endpoint
   * labels carry the numbers.
   */
  public get sparkline(): string | undefined {
    const trail = this.detail.tokenTrail;
    if (trail.length < 2) return undefined;
    const times = trail.map((point) => point.at);
    const counts = trail.map((point) => point.tokens);
    const spanX = Math.max(1, Math.max(...times) - Math.min(...times));
    const spanY = Math.max(1, Math.max(...counts) - Math.min(...counts));
    const minX = Math.min(...times);
    const minY = Math.min(...counts);
    return trail
      .map((point) => {
        const x = ((point.at - minX) / spanX) * 100;
        // SVG y grows downward, so the larger count is the smaller y.
        const y = 100 - ((point.tokens - minY) / spanY) * 100;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }

  /** The endpoints the unlabelled axis needs, or `undefined` when there is no line. */
  public get trailRange(): { readonly from: string; readonly to: string } | undefined {
    const trail = this.detail.tokenTrail;
    const first = trail[0];
    const last = trail.at(-1);
    if (first === undefined || last === undefined || trail.length < 2) return undefined;
    return { from: this.tokensLabel(first.tokens), to: this.tokensLabel(last.tokens) };
  }

  /** True when there is genuinely nothing to show — the row says so rather than drawing empty boxes. */
  public get isBare(): boolean {
    return (
      this.detail.job === undefined &&
      this.detail.timeline.length === 0 &&
      this.detail.vitals === undefined &&
      this.detail.extras.files.length === 0 &&
      this.detail.extras.title === undefined
    );
  }

  /** `29.6M`, `604K`, `812` — a token count at a glance, never the full figure in a dense row. */
  public tokensLabel(tokens: number): string {
    if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
    if (tokens >= 1000) return `${Math.round(tokens / 1000).toString()}K`;
    return String(tokens);
  }

  /** The trailing segment. A full path is unreadable in a dense row and is rarely what is wanted. */
  public fileName(path: string): string {
    return (
      path
        .split(/[\\/]/)
        .filter((part) => part !== '')
        .at(-1) ?? path
    );
  }
}
