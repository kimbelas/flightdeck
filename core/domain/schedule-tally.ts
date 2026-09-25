// Scheduled-task visibility — P7-T4, SPEC §6(11), §5.1(b), RESEARCH.md C.
//
// "`/loop` and cron tasks firing inside sessions", counted per KIND rather than per task, and that
// is a measurement rather than a simplification. Read off this machine's own transcripts, a `/loop`
// wake-up is a ONE-SHOT: seven consecutive fires of one session carried seven different `taskId`s,
// each with a cron naming the next minute it chose (`56 9 * * *`, `27 10 * * *`, …). A tally keyed
// on the task id would be seven rows of `1`, and the fact the owner wants — "this folder has a loop
// that woke up seven times, last at 13:27" — would be nowhere on it.
//
// `ObservedTally` owns one of these and feeds it; it is its own class because that one is at its
// size limit and this is a fold with a unit of its own (a kind, across sessions).
import { MAX_OBSERVED_ENTRIES, type ObservedSchedule } from '../../contracts/observed-behaviour.ts';
import type { TranscriptRecord } from '../../contracts/transcript-record.ts';

/** What an older fire with no `taskKind` or `cronKind` is counted under. */
export const UNNAMED_SCHEDULE_KIND = 'scheduled';

interface Held {
  fires: number;
  sessions: number;
  lastAt: number | undefined;
  lastCron: string | undefined;
}

export class ScheduleTally {
  private readonly byKind = new Map<string, Held>();
  private readonly inSession = new Set<string>();

  /** One fire, in the session currently being folded. */
  public add(record: Extract<TranscriptRecord, { kind: 'scheduled' }>): void {
    const kind = record.taskKind ?? UNNAMED_SCHEDULE_KIND;
    const held = this.byKind.get(kind) ?? {
      fires: 0,
      sessions: 0,
      lastAt: undefined,
      lastCron: undefined,
    };
    held.fires += 1;
    if (record.at !== undefined && (held.lastAt === undefined || record.at >= held.lastAt)) {
      held.lastAt = record.at;
      held.lastCron = record.cron ?? held.lastCron;
    }
    this.byKind.set(kind, held);
    this.inSession.add(kind);
  }

  /** The session being folded is done: each kind it fired counts it once. */
  public endSession(): void {
    for (const kind of this.inSession) {
      const held = this.byKind.get(kind);
      if (held !== undefined) held.sessions += 1;
    }
    this.inSession.clear();
  }

  /** The most-fired kind first. Safe to call more than once. */
  public summarise(): readonly ObservedSchedule[] {
    return [...this.byKind]
      .map(([kind, held]) => ({ kind, ...held }))
      .sort((left, right) => right.fires - left.fires || left.kind.localeCompare(right.kind))
      .slice(0, MAX_OBSERVED_ENTRIES);
  }
}
