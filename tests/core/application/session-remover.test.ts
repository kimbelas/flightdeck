// Deleting a background session — P4-T2, the most destructive verb Flightdeck exposes.
//
// The id form is the case worth more than the rest, and it is measured rather than assumed
// (RESEARCH.md F.8.4): `rm` takes the SHORT id and answers `No job matching '<uuid>'` for the full
// one. That is the same way round as `stop` and the OPPOSITE of `--resume`, which forks silently
// on a short id — so a "tidy-up" that gave the three verbs one id helper would break two of them,
// one of them quietly.
import { describe, expect, it } from 'vitest';
import { ClaudeInstall } from '../../../core/adapters/claude-cli/claude-install.ts';
import { AuditLog } from '../../../core/application/audit-log.ts';
import { SessionRemover } from '../../../core/application/session-remover.ts';
import type { SessionRef } from '../../../contracts/session-ref.ts';
import { FakeClock } from '../../fakes/fake-clock.ts';
import { FakeLogger } from '../../fakes/fake-logger.ts';
import { FakeProcessRunner } from '../../fakes/fake-process-runner.ts';
import { FakeStore } from '../../fakes/fake-store.ts';

const REF: SessionRef = {
  sessionId: 'fe534daf-100b-4797-a59f-ca0714840328',
  shortId: 'fe534daf',
  subscription: '365',
};

function build(
  runner: FakeProcessRunner,
  executable = 'C:\\claude.exe',
): { remover: SessionRemover; store: FakeStore } {
  const store = new FakeStore();
  const audit = new AuditLog(store, new FakeClock(), new FakeLogger());
  const remover = new SessionRemover({
    install: new ClaudeInstall('C:\\home', executable),
    runner,
    audit,
    logger: new FakeLogger(),
  });
  return { remover, store };
}

describe('SessionRemover', () => {
  it('answers the full id, so the deck can find the row it just deleted', async () => {
    const runner = new FakeProcessRunner();
    runner.willReturn({ stdout: 'removed fe534daf' });

    const removed = await build(runner).remover.remove(REF);

    expect(removed).toEqual({ ok: true, value: REF.sessionId });
  });

  it('puts the SHORT id on the command line, which is the form `rm` takes (F.8.4)', async () => {
    const runner = new FakeProcessRunner();
    runner.willReturn({ stdout: 'removed fe534daf' });

    await build(runner).remover.remove(REF);

    expect(runner.requests[0]?.args).toEqual(['rm', 'fe534daf']);
    // The full uuid gets `No job matching '<uuid>'` and exit 1 — the loud half of F.8.4.
    expect(runner.requests[0]?.args.join(' ')).not.toContain(REF.sessionId);
  });

  it('takes the short id from the ref rather than slicing it off the uuid', async () => {
    // That equality is an observation about how Claude Code names job directories today (F.7.1),
    // and contracts/session-ref.ts refuses to let the deck guess at it. A remover that sliced
    // would be guessing at a directory name for the one verb that deletes one.
    const runner = new FakeProcessRunner();
    runner.willReturn({ stdout: 'removed 00000000' });

    await build(runner).remover.remove({ ...REF, shortId: '00000000' });

    expect(runner.requests[0]?.args).toEqual(['rm', '00000000']);
  });

  it('deletes under the ref’s own config directory', async () => {
    const runner = new FakeProcessRunner();
    runner.willReturn({ stdout: 'removed fe534daf' });

    await build(runner).remover.remove({ ...REF, subscription: 'isg' });

    expect(runner.requests[0]?.env['CLAUDE_CONFIG_DIR']).toContain('.claude-isg');
  });

  it('refuses when Claude is not installed, without spawning', async () => {
    const runner = new FakeProcessRunner();

    const removed = await build(runner, '').remover.remove(REF);

    expect(removed).toEqual({ ok: false, error: 'no_claude' });
    expect(runner.requests).toHaveLength(0);
  });

  it.each([
    { why: 'a non-zero exit', result: { code: 1, stdout: "No job matching 'fe534daf'" } },
    { why: 'a timeout', result: { timedOut: true, stdout: '' } },
  ])('reports remove_failed on $why', async ({ result }) => {
    const runner = new FakeProcessRunner();
    runner.willReturn(result);

    const removed = await build(runner).remover.remove(REF);

    expect(removed).toEqual({ ok: false, error: 'remove_failed' });
  });
});

describe('SessionRemover — the audit row (SEC-PROC-3)', () => {
  it('writes one ok row naming the session by its FULL id', async () => {
    // The audit table is read against `/sessions`, which keys by the full id.
    const runner = new FakeProcessRunner();
    runner.willReturn({ stdout: 'removed fe534daf' });
    const { remover, store } = build(runner);

    await remover.remove(REF);

    expect(store.allAudit).toHaveLength(1);
    expect(store.allAudit[0]?.action).toBe('rm');
    expect(store.allAudit[0]?.target).toBe(REF.sessionId);
    expect(store.allAudit[0]?.outcome).toBe('ok');
  });

  it('writes a row for every path out, including the refusal', async () => {
    // This is the only verb whose row is the ONLY record that Flightdeck did it: `daemon.log`
    // cannot tell a deletion from a session that ended on its own (F.2.3).
    const runner = new FakeProcessRunner();
    const { remover, store } = build(runner, '');

    await remover.remove(REF);

    expect(store.auditFailures()).toHaveLength(1);
    expect(store.allAudit[0]?.outcome).toBe('refused');
  });

  it('writes a failed row carrying why', async () => {
    const runner = new FakeProcessRunner();
    runner.willReturn({ code: 1, stdout: '' });
    const { remover, store } = build(runner);

    await remover.remove(REF);

    expect(store.allAudit[0]?.outcome).toBe('failed');
    expect(store.allAudit[0]?.reason).toContain('exit 1');
  });
});
