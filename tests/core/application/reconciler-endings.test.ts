// The sweep names a background session's ending from `daemon.log` — D62.
//
// `EndingBook` decides which ending belongs to which row (ending-book.test.ts). What is pinned
// here is the reconciler's half: the frame that says a session stopped already says why, so the
// toast reading it says the right word the first time; a reason learned a sweep late is itself a
// `changed`; and `GET /sessions`' fresh sweep reads the same book rather than forgetting it.
import { describe, expect, it } from 'vitest';
import { parseSessionRow, type SessionRow } from '../../../contracts/session-row.ts';
import { DeckQuery } from '../../../core/application/deck-query.ts';
import { FakeDaemonLogSource, logLine } from '../../fakes/fake-daemon-log-source.ts';
import { FakeSessionSource } from '../../fakes/fake-session-source.ts';
import { FakeClock } from '../../fakes/fake-clock.ts';
import { rig, session, typesOf } from './reconciler-harness.ts';

const ID = '57218c6e';

function retirement(at: number): string {
  return [
    logLine(at, 'bg', `bg retire ${ID}: idle-prompt, idle 60m`),
    logLine(at + 1100, 'bg', `bg settled ${ID} (done)`),
  ].join('\n');
}

describe('Reconciler — endings from daemon.log', () => {
  it('publishes one change for a retirement, and it already carries the reason', async () => {
    const log = new FakeDaemonLogSource();
    const { reconciler, source, sink, clock } = rig(log);
    source.willReturn('isg', [session({ id: ID, runState: 'blocked' }, 'isg')]);
    await reconciler.reconcile();

    clock.advance(60_000);
    log.willReturn('isg', retirement(clock.now().getTime() - 5_000));
    source.willReturn('isg', [session({ id: ID, runState: 'blocked', live: false }, 'isg')]);
    await reconciler.reconcile();

    expect(typesOf(sink)).toEqual(['seen', 'changed']);
    expect(parseSessionRow(sink.last?.payload)).toMatchObject({
      live: false,
      endReason: 'retired',
      retireReason: 'idle-prompt',
    });
  });

  it('publishes the reason as a change of its own when the log catches up a sweep late', async () => {
    const log = new FakeDaemonLogSource();
    const { reconciler, source, sink, clock } = rig(log);
    source.willReturn('isg', [session({ id: ID, runState: 'working' }, 'isg')]);
    await reconciler.reconcile();

    clock.advance(10_000);
    source.willReturn('isg', [session({ id: ID, runState: 'done', live: false }, 'isg')]);
    await reconciler.reconcile();
    log.willReturn('isg', logLine(clock.now().getTime() + 1, 'bg', `bg settled ${ID} (killed)`));
    await reconciler.reconcile();

    expect(typesOf(sink)).toEqual(['seen', 'changed', 'changed']);
    expect(parseSessionRow(sink.last?.payload)?.endReason).toBe('stopped');
  });

  it('reads no log on a sweep where every background session is running', async () => {
    const log = new FakeDaemonLogSource();
    const { reconciler, source } = rig(log);
    source.willReturn('365', [session({ id: 'aaaaaaaa' }, '365')]);
    source.willReturn('isg', [session({ id: ID, kind: 'interactive', live: false }, 'isg')]);

    await reconciler.reconcile();
    await reconciler.reconcile();

    expect(log.reads).toEqual([]);
  });

  // Trap 1 again: a failed sweep is not evidence of anything, including of a session stopping.
  it('asks nothing of the log for a subscription whose sweep failed', async () => {
    const log = new FakeDaemonLogSource();
    const { reconciler, source } = rig(log);
    source.willFail('isg');

    await reconciler.reconcile();

    expect(log.reads).toEqual([]);
  });

  it('forgets the ending of a session that is deleted', async () => {
    const log = new FakeDaemonLogSource().willReturn('isg', retirement(1));
    const { reconciler, source } = rig(log);
    source.willReturn('isg', [session({ id: ID, runState: 'blocked', live: false }, 'isg')]);
    await reconciler.reconcile();
    const row = reconciler.sessions[0];
    expect(row).toBeDefined();
    if (row === undefined) return;

    source.willReturn('isg', []);
    await reconciler.reconcile();
    await reconciler.reconcile();

    expect(reconciler.sessions).toEqual([]);
    expect(row.endReason).toBe('retired');
    const asSwept: SessionRow = { ...row, endReason: 'unknown', retireReason: undefined };
    expect(reconciler.explain(asSwept).endReason).toBe('unknown');
  });

  // `GET /sessions` sweeps afresh, and a fresh sweep says `done` and nothing more. Without the
  // book a refresh would turn "retired while waiting for you" back into "blocked".
  it('lends the same ending to the deck’s own fresh sweep', async () => {
    const log = new FakeDaemonLogSource().willReturn('isg', retirement(1));
    const { reconciler, source } = rig(log);
    const retired = session({ id: ID, runState: 'blocked', live: false }, 'isg');
    source.willReturn('isg', [retired]);
    await reconciler.reconcile();

    const fresh = new FakeSessionSource();
    fresh.willReturn('isg', [retired]);
    const snapshot = await new DeckQuery(fresh, new FakeClock(), reconciler).snapshot();

    expect(snapshot.rows[0]).toMatchObject({ endReason: 'retired', retireReason: 'idle-prompt' });
  });
});
