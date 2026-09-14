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
  | { readonly kind: 'tool'; readonly tool: string; readonly at: number | undefined };

/**
 * Record types seen on this machine — the P1-T7 survey of 315 transcripts, plus RESEARCH.md §C.
 *
 * This is not a list of what is parsed; it is a list of what has been **observed**, and most of it
 * is deliberately unread. Its only job is to separate "a record this build ignores" from "a record
 * this build has never seen", because those look identical at the parser and could not be less
 * alike: the first is 95 % of every transcript, and the second is the first sign that a Claude
 * Code update moved the format (SPEC §8 R2 — what `scripts/doctor` exists to catch).
 */
export const KNOWN_RECORD_TYPES: readonly string[] = [
  'agent-name',
  'agent-setting',
  'ai-title',
  'artifact-autoreact-ledger',
  'artifact-comment-monitor',
  'assistant',
  'atis-latch',
  'attachment',
  'bridge-session',
  'continued-in',
  'cost-state',
  'custom-title',
  'file-history-delta',
  'file-history-snapshot',
  'frame-link',
  'last-prompt',
  'mode',
  'permission-mode',
  'pr-link',
  'pr-comment-monitor',
  'queue-operation',
  // A session whose `cwd` moved, and the worktree it was forked into. P3 wants both — they are
  // the only in-transcript evidence that two sessions are the same piece of work in two places.
  'relocated',
  'worktree-state',
  'system',
  'user',
];

/** `system` subtypes seen. A new one is drift too — `system` is a bag, not a shape. */
export const KNOWN_SYSTEM_SUBTYPES: readonly string[] = [
  'agents_killed',
  'away_summary',
  'bridge_status',
  'compact_boundary',
  'informational',
  'local_command',
  'model_consent_fallback',
  'model_refusal_fallback',
  'scheduled_task_fire',
  'stop_hook_summary',
  'turn_duration',
];

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

function isKnown(type: string, fields: Readonly<Record<string, unknown>>): boolean {
  if (!KNOWN_RECORD_TYPES.includes(type)) return false;
  if (type !== 'system') return true;
  const subtype = stringAt(fields, 'subtype');
  // A `system` record with no subtype at all is a shape nobody has seen, so it is drift as well.
  return subtype !== undefined && KNOWN_SYSTEM_SUBTYPES.includes(subtype);
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
function parseAssistant(fields: Readonly<Record<string, unknown>>): TranscriptRecord | undefined {
  const message = asRecord(fields['message']);
  const content: unknown = message?.['content'];
  if (!Array.isArray(content)) return undefined;
  for (const item of content) {
    const entry = asRecord(item);
    if (entry === undefined || stringAt(entry, 'type') !== 'tool_use') continue;
    const tool = stringAt(entry, 'name');
    if (tool !== undefined) return { kind: 'tool', tool, at: instantAt(fields, 'timestamp') };
  }
  return undefined;
}

function parseCost(fields: Readonly<Record<string, unknown>>): TranscriptRecord {
  const usage = asRecord(fields['modelUsage']);
  return {
    kind: 'cost',
    costUsd: countAt(fields, 'totalCostUSD') ?? 0,
    linesAdded: countAt(fields, 'totalLinesAdded') ?? 0,
    linesRemoved: countAt(fields, 'totalLinesRemoved') ?? 0,
    spend: usage === undefined ? [] : spendOf(usage),
  };
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
