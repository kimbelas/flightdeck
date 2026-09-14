// Feed 4, running — P1-T7, SPEC §4.2, DECISIONS.md D3.
//
// **It learns which transcripts exist by listening, not by walking the disk.** There are 315
// transcripts across the two config dirs on this machine and 647 MB + 509 MB of them; the ones
// worth tailing are the ones a session is writing right now, and both documented ingest feeds say
// which those are — a hook payload carries `transcript_path` and a statusLine render carries
// `transcript_path` too. So this is an `EventSink` that plugs into the existing fan-out and needs
// no change anywhere else, and a transcript nobody has posted about is never opened.
//
// **It publishes nothing.** Feed 4 is enrichment (D3): it owns no liveness, raises no alert and
// nudges no sweep, so it keeps a registry the deck reads — the same shape as `VitalsRegistry` — and
// stays out of the event spine. That also keeps it out of a construction cycle: a sink that
// published into the sink it is part of would have to be wired after the thing that contains it.
//
// **Every path here is a string nobody resolves.** Attribution to a subscription already happened
// at the ingest boundary (`SubscriptionPaths`, SEC-FS-1); this opens what those feeds reported.
import type { DraftEvent } from '../../contracts/fd-event.ts';
import type { SubscriptionId } from '../../contracts/session.ts';
import { TranscriptDigest } from '../domain/transcript-digest.ts';
import type { Cancellation } from '../ports/cancellation.ts';
import type { EventSink } from '../ports/event-sink.ts';
import type { Logger } from '../ports/logger.ts';
import type { Scheduler } from '../ports/scheduler.ts';
import type { TranscriptFile } from '../ports/transcript-file.ts';
import { TranscriptTail } from './transcript-tail.ts';

/** SPEC §4.2 puts feed 4 at about a second. Slower than the hooks it enriches, by design. */
export const POLL_MS = 1000;

/** The same cap and the same reason as `VitalsRegistry`: a map that only grows is a slow leak. */
const MAX_TRANSCRIPTS = 200;

export interface TrackedTranscript {
  readonly sessionId: string;
  readonly subscription: SubscriptionId;
  readonly digest: TranscriptDigest;
  /** Lines of a known type this build does not read. Most of a transcript. Not a problem. */
  readonly ignored: number;
  /** Lines of a type never observed — the number that climbs after a `claude update` (SPEC §8 R2). */
  readonly unknown: number;
  readonly oversize: number;
}

interface Tracked {
  readonly path: string;
  readonly subscription: SubscriptionId;
  readonly tail: TranscriptTail;
  digest: TranscriptDigest;
}

export interface TranscriptReaderParts {
  readonly file: TranscriptFile;
  readonly scheduler: Scheduler;
  readonly logger: Logger;
}

export class TranscriptReader implements EventSink {
  private readonly file: TranscriptFile;
  private readonly scheduler: Scheduler;
  private readonly logger: Logger;
  private readonly tracked = new Map<string, Tracked>();
  private timer: Cancellation | undefined;
  /** Polls do not overlap. `Scheduler.every` does not chain, so the guard is this class's (port doc). */
  private polling = false;

  constructor(parts: TranscriptReaderParts) {
    this.file = parts.file;
    this.scheduler = parts.scheduler;
    this.logger = parts.logger;
  }

  public get size(): number {
    return this.tracked.size;
  }

  /**
   * Learns a transcript path from an event going past. @throws never.
   *
   * The payload is `unknown` by contract and stays that way: it is read through a narrow guard
   * here rather than trusted, for the same reason `SessionStreamRoute` re-parses a row on the way
   * out (P1-T9).
   */
  public publish(event: DraftEvent): void {
    if (event.source !== 'hook' && event.source !== 'statusline') return;
    const path = transcriptPathOf(event.payload);
    if (path === undefined) return;
    this.track(event.sessionId, event.subscription, path);
  }

  /** Starts the poll. Called once core is listening, for the reason `Reconciler.start` is. */
  public start(): void {
    this.timer ??= this.scheduler.every(POLL_MS, () => {
      void this.poll();
    });
  }

  public stop(): void {
    this.timer?.cancel();
    this.timer = undefined;
  }

  /** Reads every tracked transcript once. Public so a test does not have to own the timing. */
  public async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      for (const [sessionId, entry] of [...this.tracked]) {
        await this.advance(sessionId, entry);
      }
    } finally {
      this.polling = false;
    }
  }

  /** What feed 4 knows about one session, or `undefined` if it has never been read. */
  public get(sessionId: string): TrackedTranscript | undefined {
    const entry = this.tracked.get(sessionId);
    if (entry === undefined) return undefined;
    return view(sessionId, entry);
  }

  /** Everything tracked, least-recently-read first. `flightdeck-core status` prints it (P1-T12). */
  public all(): readonly TrackedTranscript[] {
    return [...this.tracked].map(([sessionId, entry]) => view(sessionId, entry));
  }

  private track(sessionId: string, subscription: SubscriptionId, path: string): void {
    const existing = this.tracked.get(sessionId);
    // A path that moved is a different transcript for the same session, so it gets a new tail
    // rather than the old one's byte offset — which would point into a file that is not this one.
    if (existing?.path === path) return;
    this.tracked.delete(sessionId);
    // A fresh digest, not the old one: reaching here means the path changed, and what was folded
    // came out of a file this session is no longer writing.
    this.tracked.set(sessionId, {
      path,
      subscription,
      tail: new TranscriptTail(),
      digest: TranscriptDigest.EMPTY,
    });
    this.evictOldest();
  }

  private async advance(sessionId: string, entry: Tracked): Promise<void> {
    const seenUnknown = entry.tail.unknown;
    const slice = await this.file.read(entry.path, entry.tail.at);
    const batch = entry.tail.absorb(slice);
    // A restart is the one thing that invalidates what was already folded: the bytes it came from
    // are gone, so keeping the digest would show a resumed session its predecessor's recap.
    if (batch.restarted) entry.digest = TranscriptDigest.EMPTY;
    if (batch.records.length > 0) entry.digest = entry.digest.withAll(batch.records);
    // Logged only for drift, never per read: this polls every session every second, and an
    // `info` per read would be twenty lines a second saying nothing. A record type nobody has
    // seen is the one thing here worth an operator's attention (SPEC §8 R2).
    if (batch.unknown > seenUnknown) {
      // The session id, not the path: the id is enough to find the transcript and the path carries
      // the account name and the project folder, which is identity the log does not need.
      this.logger.warn('transcript_unknown_record', { sessionId, unknown: batch.unknown });
    }
  }

  private evictOldest(): void {
    while (this.tracked.size > MAX_TRANSCRIPTS) {
      const oldest = this.tracked.keys().next();
      if (oldest.done === true) return;
      this.tracked.delete(oldest.value);
    }
  }
}

function view(sessionId: string, entry: Tracked): TrackedTranscript {
  return {
    sessionId,
    subscription: entry.subscription,
    digest: entry.digest,
    ignored: entry.tail.ignored,
    unknown: entry.tail.unknown,
    oversize: entry.tail.oversize,
  };
}

/**
 * `transcript_path` out of an untrusted payload.
 *
 * One key, because both feeds that carry it use Claude Code's own spelling — the hook payload as
 * received (`hook-event.ts` keeps it verbatim) and `StatuslineReport`, which is this project's
 * projection and uses `transcriptPath`. Both are checked rather than one being assumed.
 */
function transcriptPathOf(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const fields: Readonly<Record<string, unknown>> = Object.fromEntries(Object.entries(payload));
  const snake = fields['transcript_path'];
  if (typeof snake === 'string' && snake !== '') return snake;
  const camel = fields['transcriptPath'];
  return typeof camel === 'string' && camel !== '' ? camel : undefined;
}
