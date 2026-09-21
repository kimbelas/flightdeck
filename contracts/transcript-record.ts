// What Flightdeck reads out of a transcript line — P1-T7, SPEC §4.2 feed 4, RESEARCH.md §C.
//
// **Feed 4 is the only undocumented feed, and this file is where that is admitted.** `sessions.md`
// says the JSONL is internal and changes between releases, and it does: a survey of 315 transcripts
// on this machine turned up `atis-latch`, `frame-link`, `artifact-autoreact-ledger`,
// `artifact-comment-monitor` and `continued-in`, none of which RESEARCH.md §C lists. So the rule
// here is the inverse of `hook-event.ts`: a record this build cannot name is **not an error**, it
// is a record for a version of Claude Code that is not this one. `parseTranscriptRecord` returns
// `undefined` for it and the caller counts it. A schema change in this feed must cost one card's
// extras and nothing else.
//
// **A projection, not a mirror** — the same choice as `statusline-report.ts`. A 50 MB transcript is
// mostly `user` and `attachment` records carrying pasted files and tool results, and Flightdeck
// reads none of it. What is never read cannot leak (SEC-UI-2, SEC-DATA-1).
//
// **Every string in here is model- or user-written text.** Titles, prompts, away summaries and tool
// names are displayed as text and never interpreted (CODING-STANDARDS §11.3).

import { isKnown } from './transcript-drift.ts';

/** One model's slice of a `cost-state`. Claude Code computes the cost; nothing here recomputes it (D5). */
export interface ModelSpend {
  readonly model: string;
  readonly costUsd: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheCreationTokens: number;
}

/**
 * A transcript line this build understands.
 *
 * A discriminated union (R12) over the shapes Flightdeck actually reads, not over the record types
 * Claude Code writes — `ai-title` and `custom-title` are two record types and one `title` here,
 * because the only thing downstream wants to know is which of them wins.
 */
export type TranscriptRecord =
  | { readonly kind: 'title'; readonly title: string; readonly custom: boolean }
  | { readonly kind: 'agent'; readonly name: string }
  | { readonly kind: 'prompt'; readonly prompt: string }
  | {
      readonly kind: 'cost';
      readonly costUsd: number;
      readonly linesAdded: number;
      readonly linesRemoved: number;
      readonly spend: readonly ModelSpend[];
      /**
       * When this reading was taken, epoch ms. Added in P2-T4 for the tokens sparkline.
       *
       * **Derived, because a `cost-state` line has no `timestamp`** — which is not what the record
       * beside it does, and is the sort of assumption that ships an empty chart. `turn_duration`
       * carries `timestamp` and this does not; what it carries is `startTime` (epoch ms, the
       * SESSION's start, identical on every record of the session) and `totalDuration` (ms since
       * that start, climbing). Their sum is the instant the line was written. Measured on a real
       * session: three records, one `startTime` of 1789392887439, `totalDuration` 315773 →
       * 11624456 → 11624509.
       *
       * `timestamp` is still preferred if a release ever adds one, so the derivation is the
       * fallback rather than the rule.
       */
      readonly at: number | undefined;
    }
  | { readonly kind: 'away'; readonly summary: string; readonly at: number | undefined }
  | {
      readonly kind: 'compaction';
      readonly trigger: string;
      readonly preTokens: number;
      readonly postTokens: number;
      readonly at: number | undefined;
    }
  | {
      readonly kind: 'turn';
      readonly durationMs: number;
      readonly messageCount: number;
      readonly at: number | undefined;
    }
  | { readonly kind: 'file'; readonly path: string; readonly at: number | undefined }
  | {
      readonly kind: 'tool';
      readonly tool: string;
      /**
       * Which skill, when the tool was `Skill` — P3-T5.
       *
       * Skills leave no record type of their own. Measured over this repository's own transcripts:
       * every skill invocation is a `Skill` tool call whose `input.skill` names it (run 11,
       * ship 7, loop 4, capture 2, keybindings-help 1). So "skills triggered" is a projection of
       * the tool list rather than a second source, and a skill that stops being a tool call stops
       * being counted rather than being counted wrongly.
       */
      readonly skill: string | undefined;
      /** See the `context` kind. Carried here too, because one line can be both. */
      readonly contextTokens: number | undefined;
      readonly at: number | undefined;
    }
  /**
   * How much context an assistant turn actually used — P3-T5, SPEC §5.1(b)'s "median context".
   *
   * `message.usage` is on **every** assistant record (1 777 of 1 777, measured), and the context a
   * turn was carrying is `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`.
   * The alternative source was `compact_boundary.preTokens`, and this repository's own slug has
   * **no compactions at all** — a median over an empty list is the sort of number that gets
   * invented rather than measured.
   *
   * A kind of its own only for assistant lines with no `tool_use` in them; a line with both
   * reports the tool and carries the tokens on it.
   */
  | { readonly kind: 'context'; readonly contextTokens: number; readonly at: number | undefined }
  | {
      /** `system`/`scheduled_task_fire` — a loop or cron firing in this folder (SPEC §5.1(b)). */
      readonly kind: 'scheduled';
      readonly at: number | undefined;
    };

export interface TranscriptLine {
  /** What this build reads out of the line, or `undefined` when it reads nothing out of it. */
  readonly record: TranscriptRecord | undefined;
  /** False when the line's `type` (or `system` subtype) has never been observed. The alarm. */
  readonly known: boolean;
}

/**
 * One line, classified.
 *
 * The separation above is why this exists next to `parseTranscriptRecord`: a caller that only knew
 * "no record came out" would have to treat the 19,294 `user` records in a transcript as evidence of
 * a schema change, which would make the evidence worthless.
 *
 * @throws never. This is the boundary the task title's "unknown shapes never throw" names.
 */
export function readTranscriptLine(value: unknown): TranscriptLine {
  const fields = asRecord(value);
  const type = fields === undefined ? undefined : stringAt(fields, 'type');
  if (fields === undefined || type === undefined) return { record: undefined, known: false };
  return { record: parseTranscriptRecord(value), known: isKnown(type, fields) };
}

/**
 * One line's record, or `undefined` if this build has no use for it.
 *
 * `undefined` covers three different things on purpose — a record type this build does not read, a
 * record type it does not know, and a record whose shape has moved — because the response to all
 * three is identical here: keep the byte offset and read the next line. `readTranscriptLine` is
 * what tells the last of those apart from the first two.
 *
 * @throws never.
 */
export function parseTranscriptRecord(value: unknown): TranscriptRecord | undefined {
  const fields = asRecord(value);
  if (fields === undefined) return undefined;
  const type = stringAt(fields, 'type');
  if (type === undefined) return undefined;
  if (type === 'system') return parseSystem(fields);
  return parseTyped(type, fields);
}

function parseTyped(
  type: string,
  fields: Readonly<Record<string, unknown>>,
): TranscriptRecord | undefined {
  switch (type) {
    case 'ai-title':
      return titleOf(stringAt(fields, 'aiTitle'), false);
    case 'custom-title':
      return titleOf(stringAt(fields, 'customTitle'), true);
    case 'agent-name':
      return nameOf(stringAt(fields, 'agentName'));
    case 'last-prompt':
      return promptOf(stringAt(fields, 'lastPrompt'));
    case 'cost-state':
      return parseCost(fields);
    case 'file-history-delta':
      return fileOf(stringAt(fields, 'trackingPath'), instantAt(fields, 'timestamp'));
    case 'assistant':
      return parseAssistant(fields);
    default:
      return undefined;
  }
}

function parseSystem(fields: Readonly<Record<string, unknown>>): TranscriptRecord | undefined {
  const at = instantAt(fields, 'timestamp');
  switch (stringAt(fields, 'subtype')) {
    case 'away_summary': {
      const summary = stringAt(fields, 'content');
      return summary === undefined ? undefined : { kind: 'away', summary, at };
    }
    case 'compact_boundary':
      return parseCompaction(fields, at);
    case 'turn_duration': {
      const durationMs = countAt(fields, 'durationMs');
      const messageCount = countAt(fields, 'messageCount');
      if (durationMs === undefined || messageCount === undefined) return undefined;
      return { kind: 'turn', durationMs, messageCount, at };
    }
    // P3-T5. A loop or a cron firing here. Seven of them in this repository's own slug.
    case 'scheduled_task_fire':
      return { kind: 'scheduled', at };
    // A `system` record with no subtype at all; `isKnown` has already counted it as drift.
    case undefined:
    default:
      return undefined;
  }
}

function parseCompaction(
  fields: Readonly<Record<string, unknown>>,
  at: number | undefined,
): TranscriptRecord | undefined {
  const meta = asRecord(fields['compactMetadata']);
  if (meta === undefined) return undefined;
  return {
    kind: 'compaction',
    // `manual` and `auto` are the two observed. A string rather than a union for the same reason
    // `FdEvent.type` is one: the vocabulary is Claude Code's, and a third value is a release away.
    trigger: stringAt(meta, 'trigger') ?? 'unknown',
    preTokens: countAt(meta, 'preTokens') ?? 0,
    postTokens: countAt(meta, 'postTokens') ?? 0,
    at,
  };
}

/**
 * The first `tool_use` in an assistant turn — SPEC §5.5's ◇ fallback for "doing right now".
 *
 * Only the tool's NAME. `input` carries the prompt, the command or the file being written, which is
 * the most sensitive field in the record and is never what a deck row needs (SEC-UI-2).
 */
/**
 * One assistant turn: which tool it called, which skill that was, and what it cost in context.
 *
 * Three facts off one line, because they are one line's worth: a `tool_use` block names the tool
 * and — for `Skill` — the skill, while `message.usage` beside it says how much context the turn
 * was carrying. A turn with no tool call still reports its context, which is the `context` kind.
 */
function parseAssistant(fields: Readonly<Record<string, unknown>>): TranscriptRecord | undefined {
  const message = asRecord(fields['message']);
  const at = instantAt(fields, 'timestamp');
  const contextTokens = contextOf(asRecord(message?.['usage']));
  const content: unknown = message?.['content'];
  if (!Array.isArray(content)) return undefined;

  for (const item of content) {
    const entry = asRecord(item);
    if (entry === undefined || stringAt(entry, 'type') !== 'tool_use') continue;
    const tool = stringAt(entry, 'name');
    if (tool === undefined) continue;
    return { kind: 'tool', tool, skill: skillOf(tool, entry), contextTokens, at };
  }
  return contextTokens === undefined ? undefined : { kind: 'context', contextTokens, at };
}

/** The skill a `Skill` call names. Anything else is not a skill call and answers `undefined`. */
function skillOf(tool: string, entry: Readonly<Record<string, unknown>>): string | undefined {
  if (tool !== 'Skill') return undefined;
  const input = asRecord(entry['input']);
  return input === undefined ? undefined : stringAt(input, 'skill');
}

/**
 * What the turn was carrying, in tokens.
 *
 * The three that make up the window: what was sent, what was read from cache and what was written
 * to it. `output_tokens` is deliberately not in the sum — it is what came back, not what was
 * held. `undefined` when there is no usage at all rather than `0`, because a turn that reported
 * nothing and a turn that carried nothing are different things and only one of them is possible.
 */
function contextOf(usage: Readonly<Record<string, unknown>> | undefined): number | undefined {
  if (usage === undefined) return undefined;
  const parts = ['input_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens'];
  const counted = parts.map((name) => countAt(usage, name));
  if (counted.every((value) => value === undefined)) return undefined;
  return counted.reduce((sum: number, value) => sum + (value ?? 0), 0);
}

function parseCost(fields: Readonly<Record<string, unknown>>): TranscriptRecord {
  const usage = asRecord(fields['modelUsage']);
  return {
    kind: 'cost',
    costUsd: countAt(fields, 'totalCostUSD') ?? 0,
    linesAdded: countAt(fields, 'totalLinesAdded') ?? 0,
    linesRemoved: countAt(fields, 'totalLinesRemoved') ?? 0,
    spend: usage === undefined ? [] : spendOf(usage),
    at: costInstant(fields),
  };
}

/** `timestamp` if a release ever adds one; otherwise `startTime + totalDuration`. See `at`. */
function costInstant(fields: Readonly<Record<string, unknown>>): number | undefined {
  const stamped = instantAt(fields, 'timestamp');
  if (stamped !== undefined) return stamped;
  const startTime = countAt(fields, 'startTime');
  const elapsed = countAt(fields, 'totalDuration');
  return startTime === undefined || elapsed === undefined ? undefined : startTime + elapsed;
}

/** `modelUsage` is keyed BY MODEL ID — the keys are the data, and the only place the model appears. */
function spendOf(usage: Readonly<Record<string, unknown>>): readonly ModelSpend[] {
  return Object.entries(usage).flatMap(([model, raw]) => {
    const entry = asRecord(raw);
    if (entry === undefined) return [];
    return [
      {
        model,
        costUsd: countAt(entry, 'costUSD') ?? 0,
        inputTokens: countAt(entry, 'inputTokens') ?? 0,
        outputTokens: countAt(entry, 'outputTokens') ?? 0,
        cacheReadTokens: countAt(entry, 'cacheReadInputTokens') ?? 0,
        cacheCreationTokens: countAt(entry, 'cacheCreationInputTokens') ?? 0,
      },
    ];
  });
}

function titleOf(title: string | undefined, custom: boolean): TranscriptRecord | undefined {
  return title === undefined ? undefined : { kind: 'title', title, custom };
}

function nameOf(name: string | undefined): TranscriptRecord | undefined {
  return name === undefined ? undefined : { kind: 'agent', name };
}

/**
 * `lastPrompt` is genuinely absent on some real `last-prompt` records (fixtures/transcript), so a
 * parser that took the record type as proof of the field would throw away the ones that have it.
 */
function promptOf(prompt: string | undefined): TranscriptRecord | undefined {
  return prompt === undefined ? undefined : { kind: 'prompt', prompt };
}

function fileOf(path: string | undefined, at: number | undefined): TranscriptRecord | undefined {
  return path === undefined ? undefined : { kind: 'file', path, at };
}

/** As in statusline-report.ts: an annotated return keeps `any` from escaping `Object.entries`. */
function asRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return Object.fromEntries(Object.entries(value));
}

function stringAt(source: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const value = source[key];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function countAt(source: Readonly<Record<string, unknown>>, key: string): number | undefined {
  const value = source[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined;
  return value;
}

/** An ISO instant as epoch ms. One that does not parse is absent, not zero — 1970 sorts first. */
function instantAt(source: Readonly<Record<string, unknown>>, key: string): number | undefined {
  const text = stringAt(source, key);
  if (text === undefined) return undefined;
  const at = Date.parse(text);
  return Number.isNaN(at) ? undefined : at;
}
