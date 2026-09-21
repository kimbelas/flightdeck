// Every transcript of one folder, in both subscriptions, folded into one reading — P3-T5.
//
// **It is the widest read in the product and it is a button.** Measured on this repository's own
// slug: 42 files, 83.7 MB, 30 058 lines in 1 149 ms. The worst case is four times what an early
// estimate said, and only running it showed that: `xpert-new` is 85 transcripts and 423 MB across
// the two config dirs, read in 9 933 ms (G.47). The estimate had taken the biggest slug in ONE
// dir. Ten seconds is well past the 2.7 s `claude logs` spawn P5a-T4 turned into a button rather
// than a poll (F.2.5, "never poll it"), so the rule holds a fortiori: nothing asks for this on a
// timer, on a sweep, or for every project at once.
//
// **Nothing new was needed to read a transcript.** `TranscriptFile.read` caps a slice at 1 MB and
// advances a cursor, and `TranscriptTail` already assembles the lines across slice boundaries and
// counts what it could not name — the two pieces P1-T7 built for a live tail are exactly a whole-
// file scan repeated. The largest single transcript on this machine is 21.7 MB, so a file is read
// in about 22 bounded slices rather than in one 22 MB allocation.
//
// **The slug is derived, never taken.** Claude Code names a transcript directory after the cwd with
// its separators replaced, and `projectSlug` is the one place that spelling lives. The path that
// reaches here is an imported project's, already screened by `ProjectRegistry`; what is composed
// from it is a directory name inside a config dir, and it is screened again by `ReadPolicy` before
// anything is opened (SEC-FS-1, the rule `TranscriptReader` follows for the same reason).
import type { ObservedBehaviour } from '../../contracts/observed-behaviour.ts';
import { projectKey, type ProjectRecord } from '../../contracts/project.ts';
import { SUBSCRIPTION_IDS, type SubscriptionId } from '../../contracts/session.ts';
import { childPath } from '../../contracts/windows-path.ts';
import { ObservedTally } from '../domain/observed-tally.ts';
import type { ReadPolicy } from '../domain/read-policy.ts';
import type { Clock } from '../ports/clock.ts';
import type { Logger } from '../ports/logger.ts';
import type { ProjectFiles } from '../ports/project-files.ts';
import type { TranscriptRecord } from '../../contracts/transcript-record.ts';
import { NEW_TRANSCRIPT, type TranscriptFile } from '../ports/transcript-file.ts';
import { TranscriptTail } from './transcript-tail.ts';
import { SignatureCache } from './signature-cache.ts';

/** Where Claude Code keeps them, inside a config dir. */
const PROJECTS_DIR = 'projects';
const TRANSCRIPT_SUFFIX = '.jsonl';

/**
 * The most transcripts one reading will open, per subscription.
 *
 * Seventy-five is the largest slug on this machine today (`xpert-new`, in the isg dir). Two
 * hundred is room for four years of this folder at the current rate, and it is a bound rather
 * than a target: a reading that opened an unbounded number of files would be one whose cost
 * nobody could state.
 */
export const MAX_TRANSCRIPTS = 200;

/**
 * How long a reading stands before it is taken again.
 *
 * Five minutes, the same as the workflow map's, and for a sharper reason: this one costs seconds
 * rather than milliseconds, and a panel redrawn while somebody reads it must not re-read 83 MB.
 */
export const OBSERVED_TTL_MS = 5 * 60 * 1000;

export interface ObservedReaderParts {
  readonly files: ProjectFiles;
  readonly transcripts: TranscriptFile;
  readonly policy: ReadPolicy;
  /** The two config directories, by subscription — `ClaudeInstall.configDirFor`'s answers. */
  readonly configDirs: Readonly<Record<SubscriptionId, string>>;
  readonly clock: Clock;
  readonly logger: Logger;
}

export class ObservedReader {
  private readonly parts: ObservedReaderParts;
  private readonly readings: SignatureCache<ObservedBehaviour>;

  constructor(parts: ObservedReaderParts) {
    this.parts = parts;
    this.readings = new SignatureCache<ObservedBehaviour>(parts.clock);
  }

  /**
   * What Claude actually did in this folder.
   *
   * Cached on a signature of the two slug directories — their newest mtime and how many files they
   * hold — so a panel redrawn, or two panels open, costs one read. A transcript being appended to
   * right now moves the mtime, which is the honest trigger: the reading is about what happened,
   * and what happened changed.
   */
  public async read(project: ProjectRecord): Promise<ObservedBehaviour> {
    const slug = projectSlug(project.path);
    const directories = this.directoriesFor(slug);
    const signature = await this.signature(directories);
    return this.readings.value(projectKey(project.path), signature, OBSERVED_TTL_MS, () =>
      this.scan(project.path, directories),
    );
  }

  /** Drops the readings of folders that are no longer imported, as the other readers do. */
  public keep(keys: readonly string[]): void {
    this.readings.keep(keys);
  }

  private directoriesFor(slug: string): readonly { sub: SubscriptionId; dir: string }[] {
    return SUBSCRIPTION_IDS.map((sub) => ({
      sub,
      dir: childPath(childPath(this.parts.configDirs[sub], PROJECTS_DIR), slug),
    }));
  }

  private async scan(
    path: string,
    directories: readonly { sub: SubscriptionId; dir: string }[],
  ): Promise<ObservedBehaviour> {
    const started = this.parts.clock.now().getTime();
    const tally = new ObservedTally();
    for (const { sub, dir } of directories) await this.scanDirectory(sub, dir, tally);
    const now = this.parts.clock.now().getTime();
    const reading = tally.summarise(path, now, now - started);
    this.parts.logger.info('observed_read', {
      path,
      sessions: reading.sessions,
      bytes: reading.bytesRead,
      ms: reading.tookMs,
    });
    return reading;
  }

  private async scanDirectory(
    subscription: SubscriptionId,
    directory: string,
    tally: ObservedTally,
  ): Promise<void> {
    const names = await this.parts.files.list(directory, MAX_TRANSCRIPTS);
    for (const name of names) {
      if (!name.endsWith(TRANSCRIPT_SUFFIX)) continue;
      const path = childPath(directory, name);
      // Screened before it is opened, every time, even though the directory was composed here:
      // this is the rule `TranscriptReader` follows, and the composition is not the proof.
      if (!this.parts.policy.allows(path)) continue;
      await this.scanFile(subscription, path, tally);
    }
  }

  /**
   * One transcript, read to the end in bounded slices.
   *
   * The loop ends on an empty read rather than on a size comparison, because the adapter is what
   * knows when it has run out — and a `restarted` slice mid-scan is a file that was replaced while
   * being read, which `TranscriptTail` handles by forgetting the partial line.
   */
  private async scanFile(
    subscription: SubscriptionId,
    path: string,
    tally: ObservedTally,
  ): Promise<void> {
    const tail = new TranscriptTail();
    const records: TranscriptRecord[] = [];
    let cursor = NEW_TRANSCRIPT;
    let bytes = 0;
    for (;;) {
      const slice = await this.parts.transcripts.read(path, cursor);
      if (slice.unreadable || slice.text === '') break;
      const batch = tail.absorb(slice);
      records.push(...batch.records);
      bytes += slice.to - slice.from;
      cursor = batch.cursor;
    }
    for (let line = 0; line < tail.unknown; line += 1) tally.addUnknownLine();
    tally.addSession(subscription, records, bytes);
  }

  /**
   * What proves the reading has not moved: each directory's newest mtime and its file count.
   *
   * The same bargain `WorkflowMapReader` makes — two cheap `stat`s rather than a hash of 83 MB.
   * A transcript appended to moves its directory's mtime on NTFS, which is the case that matters:
   * the reading is about what happened in this folder, and something just did.
   */
  private async signature(
    directories: readonly { sub: SubscriptionId; dir: string }[],
  ): Promise<string> {
    const parts: string[] = [];
    for (const { dir } of directories) {
      const facts = await this.parts.files.facts(dir);
      const names = facts === undefined ? [] : await this.parts.files.list(dir, MAX_TRANSCRIPTS);
      parts.push(`${String(facts?.modifiedAt ?? 0)}:${String(names.length)}`);
    }
    return parts.join('|');
  }
}

/**
 * The directory Claude Code keeps a folder's transcripts in.
 *
 * Its own function because the spelling is Claude Code's and is observed rather than documented:
 * every separator and every colon becomes `-`, so `C:\Users\belas\Documents\development\flightdeck`
 * is `C--Users-belas-Documents-development-flightdeck`. Read off this machine's own `projects/`
 * directories (19 of them) rather than inferred from one example.
 */
export function projectSlug(path: string): string {
  return path.replaceAll(/[\\/:]/gu, '-');
}
