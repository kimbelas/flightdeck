// What `GET /search` answers, whole — P7-T2, SPEC §5.8.
//
// P7-T1 answered `{ hits }`. This adds `index`: how far the indexer has got. **The reason is
// RESEARCH.md G.56**, measured on the first live boot — the cold backfill is at least fifty-five
// five-minute ticks, about four and a half hours, once per machine. For those hours a search that
// finds nothing is not evidence that nothing happened, and a box that said "no results" without
// saying so would be telling the owner a Cloudflare deploy never occurred. So every reply carries
// the answer to "can this be trusted yet", and the deck says it beside the hits.
//
// **Bytes, not files.** The catalogue walks newest first, so the files still behind are the OLD
// ones; a count of files would read as nearly done an hour in, while the bytes left are most of
// the corpus. Both are carried: the bytes say how much, the files say how many conversations.
import { parseSearchHits, type SearchHit } from './transcript-search.ts';

export interface IndexProgress {
  /** When the last pass finished, epoch ms. `undefined` until the first one has — at boot. */
  readonly passedAt: number | undefined;
  /** Transcripts the last walk found, across both subscriptions. */
  readonly transcripts: number;
  /** Of those, how many still had bytes to read when the pass's budget ran out. */
  readonly behind: number;
  readonly bytesTotal: number;
  /** How far the cursors have got, summed. Never more than `bytesTotal`. */
  readonly bytesIndexed: number;
}

/** What a core that has not finished its first pass reports. */
export const NOT_YET_INDEXED: IndexProgress = {
  passedAt: undefined,
  transcripts: 0,
  behind: 0,
  bytesTotal: 0,
  bytesIndexed: 0,
};

/** Whether a search right now can miss something that is on disk. */
export function isFilling(progress: IndexProgress): boolean {
  return progress.passedAt === undefined || progress.behind > 0;
}

export interface SearchReply {
  readonly hits: readonly SearchHit[];
  /** `undefined` from a core older than P7-T2, which the deck draws as "unknown", not "done". */
  readonly index: IndexProgress | undefined;
}

/** A `GET /search` body. Hits it cannot read are dropped; the rest are kept. @throws never. */
export function parseSearchReply(value: unknown): SearchReply {
  const fields = asRecord(value);
  return {
    hits: parseSearchHits(fields?.['hits']),
    index: parseIndexProgress(fields?.['index']),
  };
}

/** One progress report off the wire, or `undefined`. @throws never. */
export function parseIndexProgress(value: unknown): IndexProgress | undefined {
  const fields = asRecord(value);
  if (fields === undefined) return undefined;
  const passedAt = fields['passedAt'];
  const counts = [
    fields['transcripts'],
    fields['behind'],
    fields['bytesTotal'],
    fields['bytesIndexed'],
  ];
  const [transcripts, behind, bytesTotal, bytesIndexed] = counts.map(countOf);
  if (transcripts === undefined || behind === undefined) return undefined;
  if (bytesTotal === undefined || bytesIndexed === undefined) return undefined;
  if (passedAt !== undefined && countOf(passedAt) === undefined) return undefined;
  return {
    passedAt: countOf(passedAt),
    transcripts,
    behind,
    bytesTotal,
    bytesIndexed: Math.min(bytesIndexed, bytesTotal),
  };
}

function countOf(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return Object.fromEntries(Object.entries(value));
}
