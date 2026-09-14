// What `jobs/<shortId>/state.json` and `jobs/<shortId>/timeline.jsonl` say — P2-T4, RESEARCH.md
// F.2.4 and F.2.14.
//
// **Two files nobody had to build.** The deck's expanded row wants "what is this session doing",
// "what does it want from me" and "what happened while I was away", and all three are already
// written to disk by Claude Code's daemon, already summarised, one line per state transition. That
// is cheaper than feed 4's transcript tail and needs no inference at all: `needs` is a sentence the
// model wrote saying what it is waiting for.
//
// **A projection, not a mirror** — the rule `statusline-report.ts` set. `state.json` carries 25
// keys and this reads nine; `linkScanPath` names a transcript under the owner's home directory and
// `providerEnv.CLAUDE_CONFIG_DIR` names the config dir, and neither is read, because what is never
// read cannot leak (SEC-DATA-2) and a shape that grows a field next release cannot surprise
// anything here.
//
// **Everything here except `intent` is model-generated, and `text` is unbounded** (SEC-UI-2,
// F.2.14). So every string is capped on the way in, and the caps are the reason this file exists
// rather than a `JSON.parse` at the call site.
//
// **This parser runs on TWO encodings of the same thing, and three fields nearly shipped broken.**
// It reads the daemon's file, and it reads its own output again after `JSON.stringify` when the
// deck re-parses a detail rather than trusting core's caps (contracts/session-detail.ts). The file
// nests (`inFlight.tasks`, `output.result`) and writes ISO instants; the wire is flat and writes
// epoch ms. A reader that knew only the file shape silently dropped all three on the second pass —
// no error, no empty string, just a recap with no times and a missing task count. A round-trip test
// is what found it, and `atEither`/`nestedOrFlat` below are what keep it found.
//
// **Truncated, not dropped** — the opposite of `TranscriptTail`'s rule for an oversize line, and
// the difference is where the boundary sits. There, a half-line would be handed to `JSON.parse`
// and counted as a schema change, which is a lie. Here the JSON is already parsed and the string
// is a paragraph of English: half a recap is most of a recap, and refusing one because the model
// was verbose would lose the field this whole task is about.
import { RUN_STATES, type RunState } from './session.ts';

/**
 * The longest model-written sentence kept from `detail`, `needs` and `output.result`.
 *
 * These are one-liners by construction — the longest seen on this machine is 48 characters — so
 * this is a guard against a release that changes their character, not a budget anybody spends.
 */
export const MAX_DETAIL_CHARS = 400;

/**
 * The longest assistant message kept from a timeline entry's `text`.
 *
 * `text` is the FULL message that caused a transition (F.2.14) and has no documented bound. The
 * away recap is read at a glance, so this is generous for the purpose and small enough that a
 * hundred entries cannot cost a megabyte.
 */
export const MAX_TEXT_CHARS = 2000;

/**
 * How many timeline entries are kept, newest last.
 *
 * The file is append-only and never truncated by the daemon, so a long-lived session's history
 * grows without limit. The recap is "what happened while I was away", which is the tail.
 */
export const MAX_TIMELINE_ENTRIES = 50;

/** What a session is doing right now, from `state.json`. Every field optional — see the header. */
export interface JobState {
  readonly state: RunState | undefined;
  /** The one-line summary of what it is doing. Model-generated (SEC-UI-2). */
  readonly detail: string | undefined;
  /** What it wants from the owner. Present only while blocked — the attention text (F.2.4). */
  readonly needs: string | undefined;
  /** `output.result` — what it produced. Model-generated. */
  readonly result: string | undefined;
  /** `idle`, `blocked`, and whatever else the daemon writes. Not a closed union here: it is not
   * one anywhere this project can see, and a guess would be a union that silently drops a value. */
  readonly tempo: string | undefined;
  /** Context tokens, as the daemon counts them. One number, not a series. */
  readonly tokens: number | undefined;
  /** `inFlight.tasks` — how many tool calls are outstanding. */
  readonly inFlightTasks: number | undefined;
  /** The first prompt. The one string here that is the OWNER's text rather than the model's. */
  readonly intent: string | undefined;
  readonly updatedAt: number | undefined;
}

/** One state transition from `timeline.jsonl`. */
export interface TimelineEntry {
  readonly at: number | undefined;
  readonly state: RunState | undefined;
  /** The same one-line summary that lands in `state.json`. Model-generated. */
  readonly detail: string | undefined;
  /** The full assistant message that caused the transition — empty entering `working` (F.2.14). */
  readonly text: string | undefined;
}

/**
 * One `state.json`, or `undefined` if it is not one.
 *
 * Nothing is required, so this refuses only a body that is not an object at all. A job whose state
 * file is half-written during a transition should cost the row its extras, not take the expansion
 * down — every field is an enrichment (TranscriptDigest's rule, and the same reasoning).
 *
 * @throws never.
 */
export function parseJobState(value: unknown): JobState | undefined {
  const fields = asRecord(value);
  if (fields === undefined) return undefined;
  const inFlight = asRecord(fields['inFlight']);
  const output = asRecord(fields['output']);
  return {
    state: runStateAt(fields, 'state'),
    detail: cappedAt(fields, 'detail', MAX_DETAIL_CHARS),
    needs: cappedAt(fields, 'needs', MAX_DETAIL_CHARS),
    // Nested on disk (`output.result`), flat on the wire. See the header.
    result:
      (output === undefined ? undefined : cappedAt(output, 'result', MAX_DETAIL_CHARS)) ??
      cappedAt(fields, 'result', MAX_DETAIL_CHARS),
    tempo: cappedAt(fields, 'tempo', MAX_DETAIL_CHARS),
    tokens: numberAt(fields, 'tokens'),
    // Nested on disk (`inFlight.tasks`), flat on the wire. `??` rather than `||`, so a real 0 —
    // which is the common reading — is kept rather than falling through to the other shape.
    inFlightTasks:
      (inFlight === undefined ? undefined : numberAt(inFlight, 'tasks')) ??
      numberAt(fields, 'inFlightTasks'),
    intent: cappedAt(fields, 'intent', MAX_DETAIL_CHARS),
    updatedAt: instantAt(fields, 'updatedAt'),
  };
}

/**
 * The tail of a `timeline.jsonl`, oldest first, at most `MAX_TIMELINE_ENTRIES`.
 *
 * Takes the whole file's text rather than a line, because the useful unit is the history: the
 * caller wants the last N transitions and the file is the only thing that knows which those are.
 * A line that does not parse is skipped rather than ending the read — a partially-flushed last
 * line is ordinary on a file being appended to while it is read.
 *
 * @throws never.
 */
export function parseTimeline(text: string): readonly TimelineEntry[] {
  const entries = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map(timelineEntryOf)
    .filter((entry): entry is TimelineEntry => entry !== undefined);
  return entries.slice(-MAX_TIMELINE_ENTRIES);
}

function timelineEntryOf(line: string): TimelineEntry | undefined {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return undefined;
  }
  const fields = asRecord(value);
  if (fields === undefined) return undefined;
  return {
    at: instantAt(fields, 'at'),
    state: runStateAt(fields, 'state'),
    detail: cappedAt(fields, 'detail', MAX_DETAIL_CHARS),
    text: cappedAt(fields, 'text', MAX_TEXT_CHARS),
  };
}

type Fields = Readonly<Record<string, unknown>>;

/** As in the other contracts: an annotated return keeps `any` from escaping `Object.entries`. */
function asRecord(value: unknown): Fields | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return Object.fromEntries(Object.entries(value));
}

/** An unknown state is dropped rather than coerced — the rule for every closed union (§11 rule 1). */
function runStateAt(source: Fields, key: string): RunState | undefined {
  return RUN_STATES.find((state) => state === source[key]);
}

/**
 * A string, cut to `limit`.
 *
 * The ellipsis is part of the value rather than the component's job, so every reader shows the same
 * thing and none of them has to know the limit. An empty string comes back `undefined`: the daemon
 * writes `"text": ""` on entry to `working` (F.2.14), and an empty recap is an absent one.
 */
function cappedAt(source: Fields, key: string, limit: number): string | undefined {
  const value = source[key];
  if (typeof value !== 'string' || value === '') return undefined;
  return value.length <= limit ? value : `${value.slice(0, limit)}…`;
}

/**
 * An instant as epoch ms, from either an ISO string or a number.
 *
 * **Both, because this parser runs twice on two different encodings.** The files write ISO strings
 * (`"2026-09-14T12:00:00.000Z"`), and the deck re-parses the same shape after it has been through
 * `JSON.stringify`, where the value is already the epoch ms this produced (contracts/
 * session-detail.ts re-parses rather than trusting core's caps). A string-only reader silently
 * dropped every timeline timestamp on the second pass, and the only symptom was a recap whose
 * every line said nothing about when — caught by a round-trip test, not by anything on screen.
 */
function instantAt(source: Fields, key: string): number | undefined {
  const value = source[key];
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string') return undefined;
  const at = Date.parse(value);
  return Number.isFinite(at) ? at : undefined;
}

function numberAt(source: Fields, key: string): number | undefined {
  const value = source[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
