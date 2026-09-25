// The OTLP receiver's memory — P7-T5. Per-session sums of what Claude Code exported.
//
// **Sums of deltas, in memory.** Claude Code's metrics are delta counters by default, so each
// point is added and nothing is ever replaced (contracts/otlp-metrics.ts says why cumulative is
// skipped). Held here rather than in the store for `VitalsRegistry`'s reason: it is an
// observation, not the record — cost-state is the record (DECISIONS.md D5) — and a table of it
// would be a second ledger of the owner's spend that disagrees with the first by one restart.
//
// **Bounded** the way the vitals are, least-recently-heard evicted first, so a core that never
// restarts through a long week of sessions holds a few hundred small entries and not all of them.
import type { TelemetryEvent } from '../../contracts/otlp-logs.ts';
import type { TelemetryPoint } from '../../contracts/otlp-metrics.ts';
import {
  ACTIVE_KINDS,
  LINE_KINDS,
  TOKEN_KINDS,
  type SessionTelemetry,
  type TelemetryReport,
} from '../../contracts/session-telemetry.ts';
import type { Clock } from '../ports/clock.ts';

/** How many sessions to keep sums for. `VitalsRegistry`'s cap, for its reason. */
const MAX_SESSIONS = 200;

type Mutable<T> = { -readonly [K in keyof T]: T[K] extends object ? Mutable<T[K]> : T[K] };

export interface TelemetryTallyParts {
  /** Whether core was started with the receiver on (contracts/otlp-receiver.ts). */
  readonly enabled: boolean;
  readonly clock: Clock;
}

export class TelemetryTally {
  public readonly enabled: boolean;

  private readonly clock: Clock;
  private readonly since: number;
  private readonly sessions = new Map<string, Mutable<SessionTelemetry>>();
  private skipped = 0;

  constructor(parts: TelemetryTallyParts) {
    this.enabled = parts.enabled;
    this.clock = parts.clock;
    this.since = parts.clock.now().getTime();
  }

  /** Adds one export's metric deltas. `skipped` is the batch's count of points it could not use. */
  public addPoints(points: readonly TelemetryPoint[], skipped: number): void {
    this.skipped += skipped;
    for (const point of points) addPoint(this.touch(point.sessionId), point);
  }

  /** Counts one export's events. */
  public addEvents(events: readonly TelemetryEvent[], skipped: number): void {
    this.skipped += skipped;
    for (const event of events) {
      const entry = this.touch(event.sessionId);
      entry.events[event.name] = (entry.events[event.name] ?? 0) + 1;
    }
  }

  /** Everything summed since core started, most recently heard first. Copies, never the maps. */
  public report(): TelemetryReport {
    const sessions = [...this.sessions.values()].reverse().map(snapshot);
    return { enabled: this.enabled, since: this.since, sessions, skipped: this.skipped };
  }

  /** The entry for a session, moved to the most-recent end, created if it is new. */
  private touch(sessionId: string): Mutable<SessionTelemetry> {
    const entry = this.sessions.get(sessionId) ?? blank(sessionId);
    entry.lastAt = this.clock.now().getTime();
    // Delete before set, so insertion order stays least-recently-heard first (VitalsRegistry).
    this.sessions.delete(sessionId);
    this.sessions.set(sessionId, entry);
    if (this.sessions.size > MAX_SESSIONS) {
      const oldest = this.sessions.keys().next();
      if (!oldest.done) this.sessions.delete(oldest.value);
    }
    return entry;
  }
}

/** A point whose `type` is not one of the documented values is dropped, not filed under a guess. */
function addPoint(entry: Mutable<SessionTelemetry>, point: TelemetryPoint): void {
  const { kind, value } = point;
  switch (point.metric) {
    case 'cost':
      entry.costUsd += value;
      return;
    case 'tokens':
      addKind(entry.tokens, TOKEN_KINDS, kind, value);
      return;
    case 'activeTime':
      addKind(entry.activeSeconds, ACTIVE_KINDS, kind, value);
      return;
    case 'lines':
      addKind(entry.lines, LINE_KINDS, kind, value);
      return;
    case 'commits':
      entry.commits += value;
      return;
    case 'pullRequests':
      entry.pullRequests += value;
      return;
  }
}

function addKind<K extends string>(
  bucket: Record<K, number>,
  kinds: readonly K[],
  kind: string | undefined,
  value: number,
): void {
  const known = kinds.find((allowed) => allowed === kind);
  if (known !== undefined) bucket[known] += value;
}

function blank(sessionId: string): Mutable<SessionTelemetry> {
  return {
    sessionId,
    costUsd: 0,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
    activeSeconds: { user: 0, cli: 0 },
    lines: { added: 0, removed: 0 },
    commits: 0,
    pullRequests: 0,
    events: {},
    lastAt: 0,
  };
}

function snapshot(entry: Mutable<SessionTelemetry>): SessionTelemetry {
  return {
    ...entry,
    tokens: { ...entry.tokens },
    activeSeconds: { ...entry.activeSeconds },
    lines: { ...entry.lines },
    events: { ...entry.events },
  };
}
