// Everything core knows about itself, in one value — P1-T12.
//
// The last five tasks each left a counter behind and a comment saying this is what would print it:
// `VitalsRegistry.all` (P1-T6), `TranscriptReader.all` with the ignored/unknown/oversize counts
// (P1-T7), `SqliteStore.version`, `StoringEventSink`'s stored/snapshots/dropped and `AuditLog`'s
// written/dropped (P1-T8). None of them is reachable from outside the process, so until this class
// the answer to "is the store actually being written to?" was to read the log and hope.
//
// **A class rather than six getters on the route.** The route's job is to answer a request; this
// one's is to know who to ask. It also makes the assembly testable without a socket, which is
// where the two interesting decisions below are pinned.
//
// **It reads, it never sweeps.** Every collaborator here answers from memory: no `claude.exe`
// call, no store query, no file opened. `flightdeck-core status` is the command an operator runs
// when something is already wrong, and a status screen that costs 1.5 s of `agents --json` per
// subscription is one they run less often than they should.
import type {
  AuditStatus,
  CoreStatus,
  RuntimeFacts,
  SessionVitalsLine,
  StoreStatus,
  TranscriptsStatus,
} from '../../contracts/core-status.ts';
import type { AuditLog } from './audit-log.ts';
import type { TranscriptReader } from './transcript-reader.ts';
import { vitalsLines } from './vitals-lines.ts';
import type { VitalsRegistry } from './vitals-registry.ts';

/** What a thing that writes events into the store can say about how that is going. */
export interface EventCounts {
  readonly stored: number;
  readonly snapshots: number;
  readonly dropped: number;
}

/** The store, as this screen needs it: a path and a schema version, not a query interface. */
export interface StoreFacts {
  readonly path: string;
  readonly version: number;
}

export interface StatusReportParts {
  readonly version: string;
  readonly store: StoreFacts;
  readonly events: EventCounts;
  readonly audit: AuditLog;
  readonly transcripts: TranscriptReader;
  readonly vitals: VitalsRegistry;
  readonly tokenPath: string;
  readonly ingestKeyPath: string;
  readonly claudePath: string | undefined;
}

export class StatusReport {
  private readonly parts: StatusReportParts;

  constructor(parts: StatusReportParts) {
    this.parts = parts;
  }

  /**
   * @param runtime pid, uptime and Node version, which come from `process` and therefore from the
   * HTTP edge — the application layer does not read the process it happens to be running in
   * (CODING-STANDARDS §2). Passing them in is also what makes this method's output assertable.
   */
  public snapshot(runtime: RuntimeFacts): CoreStatus {
    return {
      version: this.parts.version,
      runtime,
      tokenPath: this.parts.tokenPath,
      ingestKeyPath: this.parts.ingestKeyPath,
      claudePath: this.parts.claudePath,
      store: this.store(),
      audit: this.audit(),
      transcripts: this.transcripts(),
      vitals: this.vitals(),
    };
  }

  private store(): StoreStatus {
    const { store, events } = this.parts;
    return {
      path: store.path,
      schemaVersion: store.version,
      stored: events.stored,
      snapshots: events.snapshots,
      dropped: events.dropped,
    };
  }

  private audit(): AuditStatus {
    return { written: this.parts.audit.written, dropped: this.parts.audit.dropped };
  }

  /**
   * The three counters summed across every tracked transcript.
   *
   * Summed rather than listed per session, because the number an operator acts on is the total:
   * `unknown` above zero means this build is behind Claude Code and the fixtures need recapturing
   * (SPEC §8 R2), whichever session saw it first.
   */
  private transcripts(): TranscriptsStatus {
    const tracked = this.parts.transcripts.all();
    return {
      tracked: tracked.length,
      ignored: tracked.reduce((sum, entry) => sum + entry.ignored, 0),
      unknown: tracked.reduce((sum, entry) => sum + entry.unknown, 0),
      oversize: tracked.reduce((sum, entry) => sum + entry.oversize, 0),
    };
  }

  /**
   * Newest-updated last, as `VitalsRegistry` keeps them — the CLI decides how to sort.
   *
   * The mapping moved to `vitals-lines.ts` in P2-T3, when the `quota` frame became its second
   * reader. Two copies of it would be two opinions about what of a `StatuslineReport` may leave
   * core, and they would diverge on the first field either one added.
   */
  private vitals(): readonly SessionVitalsLine[] {
    return vitalsLines(this.parts.vitals);
  }
}
