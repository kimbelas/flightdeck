// The prose in a transcript line — P7-T1, SPEC §5.8, SEC-DATA-1.
//
// **A second projection beside `transcript-record.ts`, and the split is the point.** That file's
// header says what it is: *"A projection, not a mirror… What is never read cannot leak."* It reads
// what HAPPENED — a tool ran, a turn cost this much, the context was that deep — and it is held in
// memory per tracked transcript by `TranscriptDigest`, walked by `ObservedTally` and drawn by
// `TranscriptTrail`. Putting the full text of every user and assistant turn into that union would
// push megabytes of prose through three classes that want none of it, and would make three
// exhaustive switches each answer for a field they exist to ignore.
//
// Search asks a different question — *what was SAID* — and its answer goes straight into the store
// and nowhere else (SEC-DATA-1). So it gets its own reader, and the two never meet.
//
// **What is indexed is 1.4 % of the bytes.** Measured over all 1 041 transcripts on this machine,
// 1.76 GB across both subscriptions (RESEARCH.md G.56): 25 MB of it is typed turns and assistant
// text. The other 98.6 % is tool results, attachments and pasted files — which is why an index over
// "both subscriptions' transcripts" is about 25 MB of text, and why leaving the rest out is not a
// compromise but the same decision `transcript-record.ts` already made.
//
// **`last-prompt` is deliberately NOT the source of user text.** That record type is what
// `TranscriptRecord`'s `prompt` kind reads, and it carries the session's most recent prompt — it is
// re-written as the session goes, so indexing it would give one turn per session and call it the
// conversation. A `user` record with string content is one thing somebody typed.
//
// **Every string here is model- or user-written text** and is stored, returned and displayed as
// text, never interpreted (SEC-UI-2, CODING-STANDARDS §11.3).

/** Who said it. Four kinds, because a search result reads differently depending on which. */
export const PROSE_KINDS = ['you', 'claude', 'title', 'away'] as const;

export type ProseKind = (typeof PROSE_KINDS)[number];

/**
 * The longest excerpt kept from one record, in characters.
 *
 * 8 KB. The largest assistant record measured in P1-T7's survey is 66 KB and the largest `user`
 * line is 3.2 MB — the latter being a pasted file rather than a sentence. FTS5 matches on tokens,
 * so the first 8 KB of a turn finds the turn; keeping all of a 3 MB paste would make the index
 * bigger than the thing it indexes and would store a file the owner pasted in, which is exactly
 * what SEC-DATA-1 is careful about.
 */
export const MAX_EXCERPT_CHARS = 8192;

/** One piece of prose out of one transcript line. */
export interface TranscriptProse {
  readonly kind: ProseKind;
  /** Trimmed and capped at `MAX_EXCERPT_CHARS`. Never empty — an empty turn produces nothing. */
  readonly text: string;
  /** When it was said, epoch ms, or `undefined` when the line carries no timestamp. */
  readonly at: number | undefined;
}

/**
 * The prose in one parsed transcript line, or `undefined` when it holds none.
 *
 * `undefined` is the ordinary answer and by a wide margin: most lines are tool results and
 * attachments. A line this build cannot read is not an error here either — the schema-drift alarm
 * is `readTranscriptLine`'s job (SPEC §8 R2), and a second one that fired on every tool result
 * would be noise.
 *
 * @throws never.
 */
export function readTranscriptProse(value: unknown): TranscriptProse | undefined {
  const fields = asRecord(value);
  if (fields === undefined) return undefined;
  switch (fields['type']) {
    case 'user':
      return proseOf('you', userText(fields), instantAt(fields));
    case 'assistant':
      return proseOf('claude', assistantText(fields), instantAt(fields));
    case 'ai-title':
    case 'custom-title':
      return proseOf('title', textAt(fields, 'title'), instantAt(fields));
    case 'system':
      return fields['subtype'] === 'away_summary'
        ? proseOf('away', textAt(fields, 'content'), instantAt(fields))
        : undefined;
    default:
      return undefined;
  }
}

/**
 * What somebody typed.
 *
 * `message.content` is a STRING for a typed turn and an ARRAY for a tool result being fed back
 * (`tool_result` blocks). Only the string form is a person talking, and the array form is the bulk
 * of the `user` records in any transcript — 19 294 of them in one file P1-T7 surveyed.
 */
function userText(fields: Readonly<Record<string, unknown>>): string | undefined {
  const message = asRecord(fields['message']);
  const content: unknown = message?.['content'];
  return typeof content === 'string' ? content : undefined;
}

/**
 * What Claude said, with the tool calls left out.
 *
 * `message.content` is an array of blocks; only `text` blocks are prose. Several are joined with a
 * blank line rather than concatenated, because two blocks are two paragraphs and a search snippet
 * that ran them together would read as one sentence that was never written.
 */
function assistantText(fields: Readonly<Record<string, unknown>>): string | undefined {
  const message = asRecord(fields['message']);
  const content: unknown = message?.['content'];
  if (!Array.isArray(content)) return undefined;
  const parts: string[] = [];
  for (const item of content) {
    const block = asRecord(item);
    if (block?.['type'] !== 'text') continue;
    const text = block['text'];
    if (typeof text === 'string' && text.trim() !== '') parts.push(text);
  }
  return parts.length === 0 ? undefined : parts.join('\n\n');
}

/** Trimmed, capped, and `undefined` rather than an empty excerpt nobody could match. */
function proseOf(
  kind: ProseKind,
  text: string | undefined,
  at: number | undefined,
): TranscriptProse | undefined {
  const trimmed = (text ?? '').trim();
  if (trimmed === '') return undefined;
  return { kind, text: trimmed.slice(0, MAX_EXCERPT_CHARS), at };
}

function textAt(fields: Readonly<Record<string, unknown>>, name: string): string | undefined {
  const value = fields[name];
  return typeof value === 'string' ? value : undefined;
}

/** An ISO `timestamp` as epoch ms, or `undefined` — the same field every record type carries. */
function instantAt(fields: Readonly<Record<string, unknown>>): number | undefined {
  const raw = fields['timestamp'];
  if (typeof raw !== 'string') return undefined;
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return Object.fromEntries(Object.entries(value));
}
