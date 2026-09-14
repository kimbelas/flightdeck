// Everything feed 4 knows about one session, folded down — P1-T7, SPEC §4.2 and §5.5.
//
// A transcript is an append-only log and this is its right fold: every record replaces the field it
// speaks for and touches nothing else, so a digest never has to be rebuilt from the start of a
// 50 MB file. That is the property the byte offset depends on being true.
//
// **Everything here is an enrichment, and every field is optional.** The documented feeds own
// liveness, attention and vitals (D3); this owns the extras on an expanded row. A release that
// renames `away_summary` must cost a card its recap, never a row its state — so there is no
// constructor that can fail and no field anything downstream may require.
//
// **Immutable, by R6.** `with` returns a new digest; the reader keeps the newest one per session.
import type { ModelSpend, TranscriptRecord } from '../../contracts/transcript-record.ts';

/** How many touched files to remember, newest first. The deck shows a handful; the store owns history. */
const MAX_FILES = 40;

export interface Compaction {
  readonly trigger: string;
  readonly preTokens: number;
  readonly postTokens: number;
  readonly at: number | undefined;
}

export interface Turn {
  readonly durationMs: number;
  readonly messageCount: number;
  readonly at: number | undefined;
}

export interface Spend {
  readonly costUsd: number;
  readonly linesAdded: number;
  readonly linesRemoved: number;
  readonly byModel: readonly ModelSpend[];
}

export class TranscriptDigest {
  public static readonly EMPTY = new TranscriptDigest({});

  private readonly fields: Readonly<Fields>;

  private constructor(fields: Readonly<Fields>) {
    this.fields = fields;
  }

  /** The card's title. A title the owner set beats one the model derived — see `with`. */
  public get title(): string | undefined {
    return this.fields.customTitle ?? this.fields.aiTitle;
  }

  /** True when `title` is the owner's own, not Claude Code's. The deck draws the two differently. */
  public get titleIsCustom(): boolean {
    return this.fields.customTitle !== undefined;
  }

  /** The `--agent` name, when the session runs one. */
  public get agent(): string | undefined {
    return this.fields.agent;
  }

  /** The last prompt, as Claude Code truncated it. Model/user text — displayed, never interpreted. */
  public get lastPrompt(): string | undefined {
    return this.fields.lastPrompt;
  }

  /** The plain-English recap of what happened while the owner was away. The best card text there is. */
  public get awaySummary(): string | undefined {
    return this.fields.awaySummary;
  }

  public get awaySummaryAt(): number | undefined {
    return this.fields.awaySummaryAt;
  }

  /** Cost and lines, from Claude Code's own arithmetic. Never recomputed from token rates (D5). */
  public get spend(): Spend | undefined {
    return this.fields.spend;
  }

  public get lastCompaction(): Compaction | undefined {
    return this.fields.compaction;
  }

  public get lastTurn(): Turn | undefined {
    return this.fields.turn;
  }

  /** Files this session touched, newest first, capped at `MAX_FILES`. */
  public get files(): readonly string[] {
    return this.fields.files ?? [];
  }

  /** The last tool the model reached for — SPEC §5.5's ◇ fallback for "doing right now". */
  public get lastTool(): string | undefined {
    return this.fields.tool;
  }

  public get lastToolAt(): number | undefined {
    return this.fields.toolAt;
  }

  /** True when nothing has been read yet. The deck draws no extras rather than empty ones. */
  public get isEmpty(): boolean {
    return Object.keys(this.fields).length === 0;
  }

  /**
   * This digest plus one record.
   *
   * A `title` record carries which kind it is rather than which field to write, so the precedence
   * between a custom title and an AI one lives here — in one place — instead of at every read.
   */
  public with(record: TranscriptRecord): TranscriptDigest {
    return new TranscriptDigest({ ...this.fields, ...fieldsFor(record, this.files) });
  }

  /** This digest plus a whole batch, in file order. */
  public withAll(records: readonly TranscriptRecord[]): TranscriptDigest {
    return records.reduce<TranscriptDigest>((digest, record) => digest.with(record), this);
  }
}

interface Fields {
  aiTitle?: string;
  customTitle?: string;
  agent?: string;
  lastPrompt?: string;
  awaySummary?: string;
  awaySummaryAt?: number;
  spend?: Spend;
  compaction?: Compaction;
  turn?: Turn;
  files?: readonly string[];
  tool?: string;
  toolAt?: number;
}

/**
 * Which fields one record writes.
 *
 * Split three ways rather than one nine-case switch, along the line the records themselves fall on:
 * what the session is called, what just happened to it, and what it has cost. Every case is named
 * rather than defaulted, so adding a record kind is a type error here and not a silent no-op —
 * which is the whole value of the union (R12).
 */
function fieldsFor(record: TranscriptRecord, files: readonly string[]): Fields {
  switch (record.kind) {
    case 'title':
    case 'agent':
    case 'prompt':
      return namesFor(record);
    case 'away':
    case 'file':
    case 'tool':
      return activityFor(record, files);
    case 'cost':
    case 'compaction':
    case 'turn':
      return measurementsFor(record);
  }
}

/** What the session is called. */
function namesFor(
  record: Extract<TranscriptRecord, { kind: 'title' | 'agent' | 'prompt' }>,
): Fields {
  switch (record.kind) {
    case 'title':
      return record.custom ? { customTitle: record.title } : { aiTitle: record.title };
    case 'agent':
      return { agent: record.name };
    case 'prompt':
      return { lastPrompt: record.prompt };
  }
}

/** What just happened — the three records that carry a timestamp worth keeping. */
function activityFor(
  record: Extract<TranscriptRecord, { kind: 'away' | 'file' | 'tool' }>,
  files: readonly string[],
): Fields {
  switch (record.kind) {
    case 'away':
      return withAt({ awaySummary: record.summary }, 'awaySummaryAt', record.at);
    case 'file':
      return { files: touch(files, record.path) };
    case 'tool':
      return withAt({ tool: record.tool }, 'toolAt', record.at);
  }
}

/** What it has cost. */
function measurementsFor(
  record: Extract<TranscriptRecord, { kind: 'cost' | 'compaction' | 'turn' }>,
): Fields {
  switch (record.kind) {
    case 'cost':
      return {
        spend: {
          costUsd: record.costUsd,
          linesAdded: record.linesAdded,
          linesRemoved: record.linesRemoved,
          byModel: record.spend,
        },
      };
    case 'compaction':
      return {
        compaction: {
          trigger: record.trigger,
          preTokens: record.preTokens,
          postTokens: record.postTokens,
          at: record.at,
        },
      };
    case 'turn':
      return {
        turn: { durationMs: record.durationMs, messageCount: record.messageCount, at: record.at },
      };
  }
}

/**
 * Moves `path` to the front, deduplicated, capped.
 *
 * A file edited eleven times is one entry that keeps moving, not eleven — the row says what this
 * session has been working on, and a list that is eleven copies of one filename says nothing.
 */
function touch(files: readonly string[], path: string): readonly string[] {
  return [path, ...files.filter((seen) => seen !== path)].slice(0, MAX_FILES);
}

/**
 * `exactOptionalPropertyTypes` is on, so an absent timestamp is an absent KEY, not a present
 * `undefined` — writing the key would overwrite a good timestamp with nothing on the next record.
 */
function withAt(fields: Fields, key: 'awaySummaryAt' | 'toolAt', at: number | undefined): Fields {
  return at === undefined ? fields : { ...fields, [key]: at };
}
