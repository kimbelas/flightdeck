// P1-T7 — feed 4 against the real transcripts on this machine, not against the 26-record fixture.
//
// The fixture proves the parsers accept the shapes that were captured. It cannot prove the things
// that only exist at scale: that a 22 MB transcript is read in one pass without holding 22 MB, that
// the 3 MB `user` records really are the only lines over the cap, and that a corpus written by
// twenty Claude Code versions carries no record type this build has never seen. That last one is
// the whole point — `unknown` is the number `scripts/doctor` will watch after `claude update`
// (SPEC §8 R2), and a number nobody has ever seen be zero is not a baseline.
//
// **It prints no transcript content.** Lengths, counts and timings only. The corpus it reads is
// the owner's real work across both subscriptions (SEC-DATA-1), and a probe whose output could not
// be pasted into a PR is a probe that gets run once and then guessed at.
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { TranscriptTail } from '../core/application/transcript-tail.ts';
import { FsTranscriptFile } from '../core/adapters/node/fs-transcript-file.ts';
import { TranscriptDigest } from '../core/domain/transcript-digest.ts';
import { NEW_TRANSCRIPT, type TranscriptCursor } from '../core/ports/transcript-file.ts';

export interface TranscriptReading {
  readonly bytes: number;
  readonly reads: number;
  readonly ms: number;
  readonly records: number;
  readonly ignored: number;
  readonly unknown: number;
  readonly oversize: number;
  readonly restarts: number;
  /** What the digest ended up holding, as lengths and flags — never as text. */
  readonly digest: {
    readonly title: number | undefined;
    readonly custom: boolean;
    readonly agent: boolean;
    readonly prompt: number | undefined;
    readonly away: number | undefined;
    readonly costUsd: number | undefined;
    readonly models: number;
    readonly files: number;
    readonly tool: string | undefined;
    readonly compactions: string | undefined;
  };
}

/** Reads one transcript to its end, the way the reader's poll would over many ticks. */
export async function readWhole(path: string): Promise<TranscriptReading> {
  const tail = new TranscriptTail();
  const startedAt = Date.now();
  const drained = await drain(path, tail);
  return {
    bytes: drained.cursor.offset,
    reads: drained.reads,
    ms: Date.now() - startedAt,
    records: drained.records,
    ignored: tail.ignored,
    unknown: tail.unknown,
    oversize: tail.oversize,
    restarts: tail.restarts,
    digest: summarise(drained.digest),
  };
}

interface Drained {
  readonly digest: TranscriptDigest;
  readonly cursor: TranscriptCursor;
  readonly records: number;
  readonly reads: number;
}

/** Reads until a slice adds nothing — several passes on a big file, because of `MAX_SLICE_BYTES`. */
async function drain(path: string, tail: TranscriptTail): Promise<Drained> {
  const file = new FsTranscriptFile();
  let digest = TranscriptDigest.EMPTY;
  let cursor: TranscriptCursor = NEW_TRANSCRIPT;
  let records = 0;
  let reads = 0;
  for (;;) {
    const slice = await file.read(path, cursor);
    if (slice.unreadable || slice.to === cursor.offset) return { digest, cursor, records, reads };
    reads += 1;
    const batch = tail.absorb(slice);
    records += batch.records.length;
    digest = digest.withAll(batch.records);
    cursor = batch.cursor;
  }
}

/** Lengths and flags. See the header: this output has to be safe to paste into a PR. */
function summarise(digest: TranscriptDigest): TranscriptReading['digest'] {
  return {
    title: digest.title?.length,
    custom: digest.titleIsCustom,
    agent: digest.agent !== undefined,
    prompt: digest.lastPrompt?.length,
    away: digest.awaySummary?.length,
    costUsd: digest.spend?.costUsd,
    models: digest.spend?.byModel.length ?? 0,
    files: digest.files.length,
    tool: digest.lastTool,
    compactions: digest.lastCompaction?.trigger,
  };
}

/** Every transcript under both config dirs, largest first — the worst case is the interesting one. */
export function findTranscripts(roots: readonly string[]): readonly string[] {
  const found = roots.flatMap((root) => listing(root).flatMap((slug) => jsonlIn(join(root, slug))));
  return [...found].sort((left, right) => statSync(right).size - statSync(left).size);
}

/** A directory that is not there is not an error here — one config dir may not exist. */
function listing(directory: string): readonly string[] {
  try {
    return readdirSync(directory);
  } catch {
    return [];
  }
}

function jsonlIn(directory: string): readonly string[] {
  return listing(directory)
    .filter((name) => name.endsWith('.jsonl'))
    .map((name) => join(directory, name));
}
