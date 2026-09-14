// What an expanded row receives — P2-T4, SPEC §5.5.
//
// **A join, and the point is that none of it is new.** Every field below was already being produced
// and none of it had a reader: `TranscriptDigest` has held the files, the away summary, the spend
// and the last tool since P1-T7; `VitalsRegistry` has held the context percentage and cost since
// P1-T6; `jobs/<shortId>/state.json` has held the attention text since before Flightdeck existed.
// Three producers, one shape, one route — the same lesson P2-T3's header was.
//
// **Why a request rather than a frame.** The collapsed rows arrive on the stream and must, because
// they are the picture of the machine. This is the opposite: it is one session, asked for by a
// person who just clicked, and pushing every expansion's worth of detail to every open deck would
// be sending model text nobody is looking at (SEC-UI-2) for rows nobody expanded. So the stream
// stays the table's, and `DeckApi` — which exists for exactly this — fetches a detail on demand.
//
// **Everything here is display-only.** `doingNow`, `needs`, `result`, `awayRecap` and every
// timeline `text` are model-written; `intent`, `lastPrompt` and `title` are the owner's or the
// model's. Nothing is a command, a path to open or a value to branch on. The caps are in
// job-state.ts and the files list is bounded by `TranscriptDigest`.
import { parseJobState, parseTimeline, type JobState, type TimelineEntry } from './job-state.ts';

/**
 * One point on the tokens sparkline: a turn, and how many context tokens it left behind.
 *
 * A series rather than a number, which is the one thing none of the three producers had. See
 * `TokenTrail` for where the history is kept and why it is kept there.
 */
export interface TokenPoint {
  readonly at: number;
  readonly tokens: number;
}

/** What feed 4 read out of the transcript — all of it optional, all of it enrichment (P1-T7). */
export interface TranscriptExtras {
  readonly title: string | undefined;
  readonly titleIsCustom: boolean;
  readonly agent: string | undefined;
  readonly lastPrompt: string | undefined;
  readonly awaySummary: string | undefined;
  readonly awaySummaryAt: number | undefined;
  readonly lastTool: string | undefined;
  readonly lastToolAt: number | undefined;
  /** Newest first, capped at 40 by `TranscriptDigest`. */
  readonly files: readonly string[];
  readonly costUsd: number | undefined;
  readonly linesAdded: number | undefined;
  readonly linesRemoved: number | undefined;
}

export const NO_EXTRAS: TranscriptExtras = {
  title: undefined,
  titleIsCustom: false,
  agent: undefined,
  lastPrompt: undefined,
  awaySummary: undefined,
  awaySummaryAt: undefined,
  lastTool: undefined,
  lastToolAt: undefined,
  files: [],
  costUsd: undefined,
  linesAdded: undefined,
  linesRemoved: undefined,
};

/** The newest statusline reading for this one session (P1-T6). */
export interface SessionVitalsDetail {
  readonly at: number;
  readonly modelName: string | undefined;
  readonly usedPercentage: number | undefined;
  readonly costUsd: number | undefined;
  readonly contextWindowSize: number | undefined;
}

export interface SessionDetail {
  readonly sessionId: string;
  /** When core assembled this, epoch ms — so the deck can say how old an expansion is. */
  readonly at: number;
  /** From `state.json`, or `undefined` for an interactive session, which has no job directory. */
  readonly job: JobState | undefined;
  /** From `timeline.jsonl`, oldest first. Empty when there is no history to show. */
  readonly timeline: readonly TimelineEntry[];
  readonly vitals: SessionVitalsDetail | undefined;
  readonly extras: TranscriptExtras;
  /** Oldest first. Empty until two turns have been seen — one point is not a line. */
  readonly tokenTrail: readonly TokenPoint[];
}

/**
 * One detail body, or `undefined` if it is not one.
 *
 * `sessionId` is the only field that must be there, because it is the only one that says which row
 * this belongs to — an expansion that rendered against the wrong row would be worse than one that
 * did not open. Everything else is an enrichment and comes back absent rather than refusing.
 *
 * @throws never.
 */
export function parseSessionDetail(value: unknown): SessionDetail | undefined {
  const fields = asRecord(value);
  if (fields === undefined) return undefined;
  const sessionId = fields['sessionId'];
  if (typeof sessionId !== 'string' || sessionId === '') return undefined;
  return {
    sessionId,
    at: numberAt(fields, 'at') ?? 0,
    // Re-parsed rather than trusted: this is the same value core built, but it arrives over a
    // socket, and the caps in job-state.ts are the SEC-UI-2 boundary — enforcing them only on the
    // way out would leave the deck taking core's word for the size of a model-written string.
    job: parseJobState(fields['job']),
    timeline: timelineOf(fields['timeline']),
    vitals: vitalsOf(asRecord(fields['vitals'])),
    extras: extrasOf(asRecord(fields['extras'])),
    tokenTrail: tokenTrailOf(fields['tokenTrail']),
  };
}

type Fields = Readonly<Record<string, unknown>>;

/**
 * The timeline, through the same parser the file went through.
 *
 * It arrives as an array of objects here and as text there, so this re-serialises each entry to a
 * line rather than growing a second parser with a second opinion about the caps. The cost is one
 * `JSON.stringify` per entry on an expansion a person just asked for; the alternative is two
 * definitions of what a timeline entry is.
 */
function timelineOf(value: unknown): readonly TimelineEntry[] {
  if (!Array.isArray(value)) return [];
  return parseTimeline(value.map((entry: unknown) => JSON.stringify(entry)).join('\n'));
}

function vitalsOf(vitals: Fields | undefined): SessionVitalsDetail | undefined {
  if (vitals === undefined) return undefined;
  return {
    at: numberAt(vitals, 'at') ?? 0,
    modelName: stringAt(vitals, 'modelName'),
    usedPercentage: numberAt(vitals, 'usedPercentage'),
    costUsd: numberAt(vitals, 'costUsd'),
    contextWindowSize: numberAt(vitals, 'contextWindowSize'),
  };
}

/** A missing block is `NO_EXTRAS`, not a refusal: feed 4 is best-effort by design (SPEC §4.2). */
function extrasOf(extras: Fields | undefined): TranscriptExtras {
  if (extras === undefined) return NO_EXTRAS;
  const files = extras['files'];
  return {
    title: stringAt(extras, 'title'),
    titleIsCustom: extras['titleIsCustom'] === true,
    agent: stringAt(extras, 'agent'),
    lastPrompt: stringAt(extras, 'lastPrompt'),
    awaySummary: stringAt(extras, 'awaySummary'),
    awaySummaryAt: numberAt(extras, 'awaySummaryAt'),
    lastTool: stringAt(extras, 'lastTool'),
    lastToolAt: numberAt(extras, 'lastToolAt'),
    files: Array.isArray(files)
      ? files.filter((path: unknown): path is string => typeof path === 'string' && path !== '')
      : [],
    costUsd: numberAt(extras, 'costUsd'),
    linesAdded: numberAt(extras, 'linesAdded'),
    linesRemoved: numberAt(extras, 'linesRemoved'),
  };
}

/** A point with no instant or no count is dropped — a sparkline cannot plot a gap. */
function tokenTrailOf(value: unknown): readonly TokenPoint[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry: unknown) => {
      const point = asRecord(entry);
      if (point === undefined) return undefined;
      const at = numberAt(point, 'at');
      const tokens = numberAt(point, 'tokens');
      return at === undefined || tokens === undefined ? undefined : { at, tokens };
    })
    .filter((point): point is TokenPoint => point !== undefined);
}

function asRecord(value: unknown): Fields | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return Object.fromEntries(Object.entries(value));
}

function stringAt(source: Fields, key: string): string | undefined {
  const value = source[key];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function numberAt(source: Fields, key: string): number | undefined {
  const value = source[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
