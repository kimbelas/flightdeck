// The incremental index — P7-T1, SPEC §5.8, and what it stores.
//
// The cursor half is `transcript-indexer-cursor.test.ts`; this is what comes out of a transcript
// and what is deliberately never opened. Both share `transcript-indexer-harness.ts`.
import { describe, expect, it } from 'vitest';
import { build, line, settle, CONFIG, ENTRY, PATH, SESSION } from './transcript-indexer-harness.ts';

describe('TranscriptIndexer — what it stores', () => {
  it('indexes the prose it finds, and nothing else in the file', async () => {
    const { indexer, store, files } = build();
    files.holds(
      [
        line('deploy this to cloudflare workers'),
        JSON.stringify({ type: 'cost-state', costUSD: 1 }),
        line('Deployed.', 'assistant'),
        '',
      ].join('\n'),
    );

    const pass = await indexer.index();

    expect(pass.excerpts).toBe(2);
    expect(store.indexed[0]?.excerpts.map((prose) => prose.kind)).toEqual(['you', 'claude']);
  });

  it('files it under the session and the project the walk reported', async () => {
    const { indexer, store, files } = build();
    files.holds(`${line('hello')}\n`);

    await indexer.index();

    expect(store.indexed[0]).toMatchObject({
      subscription: '365',
      sessionId: SESSION,
      projectKey: 'C--work',
      path: PATH,
    });
  });

  // P7-T2. A file with no cursor replaces whatever its session already has in the store, which on
  // a new transcript is nothing — and after migration 9 dropped every cursor, is what keeps the
  // re-read from indexing every excerpt twice.
  it('reads a file with no cursor as a restart, and one with a cursor as a continuation', async () => {
    const { indexer, store, files } = build();
    files.holds(`${line('hello')}\n`);
    await indexer.index();
    files.holds(`${line('hello')}\n${line('again')}\n`);

    await indexer.index();

    expect(store.indexed.map((batch) => batch.restarted)).toEqual([true, false]);
  });

  // P7-T2's tool filter. The NAMES, each once per slice — never a tool's input.
  it('records every tool an assistant turn called, and not what it called them with', async () => {
    const { indexer, store, files } = build();
    const turn = (names: readonly string[]): string =>
      JSON.stringify({
        type: 'assistant',
        message: {
          content: names.map((name) => ({ type: 'tool_use', name, input: { command: 'secret' } })),
        },
      });
    files.holds(`${turn(['Read', 'Bash'])}\n${turn(['Bash', 'mcp__github__create_pr'])}\n`);

    await indexer.index();

    expect(store.indexed[0]?.tools).toEqual(['Read', 'Bash', 'mcp__github__create_pr']);
    expect(JSON.stringify(store.indexed[0])).not.toContain('secret');
  });
});

describe('TranscriptIndexer — how far it has got', () => {
  it('reports nothing indexed before the first pass has finished', () => {
    const { indexer } = build();

    expect(indexer.progress().passedAt).toBeUndefined();
  });

  // RESEARCH.md G.56: the cold start is hours. The report is what lets the deck say so.
  it('reports the bytes and files still behind when the budget ran out', async () => {
    // The walk says a megabyte; the file has handed over one line of it so far.
    const { indexer, files } = build();
    files.holds(`${line('hello')}\n`);

    await indexer.index();

    const progress = indexer.progress();
    expect(progress).toMatchObject({ transcripts: 1, bytesTotal: ENTRY.bytes });
    expect(progress.passedAt).toBeTypeOf('number');
    expect(progress.bytesIndexed).toBeGreaterThan(0);
    expect(progress.bytesIndexed).toBeLessThan(ENTRY.bytes);
    expect(progress.behind).toBe(1);
  });

  it('reports caught up once every cursor has reached its file', async () => {
    const content = `${line('hello')}\n`;
    const { indexer, files } = build([{ ...ENTRY, bytes: content.length }]);
    files.holds(content);

    await indexer.index();

    expect(indexer.progress()).toMatchObject({
      transcripts: 1,
      behind: 0,
      bytesIndexed: content.length,
    });
  });

  it('leaves a refused path out of the corpus it reports on', async () => {
    const { indexer } = build([{ ...ENTRY, path: 'C:\\Windows\\System32\\x.jsonl' }]);

    await indexer.index();

    expect(indexer.progress()).toMatchObject({ transcripts: 0, bytesTotal: 0, behind: 0 });
  });
});

describe('TranscriptIndexer — what it does not read', () => {
  it('skips a file no longer than the cursor it already holds', async () => {
    const { indexer, files } = build([{ ...ENTRY, bytes: 20 }]);
    files.holds(`${line('hello')}\n`);
    await indexer.index();
    const reads = files.reads.length;

    await indexer.index();

    expect(files.reads.length).toBe(reads);
  });

  // SEC-FS-2. The path came from core's own walk of a directory core chose, so this can only fail
  // for something that is not a transcript — which is the case worth refusing rather than
  // assuming away.
  it('refuses a path outside the config directories', async () => {
    const { indexer, store, files } = build([{ ...ENTRY, path: 'C:\\Windows\\System32\\x.jsonl' }]);
    files.holds(`${line('hello')}\n`);

    await indexer.index();

    expect(store.indexed).toEqual([]);
    expect(files.reads).toEqual([]);
  });

  it('stores nothing for a file it could not read, and leaves the cursor alone', async () => {
    const { indexer, store, files } = build();
    files.willNotRead();

    await indexer.index();

    expect(store.indexed).toEqual([]);
  });

  // The drift alarm belongs to `readTranscriptLine` (SPEC §8 R2). A second one firing on every
  // half-written fragment would make the first one worthless.
  it('walks past a line that will not parse rather than stopping', async () => {
    const { indexer, store, files } = build();
    files.holds(`not json at all\n${line('hello')}\n`);

    await indexer.index();

    expect(store.indexed[0]?.excerpts.map((prose) => prose.text)).toEqual(['hello']);
  });
});

describe('TranscriptIndexer — the timer', () => {
  it('indexes once immediately, so a fresh store is searchable before the first tick', async () => {
    const { indexer, store, files, scheduler } = build();
    files.holds(`${line('hello')}\n`);

    indexer.start();
    await settle();

    expect(scheduler.repeatingCount).toBe(1);
    expect(store.indexed).toHaveLength(1);
  });

  it('cancels its timer on stop, because NodeScheduler does not unref', () => {
    const { indexer, scheduler } = build();

    indexer.start();
    indexer.stop();

    expect(scheduler.repeatingCount).toBe(0);
  });

  it('is idempotent, so starting twice runs one timer', () => {
    const { indexer, scheduler } = build();

    indexer.start();
    indexer.start();

    expect(scheduler.repeatingCount).toBe(1);
  });
});

describe('TranscriptIndexer — the budget', () => {
  // `FsTranscriptFile` caps a read at 1 MB, so a 50 MB transcript takes fifty reads. Doing them
  // all in one tick would hold the event loop for seconds at boot, which is when the deck connects.
  it('reads at most a bounded number of files per pass, and reports the rest as behind', async () => {
    const content = `${line('hello')}\n`;
    const many = Array.from({ length: 40 }, (unused, index) => ({
      ...ENTRY,
      // The size the walk reported, so a file this pass caught up on is not ALSO counted as
      // behind — the eight here are the ones the budget never reached.
      bytes: Buffer.byteLength(content, 'utf8'),
      path: `${CONFIG}\\projects\\C--work\\${String(index).padStart(8, '0')}-0000-0000-0000-000000000000.jsonl`,
    }));
    const { indexer, files } = build(many);
    files.holds(content);

    const pass = await indexer.index();

    expect(pass.filesRead).toBe(32);
    expect(pass.behind).toBe(8);
  });
});
