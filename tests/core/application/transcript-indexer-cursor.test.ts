// The byte cursor — P7-T1, and the half of the indexer that is the feature.
//
// Three things it must not do, and each is silent when it happens:
//
//  1. **Re-index bytes it has already read.** A pass that started from zero every time would grow
//     the index without bound and make every search return the same conversation several times.
//  2. **Advance past a partial record.** `TranscriptFile.read` stops wherever the writer happened
//     to be, so a slice's last line is usually half a record. Persisting that offset would make a
//     core that stopped between two writes resume INSIDE a line, turning one record into an
//     unparseable fragment on every restart — for the life of that transcript.
//  3. **Keep excerpts from a transcript that was replaced.** A resumed session writes a fresh file
//     at a path already indexed, and a search that returned the old conversation would read as a
//     bug in the search rather than in the index.
import { describe, expect, it } from 'vitest';
import { build, line } from './transcript-indexer-harness.ts';

describe('TranscriptIndexer — the cursor', () => {
  it('starts a file it has never read at the beginning', async () => {
    const { indexer, files } = build();
    files.holds(`${line('hello')}\n`);

    await indexer.index();

    expect(files.reads[0]).toEqual({ offset: 0, identity: '' });
  });

  it('resumes from where it stopped rather than re-reading the file', async () => {
    const { indexer, files } = build();
    const first = `${line('hello')}\n`;
    files.holds(first);
    await indexer.index();

    files.holds(`${first + line('again')}\n`);
    await indexer.index();

    expect(files.reads[1]?.offset).toBe(Buffer.byteLength(first, 'utf8'));
  });

  it('indexes only what was appended, not the whole file again', async () => {
    const { indexer, store, files } = build();
    const first = `${line('hello')}\n`;
    files.holds(first);
    await indexer.index();

    files.holds(`${first + line('again')}\n`);
    await indexer.index();

    expect(store.indexed[1]?.excerpts.map((prose) => prose.text)).toEqual(['again']);
  });

  /**
   * Trap 2, and the one that only shows up after a restart.
   *
   * The slice ends mid-record because the writer was mid-write. The cursor has to stop at the last
   * newline, so the next read starts at the beginning of that line rather than inside it.
   */
  it('stops at the last newline when the slice ends mid-record', async () => {
    const { indexer, store, files } = build();
    const whole = `${line('hello')}\n`;
    files.holds(`${whole}{"type":"user","message":{"content":"half a`);

    await indexer.index();

    expect(store.indexed[0]?.cursor.offset).toBe(Buffer.byteLength(whole, 'utf8'));
  });

  it('indexes the partial record only once it is whole', async () => {
    const { indexer, store, files } = build();
    const whole = `${line('hello')}\n`;
    files.holds(`${whole}${line('the rest').slice(0, 30)}`);
    await indexer.index();

    files.holds(`${whole + line('the rest')}\n`);
    await indexer.index();

    expect(store.indexed.flatMap((batch) => batch.excerpts.map((prose) => prose.text))).toEqual([
      'hello',
      'the rest',
    ]);
  });

  // A file made only of one unterminated line has nothing whole in it yet. Advancing at all would
  // step into the middle of the record it is about to be handed.
  it('does not move at all when nothing in the slice is a whole record', async () => {
    const { indexer, store, files } = build();
    files.holds('{"type":"user","message":{"content":"still writing');

    await indexer.index();

    expect(store.indexed[0]?.cursor.offset).toBe(0);
    expect(store.indexed[0]?.excerpts).toEqual([]);
  });

  // The offset is bytes and the slice is characters. A multi-byte character before the last
  // newline would shift the cursor by the difference, and the next read would start mid-record.
  it('counts bytes, not characters, when the file is not ASCII', async () => {
    const { indexer, store, files } = build();
    const whole = `${line('Grüße aus München — ändern')}\n`;
    files.holds(whole);

    await indexer.index();

    expect(store.indexed[0]?.cursor.offset).toBe(Buffer.byteLength(whole, 'utf8'));
    expect(Buffer.byteLength(whole, 'utf8')).toBeGreaterThan(whole.length);
  });

  /**
   * The same arithmetic, but in the half that actually varies.
   *
   * The cursor is `slice.to` minus the trailing fragment's length, so it is the FRAGMENT that has
   * to be measured in bytes. A file whose whole records are ASCII and whose half-written last line
   * has an umlaut in it is the case where characters and bytes disagree — and the file above,
   * which ends on a newline, has no fragment at all and cannot tell them apart.
   */
  it('measures the trailing fragment in bytes too', async () => {
    const { indexer, store, files } = build();
    const whole = `${line('hello')}\n`;
    files.holds(`${whole}{"type":"user","message":{"content":"Grüße aus München — ändern`);

    await indexer.index();

    expect(store.indexed[0]?.cursor.offset).toBe(Buffer.byteLength(whole, 'utf8'));
  });
});

/**
 * A line longer than one read — the 3.2 MB single line on this machine (P7-T3 found it).
 *
 * Every slice that begins inside it also ends inside it, so "stop at the last newline" never
 * moves: the cursor sat on the line's first byte for good and nothing after it was ever indexed.
 * A line that long is past `MAX_LINE_CHARS` and would not have been parsed anyway, so the cursor
 * steps over it — the spend ledger's rule, now the indexer's too.
 */
describe('TranscriptIndexer — a line longer than one read', () => {
  const READ = 200_000;
  const huge = `{"type":"user","message":{"content":"${'x'.repeat(3 * READ)}"}}`;

  it('steps over it rather than pinning the cursor to its first byte', async () => {
    const { indexer, store, files } = build();
    files.readsAtMost(READ);
    files.holds(`${huge}
${line('after the paste')}
`);

    for (let pass = 0; pass < 5; pass += 1) await indexer.index();

    expect(store.indexed.flatMap((batch) => batch.excerpts.map((prose) => prose.text))).toEqual([
      'after the paste',
    ]);
  });

  it('still waits on a partial line short enough to be a record', async () => {
    const { indexer, store, files } = build();
    const whole = `${line('hello')}
`;
    files.holds(`${whole}${line('the rest').slice(0, 30)}`);

    await indexer.index();

    expect(store.indexed[0]?.cursor.offset).toBe(Buffer.byteLength(whole, 'utf8'));
  });
});

describe('TranscriptIndexer — a transcript that was replaced', () => {
  // `--bg --resume` writes a fresh transcript at a path already indexed. Everything held from the
  // old one describes a conversation that is not there any more.
  it('tells the store to drop what it held, and re-reads from zero', async () => {
    const { indexer, store, files } = build();
    files.holds(`${line('the old session')}\n`);
    await indexer.index();

    files.replacedWith(`${line('the new session')}\n`, 'dev:2:2027');
    await indexer.index();

    expect(store.indexed[1]).toMatchObject({ restarted: true });
    expect(store.indexed[1]?.excerpts.map((prose) => prose.text)).toEqual(['the new session']);
  });
});
