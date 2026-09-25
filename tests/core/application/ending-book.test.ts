// How each background session ended, read off `daemon.log` for the rows — D62.
//
// The book is the reconciler's half of the log. What is pinned here is that it names an ending
// only for a row that has one, never hands a new stop an old run's ending, and costs a read only
// when a row needs one — the last because it runs inside a sweep every ten seconds.
import { describe, expect, it } from 'vitest';
import type { SessionRow } from '../../../contracts/session-row.ts';
import { EndingBook, MAX_LOOKUPS } from '../../../core/application/ending-book.ts';
import { FakeDaemonLogSource, logLine } from '../../fakes/fake-daemon-log-source.ts';

const SHORT = '57218c6e';

function rowOf(over: Partial<SessionRow> = {}): SessionRow {
  return {
    sessionId: `${SHORT}-1a2b-4c3d-8e4f-5a6b7c8d9e0f`,
    shortId: SHORT,
    subscription: 'isg',
    kind: 'background',
    name: 'spike-c',
    cwd: 'C:\\repo',
    startedAt: 1,
    live: false,
    runState: 'blocked',
    status: undefined,
    attachable: false,
    notAttachableBecause: undefined,
    endReason: 'unknown',
    retireReason: undefined,
    ...over,
  };
}

const RUNNING = rowOf({ live: true, runState: 'working', attachable: true });

/** F.2.15's `fd-spike-c`: a retirement while blocked, then its settle 1.1 s later. */
function retiredWaiting(at: number): string {
  return [
    logLine(at, 'bg', `bg retire ${SHORT}: idle-prompt, idle 60m`),
    logLine(at + 1100, 'bg', `bg settled ${SHORT} (done)`),
  ].join('\n');
}

describe('EndingBook — naming the ending', () => {
  it('puts the log’s ending on a stopped background row', async () => {
    const log = new FakeDaemonLogSource().willReturn('isg', retiredWaiting(5_000));
    const book = new EndingBook(log);

    await book.learn([rowOf()], 10_000);

    expect(book.explain(rowOf())).toMatchObject({
      endReason: 'retired',
      retireReason: 'idle-prompt',
    });
  });

  it('names a stop and a finish too, not only retirements', async () => {
    const log = new FakeDaemonLogSource().willReturn(
      'isg',
      [
        logLine(1, 'bg', `bg settled ${SHORT} (killed)`),
        logLine(2, 'bg', 'bg settled aaaa0001 (done)'),
      ].join('\n'),
    );
    const book = new EndingBook(log);
    const other = rowOf({ sessionId: 'aaaa0001-0000', shortId: 'aaaa0001', runState: 'done' });

    await book.learn([rowOf({ runState: 'done' }), other], 10);

    expect(book.explain(rowOf({ runState: 'done' })).endReason).toBe('stopped');
    expect(book.explain(other).endReason).toBe('finished');
  });

  it('explains a stopped session the listing gave no state at all', async () => {
    const log = new FakeDaemonLogSource().willReturn(
      'isg',
      logLine(1, 'bg', `bg settled ${SHORT} (killed)`),
    );
    const book = new EndingBook(log);
    const stateless = rowOf({ runState: undefined });

    await book.learn([stateless], 10);

    expect(book.explain(stateless).endReason).toBe('stopped');
  });

  it('leaves a row the log says nothing about as unknown', async () => {
    const book = new EndingBook(new FakeDaemonLogSource().willReturn('isg', ''));

    await book.learn([rowOf()], 10);

    expect(book.explain(rowOf())).toEqual(rowOf());
  });

  // Every one of these could have an ending in the log and none of them should wear it.
  it.each([
    ['a running session', RUNNING],
    ['an interactive session', rowOf({ kind: 'interactive', runState: undefined })],
    ['a session a moment from starting (G.2)', rowOf({ runState: 'working' })],
    ['a failed session, whose failure outranks the log', rowOf({ runState: 'failed' })],
  ])('never explains %s', async (unused, row) => {
    const log = new FakeDaemonLogSource().willReturn('isg', retiredWaiting(5_000));
    const book = new EndingBook(log);

    await book.learn([rowOf()], 10_000);

    expect(book.explain(row)).toEqual(row);
  });

  it('keeps the other subscription’s ending apart — a session id is unique per config dir', async () => {
    const log = new FakeDaemonLogSource().willReturn('isg', retiredWaiting(5_000));
    const book = new EndingBook(log);
    const elsewhere = rowOf({ subscription: '365' });

    await book.learn([elsewhere], 10_000);

    expect(book.explain(elsewhere).endReason).toBe('unknown');
    expect(log.reads).toEqual(['365']);
  });

  it('drops a retirement word the vocabulary does not know, and keeps "retired"', async () => {
    const log = new FakeDaemonLogSource().willReturn(
      'isg',
      [
        logLine(1, 'bg', `bg retire ${SHORT}: low-battery, idle 5m`),
        logLine(2, 'bg', `bg settled ${SHORT} (done)`),
      ].join('\n'),
    );
    const book = new EndingBook(log);

    await book.learn([rowOf()], 10);

    expect(book.explain(rowOf())).toMatchObject({ endReason: 'retired', retireReason: undefined });
  });
});

describe('EndingBook — the run an ending belongs to', () => {
  // A respawn keeps the id, so the log holds the LAST run's ending until this one's is written.
  it('does not hand a new stop the ending of the run before it', async () => {
    const log = new FakeDaemonLogSource().willReturn('isg', retiredWaiting(5_000));
    const book = new EndingBook(log);

    await book.learn([RUNNING], 20_000);
    await book.learn([rowOf()], 30_000);

    expect(book.explain(rowOf()).endReason).toBe('unknown');
  });

  it('names the new ending once it is written', async () => {
    const log = new FakeDaemonLogSource().willReturn('isg', retiredWaiting(5_000));
    const book = new EndingBook(log);
    await book.learn([rowOf()], 10_000);

    await book.learn([RUNNING], 20_000);
    log.willReturn(
      'isg',
      `${retiredWaiting(5_000)}\n${logLine(25_000, 'bg', `bg settled ${SHORT} (killed)`)}`,
    );
    await book.learn([rowOf()], 30_000);

    expect(book.explain(rowOf())).toMatchObject({ endReason: 'stopped', retireReason: undefined });
  });

  it('forgets a session that left the listing', async () => {
    const log = new FakeDaemonLogSource().willReturn('isg', retiredWaiting(5_000));
    const book = new EndingBook(log);
    await book.learn([rowOf()], 10_000);

    book.forget(rowOf());

    expect(book.explain(rowOf()).endReason).toBe('unknown');
  });
});

describe('EndingBook — what it costs', () => {
  it('reads nothing when no row needs explaining', async () => {
    const log = new FakeDaemonLogSource();
    const book = new EndingBook(log);

    await book.learn([RUNNING, rowOf({ kind: 'interactive', runState: undefined })], 10);

    expect(log.reads).toEqual([]);
  });

  it('reads once per subscription however many rows need it, and not again once it knows', async () => {
    const log = new FakeDaemonLogSource().willReturn('isg', retiredWaiting(5_000));
    const book = new EndingBook(log);
    const second = rowOf({ sessionId: 'bbbb0002-0000', shortId: 'bbbb0002' });

    await book.learn([rowOf(), second], 10_000);
    expect(log.reads).toEqual(['isg']);

    await book.learn([rowOf()], 20_000);
    expect(log.reads).toEqual(['isg']);
  });

  // `--all` lists a background session forever; one whose ending scrolled out of the window must
  // not cost a read every ten seconds for the rest of the machine's life.
  it(`gives up on an ending it cannot find after ${String(MAX_LOOKUPS)} sweeps`, async () => {
    const log = new FakeDaemonLogSource();
    const book = new EndingBook(log);

    for (let sweep = 0; sweep < MAX_LOOKUPS + 3; sweep += 1) await book.learn([rowOf()], sweep);

    expect(log.reads).toHaveLength(MAX_LOOKUPS);
  });

  it('looks again once the session has run and stopped again', async () => {
    const log = new FakeDaemonLogSource();
    const book = new EndingBook(log);
    for (let sweep = 0; sweep < MAX_LOOKUPS; sweep += 1) await book.learn([rowOf()], sweep);

    await book.learn([RUNNING], 100);
    await book.learn([rowOf()], 200);

    expect(log.reads).toHaveLength(MAX_LOOKUPS + 1);
  });

  it('reads nothing at all when it was built without a log', async () => {
    const book = new EndingBook();

    await book.learn([rowOf()], 10);

    expect(book.explain(rowOf())).toEqual(rowOf());
  });
});
