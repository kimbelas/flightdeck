// One expanded row, assembled from the three things that already knew — P2-T4.
//
// `StatusReport`'s sibling: it owns nothing and it is the only place that knows who to ask.
// `VitalsRegistry` has the statusLine reading (P1-T6), `TranscriptReader` has the digest (P1-T7),
// and `jobs/<shortId>/` has the attention text and the state history (F.2.4, F.2.14). Three
// producers built over three tasks, none of them with a reader until this one.
//
// **It reads two files, and that is the difference from `StatusReport`**, which promises never to
// touch a disk. This one is allowed to, because of who is asking: a status screen is polled by an
// operator script, while a detail is fetched when a person clicks a row. Two small reads per click
// is the right trade for not holding every session's history in memory. Nothing here sweeps, and no
// `claude.exe` is ever called.
//
// **Every path is screened before it is opened** (SEC-FS-1, SEC-FS-2). The paths are BUILT here
// rather than accepted from the request — a caller hands over a session id and this composes
// `<configDir>/jobs/<shortId>/state.json` — so the screening is belt and braces. It is done anyway:
// `shortId` arrives from the deck, `ReadPolicy` is the one place that decides what may be opened,
// and a composed path that skipped it would be the one path in core that nobody checked.
import {
  MAX_TIMELINE_ENTRIES,
  type JobState,
  type TimelineEntry,
} from '../../contracts/job-state.ts';
import { parseJobState, parseTimeline } from '../../contracts/job-state.ts';
import {
  NO_EXTRAS,
  type SessionDetail,
  type SessionVitalsDetail,
  type TranscriptExtras,
} from '../../contracts/session-detail.ts';
import type { SessionRef } from '../../contracts/session-ref.ts';
import type { SubscriptionId } from '../../contracts/session.ts';
import type { TranscriptDigest } from '../domain/transcript-digest.ts';
import type { ReadPolicy } from '../domain/read-policy.ts';
import type { Clock } from '../ports/clock.ts';
import type { JobFiles } from '../ports/job-files.ts';
import type { Logger } from '../ports/logger.ts';
import type { VitalsRegistry } from './vitals-registry.ts';

/**
 * The most of each file that is read.
 *
 * `state.json` is ~1 KB on this machine and the cap is a guard, not a budget. `timeline.jsonl`
 * gains a line per transition forever, and only the last `MAX_TIMELINE_ENTRIES` are kept, so this
 * needs to cover that many lines of assistant message and no more — 64 KB is roughly 50 entries at
 * the 2000-character cap `parseTimeline` applies, with room to spare for the ones that are shorter.
 */
const MAX_STATE_BYTES = 262_144;
const MAX_TIMELINE_BYTES = 262_144;

/** What this needs from feed 4, as an interface, so a test does not have to own a file reader. */
export interface DigestSource {
  get(sessionId: string): { readonly digest: TranscriptDigest } | undefined;
}

export interface SessionDetailParts {
  readonly vitals: VitalsRegistry;
  readonly transcripts: DigestSource;
  readonly files: JobFiles;
  readonly policy: ReadPolicy;
  /** Where each subscription's config directory is — `ClaudeInstall.configDirFor`, as data. */
  readonly configDirs: Readonly<Record<SubscriptionId, string>>;
  readonly clock: Clock;
  readonly logger: Logger;
}

export class SessionDetailReader {
  private readonly parts: SessionDetailParts;

  constructor(parts: SessionDetailParts) {
    this.parts = parts;
  }

  /**
   * Everything known about one session.
   *
   * Never `undefined`: a session with no job directory, no vitals and no digest still gets a detail,
   * with every field empty. The deck draws "nothing to show yet" from an empty detail and an error
   * from a missing one, and those are different things — an interactive session that has never
   * rendered a status line is the first and not the second.
   */
  public async read(ref: SessionRef): Promise<SessionDetail> {
    const [job, timeline] = await Promise.all([this.job(ref), this.timeline(ref)]);
    return {
      sessionId: ref.sessionId,
      at: this.parts.clock.now().getTime(),
      job,
      timeline,
      vitals: this.vitals(ref.sessionId),
      extras: this.extras(ref.sessionId),
      tokenTrail: this.parts.transcripts.get(ref.sessionId)?.digest.tokenTrail ?? [],
    };
  }

  private async job(ref: SessionRef): Promise<JobState | undefined> {
    const text = await this.readFile(ref, 'state.json', MAX_STATE_BYTES);
    if (text === undefined) return undefined;
    try {
      return parseJobState(JSON.parse(text));
    } catch {
      // A state file caught mid-write. Ordinary on a session that is transitioning, and the next
      // expansion will read a whole one.
      return undefined;
    }
  }

  private async timeline(ref: SessionRef): Promise<readonly TimelineEntry[]> {
    const text = await this.readFile(ref, 'timeline.jsonl', MAX_TIMELINE_BYTES);
    return text === undefined ? [] : parseTimeline(text).slice(-MAX_TIMELINE_ENTRIES);
  }

  /**
   * One file under this session's job directory, screened then read.
   *
   * A refusal is logged and returns nothing. It should be impossible — the path is composed from a
   * config dir and a short id — so if it ever fires, the interesting thing is that it fired.
   */
  private async readFile(
    ref: SessionRef,
    name: string,
    maxBytes: number,
  ): Promise<string | undefined> {
    const path = `${this.parts.configDirs[ref.subscription]}\\jobs\\${ref.shortId}\\${name}`;
    const refusal = this.parts.policy.refusal(path);
    if (refusal !== undefined) {
      this.parts.logger.warn('job_file_refused', { sessionId: ref.sessionId, name, refusal });
      return undefined;
    }
    return this.parts.files.read(path, maxBytes);
  }

  /**
   * The newest statusLine reading for this session.
   *
   * `transcriptPath` is in the registry's `StatuslineReport` and is not in what comes back, for the
   * reason `vitals-lines.ts` gives: it names the account and the project folder (SEC-DATA-2).
   */
  private vitals(sessionId: string): SessionVitalsDetail | undefined {
    const entry = this.parts.vitals.get(sessionId);
    if (entry === undefined) return undefined;
    return {
      at: entry.at,
      modelName: entry.report.modelName,
      usedPercentage: entry.report.usedPercentage,
      costUsd: entry.report.costUsd,
      contextWindowSize: entry.report.contextWindowSize,
    };
  }

  /** Feed 4's digest, flattened to the wire shape. `NO_EXTRAS` when nothing has been read. */
  private extras(sessionId: string): TranscriptExtras {
    const digest = this.parts.transcripts.get(sessionId)?.digest;
    if (digest === undefined || digest.isEmpty) return NO_EXTRAS;
    const spend = digest.spend;
    return {
      title: digest.title,
      titleIsCustom: digest.titleIsCustom,
      agent: digest.agent,
      lastPrompt: digest.lastPrompt,
      awaySummary: digest.awaySummary,
      awaySummaryAt: digest.awaySummaryAt,
      lastTool: digest.lastTool,
      lastToolAt: digest.lastToolAt,
      files: digest.files,
      costUsd: spend?.costUsd,
      linesAdded: spend?.linesAdded,
      linesRemoved: spend?.linesRemoved,
    };
  }
}
