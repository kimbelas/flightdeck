// What one subscription's `daemon.log` says happened — P7-T4, RESEARCH.md F.2.3, F.2.15, F.2.16.
//
// **Two questions, and the log is the only witness to either.** The first is how each background
// session ENDED: `agents --json` reads `state: done` for all three endings (F.2.3), and the log
// writes them differently — `bg settled <id> (killed)` is `claude stop`, `(done)` alone is a session
// that finished, and `(done)` 1.1 s after a `bg retire <id>: <reason>` is the daemon's idle timer
// (F.2.15). The second is whether a supervisor the roster names is still the one running: the
// roster keeps naming a pid after it exits — for nine days on this machine — and a pid can be
// reissued, so "the process exists" is weaker evidence than "the log saw it shut down".
//
// A value object over the parsed events, and pure: nothing here reads a file or a process table.
import type { DaemonLogEvent } from '../../contracts/daemon-log.ts';
import type { DaemonEnding } from '../../contracts/daemon-report.ts';

/** Enough endings to cover a working day of background sessions; the list is newest first. */
export const MAX_ENDINGS = 20;

/** The supervisor start the log recorded, and whether it ended. */
export interface SupervisorRun {
  readonly pid: number;
  readonly version: string;
  readonly startedAt: number;
  /** When it shut down, or `undefined` while the log shows it running. */
  readonly exitedAt: number | undefined;
  readonly exitCause: string | undefined;
}

export class DaemonHistory {
  private readonly runs: readonly SupervisorRun[];
  private readonly endingList: readonly DaemonEnding[];

  private constructor(runs: readonly SupervisorRun[], endings: readonly DaemonEnding[]) {
    this.runs = runs;
    this.endingList = endings;
  }

  /** The most recent supervisor the log saw start, or `undefined` when the tail holds none. */
  public get lastRun(): SupervisorRun | undefined {
    return this.runs.at(-1);
  }

  /** How background sessions ended, newest first, spares excluded — see `endingsOf`. */
  public get endings(): readonly DaemonEnding[] {
    return this.endingList;
  }

  /** Folds a log's events, in file order, into the two answers above. @throws never. */
  public static of(events: readonly DaemonLogEvent[]): DaemonHistory {
    return new DaemonHistory(runsOf(events), endingsOf(events));
  }

  /** The latest run the log recorded for this pid, or `undefined` when the tail holds none. */
  public runOf(pid: number): SupervisorRun | undefined {
    return this.runs.findLast((run) => run.pid === pid);
  }

  /**
   * Whether the supervisor with this pid is known to have gone.
   *
   * `true` when its latest start was followed by a shutdown or by ANOTHER start — a supervisor
   * that was replaced is not the one listening, whatever the process table says about its pid.
   * `undefined` when the log never saw that pid start, which is ordinary: the reader keeps only the
   * tail of the file, and a roster can outlive the lines that explain it.
   */
  public hasExited(pid: number): boolean | undefined {
    const index = this.runs.findLastIndex((run) => run.pid === pid);
    const run = this.runs[index];
    if (run === undefined) return undefined;
    return run.exitedAt !== undefined || index < this.runs.length - 1;
  }
}

/**
 * Each supervisor start, closed by the shutdown that follows it.
 *
 * **A refused start is not a run.** Two supervisors can start in the same second — isg's log has
 * pids 23140 and 34948 266 ms apart after an upgrade — and the second logs `another daemon is
 * already running (pid=23140 …)` and leaves without a shutdown line. Left in, it would be the
 * "latest" run: the real supervisor would read as replaced, and its own shutdown two minutes later
 * would be pinned on the one that never ran (RESEARCH.md G.58).
 */
function runsOf(events: readonly DaemonLogEvent[]): readonly SupervisorRun[] {
  const runs: SupervisorRun[] = [];
  for (const event of events) {
    if (event.kind === 'start') runs.push(runStarted(event));
    else if (event.kind === 'refused') dropRefused(runs, event.runningPid);
    else if (event.kind === 'exited') closeLast(runs, event);
  }
  return runs;
}

function runStarted(event: Extract<DaemonLogEvent, { kind: 'start' }>): SupervisorRun {
  return {
    pid: event.pid,
    version: event.version,
    startedAt: event.at,
    exitedAt: undefined,
    exitCause: undefined,
  };
}

/** The newest start, if it is still open and is not the supervisor it deferred to, never ran. */
function dropRefused(runs: SupervisorRun[], runningPid: number): void {
  const last = runs.at(-1);
  if (last !== undefined && last.exitedAt === undefined && last.pid !== runningPid) runs.pop();
}

function closeLast(
  runs: SupervisorRun[],
  event: Extract<DaemonLogEvent, { kind: 'exited' }>,
): void {
  const open = runs.at(-1);
  if (open === undefined || open.exitedAt !== undefined) return;
  runs[runs.length - 1] = { ...open, exitedAt: event.at, exitCause: event.cause };
}

/**
 * Each `bg settled`, named for what caused it.
 *
 * A `(spare)` is a pre-warmed worker the daemon starts and kills on its own (B.3); it was never a
 * session and its `killed` is not the owner stopping anything, so it is left out rather than
 * reported as a stop nobody made.
 */
function endingsOf(events: readonly DaemonLogEvent[]): readonly DaemonEnding[] {
  const spares = new Set<string>();
  const retiring = new Map<string, Extract<DaemonLogEvent, { kind: 'retired' }>>();
  const endings: DaemonEnding[] = [];
  for (const event of events) {
    if (event.kind === 'spawned') {
      if (event.how === 'spare') spares.add(event.shortId);
      else spares.delete(event.shortId);
    } else if (event.kind === 'retired') {
      retiring.set(event.shortId, event);
    } else if (event.kind === 'settled' && !spares.has(event.shortId)) {
      endings.push(endingOf(event, retiring.get(event.shortId)));
      retiring.delete(event.shortId);
    }
  }
  return endings.reverse().slice(0, MAX_ENDINGS);
}

function endingOf(
  settled: Extract<DaemonLogEvent, { kind: 'settled' }>,
  retired: Extract<DaemonLogEvent, { kind: 'retired' }> | undefined,
): DaemonEnding {
  const base = { shortId: settled.shortId, at: settled.at };
  if (retired !== undefined) {
    return {
      ...base,
      reason: 'retired',
      retireReason: retired.reason,
      idleMinutes: retired.idleMinutes,
      lowMemory: retired.lowMemory,
    };
  }
  return { ...base, reason: settled.outcome === 'killed' ? 'stopped' : 'finished' };
}
