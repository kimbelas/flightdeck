// The fold over a folder's transcripts — P3-T5, SPEC §5.1(b).
//
// `TranscriptDigest`'s cousin, and the difference is the unit: a digest is the newest state of ONE
// session and keeps the last of each field, while this is a COUNT over every session in a folder
// and keeps how often each thing happened. Both are pure, both take `TranscriptRecord`s, and
// neither knows what a file is — which is what lets 83.7 MB of transcript be tested with six
// records.
//
// **Mutable inside, immutable outside.** `TranscriptDigest` returns a new digest per record
// because a session's digest is small and is compared between sweeps. This one folds 30 058
// records in a pass and is asked once at the end, so copying eight maps per record would be a cost
// with no reader. The class owns its maps and `summarise()` is the only way out.
import {
  MAX_OBSERVED_ENTRIES,
  type ObservedBehaviour,
  type ObservedCount,
  type ObservedShare,
} from '../../contracts/observed-behaviour.ts';
import type { SubscriptionId } from '../../contracts/session.ts';
import type { TranscriptRecord } from '../../contracts/transcript-record.ts';
import { ScheduleTally } from './schedule-tally.ts';

/** Seven days, in ms — what "this week" means in `sessionsThisWeek`. */
export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** What one transcript file contributed, before it is folded into the whole. */
export interface ObservedSession {
  readonly subscription: SubscriptionId;
  /** The newest instant seen in the file, or `undefined` when no record carried one. */
  readonly newestAt: number | undefined;
  /** The most context any turn in it was carrying. `0` when nothing reported usage. */
  readonly peakContextTokens: number;
  /** The session's total, as Claude Code computed it — never recomputed here (D5). */
  readonly costUsd: number;
}

export class ObservedTally {
  private readonly tools = new Map<string, number>();
  private readonly skills = new Map<string, number>();
  private readonly sessionNames = new Map<string, number>();
  private readonly files = new Map<string, number>();
  private readonly sessions: ObservedSession[] = [];
  private compactions = 0;
  private scheduledFires = 0;
  private readonly schedules = new ScheduleTally();
  private unknownLines = 0;
  private bytesRead = 0;

  /**
   * One transcript's worth of records, folded in.
   *
   * The per-file facts — cost, peak context, newest instant — are computed here rather than by the
   * caller, because they are the same fold: a session's cost is the LAST `cost-state` it wrote and
   * its peak context is the MAXIMUM any turn reported, and neither is a sum over files.
   */
  public addSession(
    subscription: SubscriptionId,
    records: Iterable<TranscriptRecord>,
    bytes: number,
  ): void {
    this.bytesRead += bytes;
    let newestAt: number | undefined;
    let peakContextTokens = 0;
    let costUsd = 0;

    for (const record of records) {
      newestAt = newer(newestAt, at(record));
      peakContextTokens = Math.max(peakContextTokens, contextOf(record));
      costUsd = Math.max(costUsd, record.kind === 'cost' ? record.costUsd : 0);
      this.count(record);
    }
    this.schedules.endSession();
    this.sessions.push({ subscription, newestAt, peakContextTokens, costUsd });
  }

  /** A line whose type this build has never seen. The drift alarm (SPEC §8 R2). */
  public addUnknownLine(): void {
    this.unknownLines += 1;
  }

  /** What it all adds up to. Safe to call more than once; it computes nothing in place. */
  public summarise(path: string, now: number, tookMs: number): ObservedBehaviour {
    return {
      path,
      at: now,
      tookMs,
      sessions: this.sessions.length,
      sessionsThisWeek: this.sessions.filter(
        (session) => session.newestAt !== undefined && now - session.newestAt <= WEEK_MS,
      ).length,
      bytesRead: this.bytesRead,
      shares: this.shares(),
      tools: top(this.tools),
      skills: top(this.skills),
      sessionNames: top(this.sessionNames),
      files: top(this.files),
      medianPeakContextTokens: median(
        this.sessions.map((session) => session.peakContextTokens).filter((peak) => peak > 0),
      ),
      compactions: this.compactions,
      scheduledFires: this.scheduledFires,
      schedules: this.schedules.summarise(),
      unknownLines: this.unknownLines,
    };
  }

  /**
   * One record, into whichever tally it belongs to.
   *
   * Every kind is named rather than defaulted, so a record kind added later is a type error here
   * and not a silent no-op — the rule `transcript-digest.ts` set and the whole value of the union.
   */
  private count(record: TranscriptRecord): void {
    if (record.kind === 'compaction') this.compactions += 1;
    else if (record.kind === 'scheduled') {
      this.scheduledFires += 1;
      this.schedules.add(record);
    } else this.name(record);
  }

  /**
   * The four tallies that count a NAME rather than an occurrence.
   *
   * Every remaining kind is listed rather than defaulted, so a record kind added later is a type
   * error here and not a silent no-op — the rule `transcript-digest.ts` set and the whole value of
   * the union (R12).
   */
  private name(record: Exclude<TranscriptRecord, { kind: 'compaction' | 'scheduled' }>): void {
    switch (record.kind) {
      case 'tool':
        this.tool(record);
        return;
      // The session's own name, not a subagent — see `ObservedBehaviour.sessionNames`.
      case 'agent':
        bump(this.sessionNames, record.name);
        return;
      case 'file':
        bump(this.files, record.path);
        return;
      // Read for their per-session facts in `addSession`, or of no interest to a folder's history:
      // a title, a prompt, an away summary and a turn duration are all about one conversation.
      case 'cost':
      case 'context':
      case 'title':
      case 'prompt':
      case 'away':
      case 'turn':
        return;
    }
  }

  /** A tool call, and the skill it was if it was one — see `TranscriptRecord`'s `skill`. */
  private tool(record: Extract<TranscriptRecord, { kind: 'tool' }>): void {
    bump(this.tools, record.tool);
    if (record.skill !== undefined) bump(this.skills, record.skill);
  }

  /** Which subscription this folder runs under, and what it has cost on each. */
  private shares(): readonly ObservedShare[] {
    const byId = new Map<SubscriptionId, { sessions: number; costUsd: number }>();
    for (const session of this.sessions) {
      const held = byId.get(session.subscription) ?? { sessions: 0, costUsd: 0 };
      byId.set(session.subscription, {
        sessions: held.sessions + 1,
        costUsd: held.costUsd + session.costUsd,
      });
    }
    return [...byId]
      .map(([subscription, held]) => ({ subscription, ...held }))
      .sort((left, right) => right.sessions - left.sessions);
  }
}

/** The commonest first, then alphabetically so a tie does not reorder between two reads. */
function top(counts: ReadonlyMap<string, number>): readonly ObservedCount[] {
  return [...counts]
    .map(([name, count]) => ({ name, count }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name))
    .slice(0, MAX_OBSERVED_ENTRIES);
}

function bump(counts: Map<string, number>, name: string): void {
  if (name === '') return;
  counts.set(name, (counts.get(name) ?? 0) + 1);
}

/**
 * The middle value, or the mean of the middle two. `0` for nothing.
 *
 * A median rather than a mean because one 900k-token session in a folder of 40k ones would move a
 * mean and says nothing about what the work there usually costs.
 */
function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? 0;
  return Math.round(((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2);
}

function contextOf(record: TranscriptRecord): number {
  if (record.kind === 'context') return record.contextTokens;
  if (record.kind === 'tool') return record.contextTokens ?? 0;
  return 0;
}

/**
 * Every record's instant, where it has one.
 *
 * `'at' in record` rather than a switch naming all ten kinds, and it is the safer of the two here
 * as well as the shorter: TypeScript narrows on the property, so a kind added later with a
 * timestamp is read without a change and a kind added without one cannot be read by mistake. The
 * three that carry none — a title, an agent name, a prompt — are rewritten on every turn rather
 * than appended, which is why they never had one (`transcript-trail.ts`, G.37).
 */
function at(record: TranscriptRecord): number | undefined {
  return 'at' in record ? record.at : undefined;
}

function newer(held: number | undefined, candidate: number | undefined): number | undefined {
  if (candidate === undefined) return held;
  return held === undefined ? candidate : Math.max(held, candidate);
}
