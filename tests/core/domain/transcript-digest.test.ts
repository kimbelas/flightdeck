// The right fold over a transcript — P1-T7.
import { describe, expect, it } from 'vitest';
import { TranscriptDigest } from '../../../core/domain/transcript-digest.ts';
import type { TranscriptRecord } from '../../../contracts/transcript-record.ts';

const AI_TITLE: TranscriptRecord = { kind: 'title', title: 'derived', custom: false };
const CUSTOM_TITLE: TranscriptRecord = { kind: 'title', title: 'mine', custom: true };

describe('TranscriptDigest', () => {
  it('starts empty, and says so rather than reading as a session with blank extras', () => {
    expect(TranscriptDigest.EMPTY.isEmpty).toBe(true);
    expect(TranscriptDigest.EMPTY.title).toBeUndefined();
    expect(TranscriptDigest.EMPTY.files).toEqual([]);
  });

  it('is immutable — folding a record returns a new digest', () => {
    const before = TranscriptDigest.EMPTY;

    const after = before.with(AI_TITLE);

    expect(before.title).toBeUndefined();
    expect(after.title).toBe('derived');
  });

  it('lets a title the owner set beat one the model derived, whichever order they arrive', () => {
    const aiLast = TranscriptDigest.EMPTY.withAll([CUSTOM_TITLE, AI_TITLE]);
    const customLast = TranscriptDigest.EMPTY.withAll([AI_TITLE, CUSTOM_TITLE]);

    // Both records keep arriving as a session runs, so precedence cannot depend on order.
    expect(aiLast.title).toBe('mine');
    expect(customLast.title).toBe('mine');
    expect(aiLast.titleIsCustom).toBe(true);
  });

  it('keeps the newest of each field and touches nothing else', () => {
    const digest = TranscriptDigest.EMPTY.withAll([
      { kind: 'prompt', prompt: 'first' },
      { kind: 'away', summary: 'a recap', at: 1000 },
      { kind: 'prompt', prompt: 'second' },
    ]);

    expect(digest.lastPrompt).toBe('second');
    expect(digest.awaySummary).toBe('a recap');
    expect(digest.awaySummaryAt).toBe(1000);
  });

  it('moves a file that is touched again rather than listing it twice', () => {
    const digest = TranscriptDigest.EMPTY.withAll([
      { kind: 'file', path: 'a.ts', at: undefined },
      { kind: 'file', path: 'b.ts', at: undefined },
      { kind: 'file', path: 'a.ts', at: undefined },
    ]);

    expect(digest.files).toEqual(['a.ts', 'b.ts']);
  });

  it('caps the file list, because a long session touches more files than a row can show', () => {
    const records: TranscriptRecord[] = Array.from({ length: 60 }, (unused, index) => ({
      kind: 'file',
      path: `file-${String(index)}.ts`,
      at: undefined,
    }));

    const digest = TranscriptDigest.EMPTY.withAll(records);

    expect(digest.files).toHaveLength(40);
    expect(digest.files[0]).toBe('file-59.ts');
  });

  it('does not blank a good timestamp with a record that has none', () => {
    const digest = TranscriptDigest.EMPTY.with({ kind: 'tool', tool: 'Bash', at: 500 }).with({
      kind: 'tool',
      tool: 'Read',
      at: undefined,
    });

    expect(digest.lastTool).toBe('Read');
    // `exactOptionalPropertyTypes` makes "absent" and "present and undefined" different things,
    // and writing the key would have thrown away the only timestamp the row had.
    expect(digest.lastToolAt).toBe(500);
  });

  it('keeps cost exactly as Claude Code computed it, per model (D5)', () => {
    const digest = TranscriptDigest.EMPTY.with({
      kind: 'cost',
      costUsd: 31.16,
      linesAdded: 12,
      linesRemoved: 3,
      spend: [
        {
          model: 'claude-opus-5',
          costUsd: 31.16,
          inputTokens: 2,
          outputTokens: 1608,
          cacheReadTokens: 30_200_000,
          cacheCreationTokens: 97,
        },
      ],
    });

    expect(digest.spend?.costUsd).toBe(31.16);
    expect(digest.spend?.byModel[0]?.model).toBe('claude-opus-5');
  });
});
