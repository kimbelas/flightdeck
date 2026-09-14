// Locks in the transcript record shapes surveyed in P1-T7 (RESEARCH.md §C and §G.15).
//
// Feed 4 is the one undocumented feed (SPEC §4.2), so this fixture is the only thing standing
// between a Claude Code release and a silently wrong card. It is also the fixture most likely to
// go stale: the capture is 26 records out of 96,941 lines, chosen as the leanest and richest
// instance of each shape, because the gap between those two is where every trap in this feed
// lives — `lastPrompt` is absent on a real `last-prompt` record, and `modelUsage` is `{}` on a
// session that has not spent anything.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  KNOWN_RECORD_TYPES,
  parseTranscriptRecord,
  readTranscriptLine,
  type TranscriptRecord,
} from '../../contracts/transcript-record.ts';
import { TranscriptDigest } from '../../core/domain/transcript-digest.ts';
// @ts-expect-error -- plain ESM helper script, no type declarations by design.
import { STRUCTURAL_SEGMENTS } from '../../scripts/capture-fixtures.mjs';

/** The scrubber's own list, so this test cannot drift from the rule it is checking. */
const structural = STRUCTURAL_SEGMENTS as ReadonlySet<string>;

const LINES = readFileSync(
  new URL('../../fixtures/transcript/records.jsonl', import.meta.url),
  'utf8',
)
  .trim()
  .split('\n');

const RECORDS: readonly unknown[] = LINES.map((line): unknown => JSON.parse(line));

/** The same narrowing the parsers use (`asRecord`), so this file needs no casts of its own. */
function fieldsOf(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value));
}

function typeOf(value: unknown): string | undefined {
  const type = fieldsOf(value)['type'];
  return typeof type === 'string' ? type : undefined;
}

/** The `trackedFileBackups` map on a `file-history-snapshot`, or an empty one. */
function backupsOf(value: unknown): Readonly<Record<string, unknown>> {
  return fieldsOf(fieldsOf(fieldsOf(value)['snapshot'])['trackedFileBackups']);
}

function kindsOf(kind: TranscriptRecord['kind']): readonly TranscriptRecord[] {
  return RECORDS.map((record) => parseTranscriptRecord(record)).filter(
    (record): record is TranscriptRecord => record?.kind === kind,
  );
}

describe('the captured transcript', () => {
  it('is one record per line, which is the property the tail depends on', () => {
    expect(LINES).toHaveLength(26);
    for (const line of LINES) expect(() => JSON.parse(line) as unknown).not.toThrow();
  });

  it('carries no record type this build has never seen — the fixture IS the known list', () => {
    for (const record of RECORDS) {
      expect(readTranscriptLine(record).known).toBe(true);
    }
  });

  it('has every type in KNOWN_RECORD_TYPES spelled the way the capture spells it', () => {
    const captured = new Set(
      RECORDS.map((record) => typeOf(record)).filter((type): type is string => type !== undefined),
    );
    for (const type of captured) expect(KNOWN_RECORD_TYPES).toContain(type);
  });
});

describe('the traps the lean/rich pairs exist to pin', () => {
  it('has a real last-prompt record with NO lastPrompt field', () => {
    const lastPrompts = RECORDS.filter((record) => typeOf(record) === 'last-prompt');

    expect(lastPrompts).toHaveLength(2);
    // A parser that took the record type as proof of the field would read `undefined` as a prompt
    // and blank the card subtitle every time this shape came past.
    expect(lastPrompts.some((record) => !('lastPrompt' in fieldsOf(record)))).toBe(true);
    expect(kindsOf('prompt')).toHaveLength(1);
  });

  it('has a cost-state whose modelUsage is empty, and one with real per-model spend', () => {
    const costs = kindsOf('cost');

    expect(costs).toHaveLength(2);
    const spends = costs.map((record) => (record.kind === 'cost' ? record.spend.length : -1));
    expect(spends).toContain(0);
    expect(Math.max(...spends)).toBeGreaterThan(0);
  });

  it('reads cost per model off modelUsage, whose KEYS are the model ids', () => {
    const rich = kindsOf('cost').find((record) => record.kind === 'cost' && record.spend.length > 0);

    expect(rich?.kind).toBe('cost');
    if (rich?.kind !== 'cost') return;
    for (const model of rich.spend) {
      // The scrubber leaves model ids verbatim — closed, published vocabulary — so this fixture
      // can still assert the mapping the deck's avatar and cost rows are built on.
      expect(model.model).toMatch(/^claude-/);
      expect(model.costUsd).toBeGreaterThanOrEqual(0);
    }
  });

  it('has a file-history-snapshot whose trackedFileBackups is empty, and one with 98 entries', () => {
    const snapshots = RECORDS.filter(
      (record) => typeOf(record) === 'file-history-snapshot',
    );

    expect(snapshots).toHaveLength(2);
    const sizes = snapshots.map((snapshot) => Object.keys(backupsOf(snapshot)).length);
    expect(Math.min(...sizes)).toBe(0);
    expect(Math.max(...sizes)).toBeGreaterThan(50);
  });

  it('keeps trackedFileBackups keyed by a scrubbed path of the same depth and extension', () => {
    const keys = RECORDS.flatMap((record) => Object.keys(backupsOf(record)));

    expect(keys.length).toBeGreaterThan(50);
    for (const key of keys) {
      // The keys of this object are DATA, and the first capture put a whole client project tree
      // into the repo because nothing had ever scrubbed a key (P1-T7, and P0-T9 before it).
      for (const segment of key.split('\\')) {
        // Read from the scrubber's own list rather than a copy of it: a test that restated the
        // rule would keep passing after the rule changed, which is the one thing it must not do.
        if (structural.has(segment)) continue;
        expect(segment).toMatch(/^(?:[A-Za-z]:|path-[0-9a-f]{6}(?:\.[A-Za-z0-9]+)?)$/);
      }
    }
  });
});

describe('every captured shape through the real parser', () => {
  it('reads a title, and a custom title beats an AI one', () => {
    const digest = TranscriptDigest.EMPTY.withAll(
      RECORDS.map((record) => parseTranscriptRecord(record)).filter(
        (record): record is TranscriptRecord => record !== undefined,
      ),
    );

    expect(digest.title).toBeTypeOf('string');
    expect(digest.titleIsCustom).toBe(true);
  });

  it('reads the away summary, the compaction and the turn off the system records', () => {
    expect(kindsOf('away')).toHaveLength(2);
    expect(kindsOf('turn')).toHaveLength(2);

    const compactions = kindsOf('compaction');
    expect(compactions).toHaveLength(2);
    for (const record of compactions) {
      if (record.kind !== 'compaction') continue;
      expect(record.preTokens).toBeGreaterThan(record.postTokens);
      expect(['manual', 'auto']).toContain(record.trigger);
    }
  });

  it('reads the tool name off an assistant turn and nothing else from it', () => {
    const tools = kindsOf('tool');

    expect(tools.length).toBeGreaterThan(0);
    for (const record of tools) {
      if (record.kind !== 'tool') continue;
      expect(record.tool).toBeTypeOf('string');
      // The tool INPUT is the most sensitive field in the record — a command, a prompt, a file
      // being written — and never reaches a record (SEC-UI-2).
      expect(Object.keys(record)).toEqual(['kind', 'tool', 'at']);
    }
  });

  it('reads a touched file off a file-history-delta', () => {
    expect(kindsOf('file')).toHaveLength(1);
  });

  it('reads nothing at all out of user, attachment, mode or atis-latch', () => {
    for (const type of ['user', 'attachment', 'mode', 'permission-mode', 'atis-latch']) {
      const record = RECORDS.find((item) => typeOf(item) === type);
      expect(parseTranscriptRecord(record)).toBeUndefined();
      expect(readTranscriptLine(record).known).toBe(true);
    }
  });
});
