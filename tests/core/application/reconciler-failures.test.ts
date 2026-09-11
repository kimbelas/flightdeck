// What must not be able to take core down — P1-T5's G.10, kept apart from the behaviour tests.
//
// Its own file because it is a different question. reconciler.test.ts asks what the reconciler
// says; this asks whether it survives being lied to by the thing underneath it. The answer used to
// be no: a source that REJECTED rather than reporting a failed sweep became an unhandled rejection
// and an exited process, with every interactive session wearing a hook error banner until someone
// noticed (RESEARCH.md G.10, F.1.5).
import { describe, expect, it } from 'vitest';
import { rig, session } from './reconciler-harness.ts';

describe('Reconciler — a source that rejects (RESEARCH.md G.10)', () => {
  it('does not let a rejected sweep escape reconcile', async () => {
    // This is what killed core: the rejection became an unhandled one, and `void this.reconcile()`
    // on a 10 s timer had nowhere to put it.
    const { reconciler, source } = rig();
    source.willReject('365');

    await expect(reconciler.reconcile()).resolves.toBeUndefined();
  });

  it('keeps what it already knew rather than retiring everything', async () => {
    const { reconciler, source } = rig();
    source.willReturn('365', [session({ id: 'aaaaaaaa' }, '365')]);
    await reconciler.reconcile();

    source.willReject('365');
    await reconciler.reconcile();

    expect(reconciler.snapshot().rows).toHaveLength(1);
  });

  it('says so at error level, because a source that throws is not an ordinary failed sweep', async () => {
    const { reconciler, source, logger } = rig();
    source.willReject('isg');

    await reconciler.reconcile();

    expect(logger.logged('reconcile_failed')).toBe(true);
  });
});
