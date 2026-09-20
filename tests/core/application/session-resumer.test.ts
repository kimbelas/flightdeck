// Waking a stopped background session — P4-T2a.
//
// **Every argv assertion here is RESEARCH.md F.2.7 rather than style.** `--bg --resume <full-uuid>`
// wakes the session under its own id; a short id, or any extra flag, silently forks a copy under a
// new id and loses the name. There is no error to observe when that happens — the command succeeds
// — so the tests that pin the exact argv are the only thing standing between a resume and a
// duplicate session the owner has to go and find.
import { describe, expect, it } from 'vitest';
import { ClaudeInstall } from '../../../core/adapters/claude-cli/claude-install.ts';
import { AuditLog } from '../../../core/application/audit-log.ts';
import { SessionResumer } from '../../../core/application/session-resumer.ts';
import { FakeClock } from '../../fakes/fake-clock.ts';
import { FakeLogger } from '../../fakes/fake-logger.ts';
import { FakeProcessRunner } from '../../fakes/fake-process-runner.ts';
import { FakeStore } from '../../fakes/fake-store.ts';

const ID = 'cfe7facb-a785-42e4-b1b3-600138ad1c70';

function build(
  runner: FakeProcessRunner,
  executable: string | undefined = 'C:\\claude.exe',
): { resumer: SessionResumer; store: FakeStore } {
  const store = new FakeStore();
  const audit = new AuditLog(store, new FakeClock(), new FakeLogger());
  const resumer = new SessionResumer({
    install: new ClaudeInstall('C:\\home', executable),
    runner,
    audit,
    logger: new FakeLogger(),
  });
  return { resumer, store };
}

describe('SessionResumer', () => {
  it('runs `--bg --resume <id>` and NOTHING else — F.2.7', async () => {
    const runner = new FakeProcessRunner();
    const { resumer } = build(runner);

    await resumer.resume({ subscription: '365', sessionId: ID });

    // Exactly three elements. A fourth of any kind forks a copy of the session.
    expect(runner.requests[0]?.args).toEqual(['--bg', '--resume', ID]);
  });

  it('answers the id it was given, never one parsed back out of stdout', async () => {
    const runner = new FakeProcessRunner();
    // A correct resume keeps the id; anything else in the output describes a fork we did not make.
    runner.willReturn({ stdout: 'woke session cfe7facb with its saved options (-n, --model)\n' });

    const resumed = await build(runner).resumer.resume({ subscription: '365', sessionId: ID });

    expect(resumed).toEqual({ ok: true, value: ID });
  });

  it('runs against the subscription its request named', async () => {
    const runner = new FakeProcessRunner();
    const { resumer } = build(runner);

    await resumer.resume({ subscription: 'isg', sessionId: ID });

    expect(runner.requests[0]?.env['CLAUDE_CONFIG_DIR']).toContain('isg');
  });

  it('refuses a short id rather than letting the CLI fork a copy of the session', async () => {
    const runner = new FakeProcessRunner();
    const { resumer } = build(runner);

    const resumed = await resumer.resume({ subscription: '365', sessionId: 'cfe7facb' });

    expect(resumed).toEqual({ ok: false, error: 'bad_session' });
    // The point of the refusal: nothing ran, so nothing was forked.
    expect(runner.requests).toEqual([]);
  });

  it('refuses an upper-case uuid, which is not the id the CLI knows', async () => {
    const runner = new FakeProcessRunner();

    const resumed = await build(runner).resumer.resume({
      subscription: '365',
      sessionId: ID.toUpperCase(),
    });

    expect(resumed).toEqual({ ok: false, error: 'bad_session' });
    expect(runner.requests).toEqual([]);
  });

  it('refuses when claude.exe was never found, without running anything', async () => {
    const runner = new FakeProcessRunner();

    const resumed = await build(runner, '').resumer.resume({
      subscription: '365',
      sessionId: ID,
    });

    expect(resumed).toEqual({ ok: false, error: 'no_claude' });
    expect(runner.requests).toEqual([]);
  });

  it('reports a non-zero exit as a failed resume', async () => {
    const runner = new FakeProcessRunner();
    runner.willReturn({ code: 1, stdout: 'No job matching\n' });

    const resumed = await build(runner).resumer.resume({ subscription: '365', sessionId: ID });

    expect(resumed).toEqual({ ok: false, error: 'resume_failed' });
  });

  it('reports a timeout as a failed resume rather than hanging on it', async () => {
    const runner = new FakeProcessRunner();
    runner.willReturn({ timedOut: true });

    const resumed = await build(runner).resumer.resume({ subscription: '365', sessionId: ID });

    expect(resumed).toEqual({ ok: false, error: 'resume_failed' });
  });
});

describe('the audit row, which is SEC-PROC-3', () => {
  it('records one row naming the session, on the way out of a success', async () => {
    const runner = new FakeProcessRunner();
    const { resumer, store } = build(runner);

    await resumer.resume({ subscription: '365', sessionId: ID });

    expect(store.allAudit).toHaveLength(1);
    expect(store.allAudit[0]).toMatchObject({
      action: 'resume',
      target: ID,
      args: ['--bg', '--resume'],
      outcome: 'ok',
    });
  });

  it('records the refusals too, which are the rows a reviewer looks for', async () => {
    const runner = new FakeProcessRunner();
    const { resumer, store } = build(runner);

    await resumer.resume({ subscription: '365', sessionId: 'nope' });

    expect(store.allAudit).toHaveLength(1);
    expect(store.allAudit[0]).toMatchObject({ action: 'resume', outcome: 'refused' });
    expect(store.allAudit[0]?.reason).toContain('uuid');
  });

  it('records a failure with the exit code that caused it', async () => {
    const runner = new FakeProcessRunner();
    runner.willReturn({ code: 1 });
    const { resumer, store } = build(runner);

    await resumer.resume({ subscription: '365', sessionId: ID });

    expect(store.allAudit[0]).toMatchObject({ outcome: 'failed', reason: 'exit 1' });
  });
});
