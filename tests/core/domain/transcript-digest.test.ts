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
    const digest = TranscriptDigest.EMPTY.with({
      kind: 'tool',
      skill: undefined,
      contextTokens: undefined,
      tool: 'Bash',
      at: 500,
    }).with({
      kind: 'tool',
      skill: undefined,
      contextTokens: undefined,
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
      at: 900,
      startedAt: 100,
    });

    expect(digest.spend?.costUsd).toBe(31.16);
    expect(digest.spend?.byModel[0]?.model).toBe('claude-opus-5');
  });
});

describe('TranscriptDigest — the tokens sparkline (P2-T4)', () => {
  function cost(tokens: number, at: number | undefined): TranscriptRecord {
    return {
      kind: 'cost',
      costUsd: 1,
      linesAdded: 0,
      linesRemoved: 0,
      // Split across two models, because the point is a SUM: a trail that read one model's numbers
      // would flatten the moment a session used a sub-agent on a different one.
      spend: [
        {
          model: 'claude-opus-5',
          costUsd: 1,
          inputTokens: Math.floor(tokens / 2),
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
        },
        {
          model: 'claude-haiku-4-5',
          costUsd: 0,
          inputTokens: 0,
          outputTokens: tokens - Math.floor(tokens / 2),
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
        },
      ],
      at,
      startedAt: undefined,
    };
  }

  it('is empty for a single reading, because one point is not a line', () => {
    expect(TranscriptDigest.EMPTY.with(cost(100, 1000)).tokenTrail).toEqual([]);
  });

  it('plots cumulative tokens, oldest first', () => {
    const digest = TranscriptDigest.EMPTY.withAll([
      cost(100, 1000),
      cost(250, 2000),
      cost(900, 3000),
    ]);

    expect(digest.tokenTrail).toEqual([
      { at: 1000, tokens: 100 },
      { at: 2000, tokens: 250 },
      { at: 3000, tokens: 900 },
    ]);
  });

  it('skips a reading with no timestamp rather than placing it at now', () => {
    // A digest is built by replaying a file that may be hours old, so `Date.now()` would put the
    // point in the wrong place on the axis — worse than not drawing it.
    const digest = TranscriptDigest.EMPTY.withAll([
      cost(100, 1000),
      cost(250, undefined),
      cost(900, 3000),
    ]);

    expect(digest.tokenTrail.map((point) => point.at)).toEqual([1000, 3000]);
  });

  it('skips a reading that did not move the total', () => {
    // A `cost` record arrives per turn; a turn that consumed nothing would draw a flat step that
    // reads as idling rather than as nothing to plot.
    const digest = TranscriptDigest.EMPTY.withAll([
      cost(100, 1000),
      cost(100, 2000),
      cost(250, 3000),
    ]);

    expect(digest.tokenTrail.map((point) => point.tokens)).toEqual([100, 250]);
  });

  it('keeps the newest points once the cap is reached', () => {
    const digest = TranscriptDigest.EMPTY.withAll(
      Array.from({ length: 80 }, (unused, index) => cost((index + 1) * 10, (index + 1) * 1000)),
    );

    expect(digest.tokenTrail).toHaveLength(60);
    expect(digest.tokenTrail[0]?.tokens).toBe(210);
    expect(digest.tokenTrail.at(-1)?.tokens).toBe(800);
  });

  it('leaves every other field alone, so the fold still holds', () => {
    const digest = TranscriptDigest.EMPTY.with({
      kind: 'title',
      title: 'the-one',
      custom: true,
    }).withAll([cost(100, 1000), cost(250, 2000)]);

    expect(digest.title).toBe('the-one');
    expect(digest.tokenTrail).toHaveLength(2);
  });
});
