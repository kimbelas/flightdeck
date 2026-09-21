// The transcript half of a preview — P5a-T4, SPEC §5.3's "else the transcript tail".
//
// **A trail is not a screen, and this file is where that is admitted.** `claude logs` replays what
// the session's terminal looks like; there is nothing in a transcript that reconstructs that. What
// there is is the record stream, and what a reader of it can honestly say is what the session DID
// and when — which is the question a preview is being asked anyway, and the one the deck cannot
// answer from anywhere else once the daemon is gone (RESEARCH.md F.2.16).
//
// **It shows only the records this build already parses, and that is a security decision rather
// than a shortcut.** `contracts/transcript-record.ts` is deliberately a projection: 95 % of a
// transcript is `user` and `attachment` records carrying pasted files and tool results, and
// Flightdeck reads none of it — "what is never read cannot leak" (SEC-UI-2, SEC-DATA-1). Rendering
// the conversation here would mean teaching the parser to read `assistant` message content, which
// is the single largest body of model prose in the product, for a fallback view. The trail is
// built from `tool`, `file`, `turn`, `compaction` and `away`, all of which already have a reader
// and a cap.
//
// **No IO, no clock, no `node:*`** — it takes the text and the instant and returns lines, which is
// what makes "a record with no timestamp still gets a row" a three-line test.
import { readTranscriptLine, type TranscriptRecord } from '../../contracts/transcript-record.ts';

/** How many rows a trail shows. The screen it stands in for is fifty, and most of those are blank. */
export const MAX_TRAIL_ROWS = 24;

/**
 * The most characters of model-written text one row carries.
 *
 * An away summary is a paragraph and a prompt is whatever somebody typed. They are capped upstream
 * in contracts/job-state.ts and contracts/transcript-record.ts; this is the narrower cap that makes
 * a row a ROW — a preview line that wrapped six times would push the rest of the trail off the box.
 */
const MAX_ROW_TEXT = 140;

/** The column every row's text starts in, so the ages and the kinds line up without a table. */
const AGE_WIDTH = 8;
const KIND_WIDTH = 6;

/**
 * The last records of a transcript, oldest first, as lines.
 *
 * @param text a tail of a transcript — whole JSONL records, as `TranscriptFile.tail` cuts them.
 * @param now epoch ms, for the ages. A record with no instant of its own gets no age rather than
 * a guessed one: `cost-state` lines carry no timestamp (P2-T4 measured it), and a made-up age on a
 * trail whose whole value is sequence would be the one lie worth avoiding here.
 * @throws never — a line that will not parse is skipped, exactly as `TranscriptTail` skips it.
 */
export function trailOf(text: string, now: number): readonly string[] {
  const rows: string[] = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    const record = read(line);
    if (record === undefined) continue;
    const row = rowOf(record, now);
    if (row !== undefined) rows.push(row);
  }
  return tally(rows).slice(-MAX_TRAIL_ROWS);
}

/**
 * Runs of identical rows, collapsed to one with a count.
 *
 * **Found by running it, not by testing it** (RESEARCH.md §G, G.37). Against this session's own
 * transcript the trail came back as twenty-four rows saying about six things: a wall of `tool Bash`
 * and `tool Edit`, because an agentic turn reaches for the same tool several times and the age is
 * in whole minutes, so the rows render identically.
 *
 * A COUNT rather than a plain de-duplication, deliberately. Dropping the repeats would lose real
 * events: two `Bash` calls a few seconds apart render the same row because the age is in whole
 * minutes, and a trail that showed one of them would be saying the session did less than it did.
 * `x4` says the same thing in one line and loses nothing.
 */
function tally(rows: readonly string[]): readonly string[] {
  const out: string[] = [];
  let run = 0;
  for (const [index, row] of rows.entries()) {
    if (row === rows[index - 1]) {
      run += 1;
      continue;
    }
    if (run > 1) out[out.length - 1] = `${String(out.at(-1))}  x${String(run)}`;
    out.push(row);
    run = 1;
  }
  if (run > 1) out[out.length - 1] = `${String(out.at(-1))}  x${String(run)}`;
  return out;
}

function read(line: string): TranscriptRecord | undefined {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return undefined;
  }
  return readTranscriptLine(value).record;
}

/**
 * One record as a row, or `undefined` for one that is not an event.
 *
 * `title`, `agent` and `cost` are dropped on purpose and they are the interesting omissions: all
 * three are already on the expanded row, as the card's title, its agent chip and its vitals strip.
 * Repeating them in a trail of what happened would make a session that renamed itself look like it
 * had done something.
 *
 * **`prompt` joined them after this was run against a real transcript** (RESEARCH.md G.37). It
 * fails all three tests the others fail: it is already on the row above as the intent line, it
 * carries no `timestamp` so it cannot be placed in the sequence, and Claude Code REWRITES
 * `last-prompt` on every turn rather than appending — so a tail holds one copy per turn, and this
 * session's own trail came back with the same 140 characters on seven of its twenty-four rows,
 * non-consecutively, where the run-length collapse below could not reach them.
 */
function rowOf(record: TranscriptRecord, now: number): string | undefined {
  if (record.kind === 'tool') return row(record.at, now, 'tool', record.tool);
  if (record.kind === 'file') return row(record.at, now, 'file', record.path);
  if (record.kind === 'away') return row(record.at, now, 'away', record.summary);
  return sentenceRowOf(record, now);
}

/**
 * The two rows whose text is a sentence rather than a name, and every kind that draws none.
 *
 * Split from `rowOf` when P3-T5 added two kinds and pushed one switch over the complexity limit.
 * The seam is real rather than arbitrary: above are the rows that print a value, and here are the
 * ones that have to compose one — plus the list of what a trail deliberately never shows, which is
 * named case by case so a kind added later is a type error rather than a silent blank row.
 */
function sentenceRowOf(
  record: Exclude<TranscriptRecord, { kind: 'tool' | 'file' | 'away' }>,
  now: number,
): string | undefined {
  switch (record.kind) {
    case 'turn':
      return row(
        record.at,
        now,
        'turn',
        `${String(record.messageCount)} messages in ${seconds(record.durationMs)}`,
      );
    case 'compaction':
      return row(
        record.at,
        now,
        'pack',
        `compacted ${String(record.preTokens)} to ${String(record.postTokens)} tokens (${record.trigger})`,
      );
    // P3-T5's two join the four that were already here. A context reading is on every assistant
    // turn, so a trail that drew them would be one row of "carrying 412k" per turn and nothing
    // else; a scheduled fire belongs to the folder's history rather than to this session's last
    // twenty rows (`ObservedTally` is what reads both).
    case 'prompt':
    case 'title':
    case 'agent':
    case 'cost':
    case 'context':
    case 'scheduled':
      return undefined;
  }
}

function row(at: number | undefined, now: number, kind: string, text: string): string {
  return `${age(at, now).padStart(AGE_WIDTH)}  ${kind.padEnd(KIND_WIDTH)}${clip(text)}`;
}

/**
 * How long ago, or blank.
 *
 * Relative rather than a clock time, and that is not a style choice: core has no idea what time
 * zone the deck is in and formatting one here would put a machine-local hour into a string the
 * browser cannot correct. A future instant — a transcript written by a machine whose clock is
 * ahead — reads as `now` rather than as a negative age.
 */
function age(at: number | undefined, now: number): string {
  if (at === undefined) return '';
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 60) return `${String(seconds)}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${String(minutes)}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${String(hours)}h ago`;
  return `${String(Math.round(hours / 24))}d ago`;
}

function seconds(durationMs: number): string {
  return `${String(Math.max(0, Math.round(durationMs / 1000)))}s`;
}

/**
 * One line of it, capped.
 *
 * Newlines become spaces rather than being kept: a row is a row, and an away summary with a
 * paragraph break in it would otherwise become two trail entries, one of them with no age and no
 * kind, which reads as a record that is not there.
 */
function clip(text: string): string {
  const flat = text.replaceAll(/\s+/gu, ' ').trim();
  return flat.length <= MAX_ROW_TEXT ? flat : `${flat.slice(0, MAX_ROW_TEXT - 1)}…`;
}
