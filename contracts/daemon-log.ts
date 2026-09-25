// `daemon.log`, read — P7-T4, RESEARCH.md B.3, F.2.3, F.2.15, F.2.16.
//
// **The log is the only place three facts live.** `claude agents --json` reads `state: done` for a
// session that was stopped, one that finished and one the daemon retired (F.2.3), so WHY a
// background session ended is written down here and nowhere else. So is the reason for a
// retirement — `settled`, `idle-prompt`, `empty-idle` — which is the session's state when the timer
// took it and not three thresholds (F.2.15). And so is the supervisor's own life: when it started,
// under which pid, and when it shut down, which is what turns "the roster names pid 23140" into
// "and that daemon exited nine days ago" (F.2.16).
//
// **Only the lines something reads are modelled.** The log also carries auth refreshes, adoption
// counts and prewarm bursts; those parse to `undefined`, which is an ordinary answer and not drift.
// The scrubber is the one that must know every line (scripts/capture-log.mjs, D60) — a reader only
// has to know the lines it uses, and a new line from a Claude Code release costs it nothing.
//
// Plain functions over strings, because the same parse serves core's reader and the fixture tests
// and neither should need the other's filesystem.

/**
 * A retirement's reason word. The three observed live in contracts/session.ts beside `EndReason`;
 * any other is carried as the word it was.
 */
export { RETIRE_REASONS } from './session.ts';

export type DaemonLogEvent =
  /** `─── daemon start ─── version=… pid=… origin=…` — a supervisor came up. */
  | {
      readonly kind: 'start';
      readonly at: number;
      readonly version: string;
      readonly pid: number;
      readonly origin: string;
    }
  /** `bg spawned <id> (shell|slash|fleet|spare)` — a worker, or a pre-warmed spare. */
  | {
      readonly kind: 'spawned';
      readonly at: number;
      readonly shortId: string;
      readonly how: string;
    }
  /**
   * `bg retire <id>: <reason>, idle <n>m [low memory]` — the daemon's idle timer took a session.
   *
   * `idleMinutes` is the number the line prints, and F.2.15 measured it as the session's AGE, not
   * its idle time: an upper bound on idleness, never a measurement of it.
   */
  | {
      readonly kind: 'retired';
      readonly at: number;
      readonly shortId: string;
      readonly reason: string;
      readonly idleMinutes: number;
      readonly lowMemory: boolean;
    }
  /** `bg settled <id> (done|killed)` — a worker ended; `killed` is `claude stop` (F.2.3). */
  | {
      readonly kind: 'settled';
      readonly at: number;
      readonly shortId: string;
      readonly outcome: string;
    }
  /** `shutting down (cause=…, uptime=…s, leases=…, live_workers=…)` — the supervisor went. */
  | {
      readonly kind: 'exited';
      readonly at: number;
      readonly cause: string;
      readonly uptimeSeconds: number;
      readonly liveWorkers: number;
    }
  /**
   * `another daemon is already running (pid=…` — a new supervisor refused to start, deferring to
   * a pid the roster still named. F.2.16 found this line written while that pid was already dead.
   */
  | { readonly kind: 'refused'; readonly at: number; readonly runningPid: number };

const LINE =
  /^\[(?<instant>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)\] \[[a-z]+\] (?<message>.*)$/u;
const START =
  /^─── daemon start ─── version=(?<version>\S+) pid=(?<pid>\d+) origin=(?<origin>\S+)$/u;
const SPAWNED = /^bg spawned (?<id>[0-9a-f]{8}) \((?<how>[a-z_-]+)\)$/u;
const RETIRED =
  /^bg retire (?<id>[0-9a-f]{8}): (?<reason>[a-z_-]+), idle (?<idle>\d+)m(?<low> \[low memory\])?$/u;
const SETTLED = /^bg settled (?<id>[0-9a-f]{8}) \((?<outcome>[a-z_-]+)\)$/u;
const EXITED =
  /^shutting down \(cause=(?<cause>[a-z_-]+), uptime=(?<uptime>\d+)s, leases=\d+, live_workers=(?<live>\d+)\)$/u;
const REFUSED = /^another daemon is already running \(pid=(?<pid>\d+),/u;

/** A version, an origin word: bounded, so a line that grew a paragraph does not carry it. */
const MAX_WORD_CHARS = 40;

/**
 * One line, or `undefined` for a line nothing reads — including a torn last line and a blank one.
 *
 * @throws never. The file is written by another process while this reads it.
 */
export function parseDaemonLogLine(line: string): DaemonLogEvent | undefined {
  const parts = LINE.exec(line.trimEnd())?.groups;
  if (parts === undefined) return undefined;
  const at = Date.parse(parts['instant'] ?? '');
  const message = parts['message'] ?? '';
  if (!Number.isFinite(at)) return undefined;
  return supervisorEvent(message, at) ?? workerEvent(message, at);
}

/** Every line that parses, in file order. */
export function parseDaemonLog(text: string): readonly DaemonLogEvent[] {
  return text.split('\n').flatMap((line) => {
    const event = parseDaemonLogLine(line);
    return event === undefined ? [] : [event];
  });
}

function supervisorEvent(message: string, at: number): DaemonLogEvent | undefined {
  const start = START.exec(message)?.groups;
  if (start !== undefined) {
    return {
      kind: 'start',
      at,
      version: word(start['version']),
      pid: whole(start['pid']),
      origin: word(start['origin']),
    };
  }
  const exited = EXITED.exec(message)?.groups;
  if (exited !== undefined) {
    return {
      kind: 'exited',
      at,
      cause: word(exited['cause']),
      uptimeSeconds: whole(exited['uptime']),
      liveWorkers: whole(exited['live']),
    };
  }
  const refused = REFUSED.exec(message)?.groups;
  return refused === undefined
    ? undefined
    : { kind: 'refused', at, runningPid: whole(refused['pid']) };
}

function workerEvent(message: string, at: number): DaemonLogEvent | undefined {
  const spawned = SPAWNED.exec(message)?.groups;
  if (spawned !== undefined) {
    return { kind: 'spawned', at, shortId: word(spawned['id']), how: word(spawned['how']) };
  }
  const retired = RETIRED.exec(message)?.groups;
  if (retired !== undefined) {
    return {
      kind: 'retired',
      at,
      shortId: word(retired['id']),
      reason: word(retired['reason']),
      idleMinutes: whole(retired['idle']),
      lowMemory: retired['low'] !== undefined,
    };
  }
  const settled = SETTLED.exec(message)?.groups;
  if (settled === undefined) return undefined;
  return { kind: 'settled', at, shortId: word(settled['id']), outcome: word(settled['outcome']) };
}

function word(value: string | undefined): string {
  return (value ?? '').slice(0, MAX_WORD_CHARS);
}

function whole(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : 0;
}
