// Stopping a running background session — P4-T2b.
//
// The argv assertion is RESEARCH.md F.2.8b: `stop` takes the SHORT id and refuses the full uuid,
// the exact mirror of `--resume`. Sending the wrong form here fails loudly rather than silently, so
// unlike the resumer's test this one is guarding correctness rather than a fork — but it is the
// same measurement, read from the other end.
import { describe, expect, it } from 'vitest';
import { ClaudeInstall } from '../../../core/adapters/claude-cli/claude-install.ts';
import { AuditLog } from '../../../core/application/audit-log.ts';
import { SessionStopper } from '../../../core/application/session-stopper.ts';
import type { SessionRef } from '../../../contracts/session-ref.ts';
import { FakeClock } from '../../fakes/fake-clock.ts';
import { FakeLogger } from '../../fakes/fake-logger.ts';
import { FakeProcessRunner } from '../../fakes/fake-process-runner.ts';
import { FakeStore } from '../../fakes/fake-store.ts';

const REF: SessionRef = {
  sessionId: 'cfe7facb-a785-4b2d-4b1b-600138ad1c70',
  shortId: 'cfe7facb',
  subscription: '365',
};

function build(
  runner: FakeProcessRunner,
  executable = 'C:\\claude.exe',
): { stopper: SessionStopper; store: FakeStore } {
  const store = new FakeStore();
  const stopper = new SessionStopper({
    install: new ClaudeInstall('C:\\home', executable),
    runner,
    audit: new AuditLog(store, new FakeClock(), new FakeLogger()),
    logger: new FakeLogger(),
  });
  return { stopper, store };
}

describe('SessionStopper', () => {
  it('runs `stop <shortId>` — the SHORT id, which is what the CLI takes (F.2.8b)', async () => {
    const runner = new FakeProcessRunner();

    await build(runner).stopper.stop(REF);

    expect(runner.requests[0]?.args).toEqual(['stop', 'cfe7facb']);
  });

  it('never puts the full uuid on the command line, which the CLI refuses', async () => {
    const runner = new FakeProcessRunner();

    await build(runner).stopper.stop(REF);

    expect(runner.requests[0]?.args).not.toContain(REF.sessionId);
  });

  it('answers the FULL id, so the deck can find the row again', async () => {
    const stopped = await build(new FakeProcessRunner()).stopper.stop(REF);

    expect(stopped).toEqual({ ok: true, value: REF.sessionId });
  });

  it('runs against the subscription the ref named', async () => {
    const runner = new FakeProcessRunner();

    await build(runner).stopper.stop({ ...REF, subscription: 'isg' });

    expect(runner.requests[0]?.env['CLAUDE_CONFIG_DIR']).toContain('isg');
  });

  it('refuses when claude.exe was never found, without running anything', async () => {
    const runner = new FakeProcessRunner();

    const stopped = await build(runner, '').stopper.stop(REF);

    expect(stopped).toEqual({ ok: false, error: 'no_claude' });
    expect(runner.requests).toEqual([]);
  });

  it.each([
    { why: 'a non-zero exit — what a missing id gives (F.2.8)', result: { code: 1 } },
    { why: 'a timeout', result: { timedOut: true } },
  ])('reports $why as a failed stop', async ({ result }) => {
    const runner = new FakeProcessRunner();
    runner.willReturn(result);

    expect(await build(runner).stopper.stop(REF)).toEqual({ ok: false, error: 'stop_failed' });
  });
});

describe('the audit row', () => {
  it('names the FULL id, because that is what the session list is keyed by', async () => {
    const { stopper, store } = build(new FakeProcessRunner());

    await stopper.stop(REF);

    expect(store.allAudit[0]).toMatchObject({
      action: 'stop',
      target: REF.sessionId,
      outcome: 'ok',
    });
  });

  it('records the refusal too', async () => {
    const { stopper, store } = build(new FakeProcessRunner(), '');

    await stopper.stop(REF);

    expect(store.allAudit[0]).toMatchObject({ action: 'stop', outcome: 'refused' });
  });
});
