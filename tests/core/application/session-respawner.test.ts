// `SessionRespawner` — P4-T5, and the measurement that shapes it is `--all` not meaning all.
//
// F.10.4: with two background sessions present, one `blocked` and one `done`, `respawn --all`
// printed `respawned d1b2f43c` and left the other alone — while respawning that same session BY
// NAME worked. So a deck that reported "all sessions respawned" would be reporting something the
// CLI did not do. The reply carries the ids the output named, and nothing is inferred from the
// request.
import { describe, expect, it } from 'vitest';
import { ClaudeInstall } from '../../../core/adapters/claude-cli/claude-install.ts';
import { AuditLog } from '../../../core/application/audit-log.ts';
import { SessionRespawner } from '../../../core/application/session-respawner.ts';
import type { SessionRef } from '../../../contracts/session-ref.ts';
import { FakeClock } from '../../fakes/fake-clock.ts';
import { FakeLogger } from '../../fakes/fake-logger.ts';
import { FakeProcessRunner } from '../../fakes/fake-process-runner.ts';
import { FakeStore } from '../../fakes/fake-store.ts';

const REF: SessionRef = {
  sessionId: '26b03f93-100b-4797-a59f-ca0714840328',
  shortId: '26b03f93',
  subscription: '365',
};

interface Harness {
  readonly respawner: SessionRespawner;
  readonly runner: FakeProcessRunner;
  readonly store: FakeStore;
}

function harness(executable = 'C:\\claude.exe'): Harness {
  const runner = new FakeProcessRunner();
  const store = new FakeStore();
  return {
    respawner: new SessionRespawner({
      install: new ClaudeInstall('C:\\home', executable),
      runner,
      audit: new AuditLog(store, new FakeClock(), new FakeLogger()),
      logger: new FakeLogger(),
    }),
    runner,
    store,
  };
}

describe('SessionRespawner — one session', () => {
  it('passes the SHORT id, which is the form the CLI takes (F.10.3)', async () => {
    // Measured: `respawn <uuid>` answers `No job matching` and exits 1. Three of the four verbs
    // now agree on the short id; `--resume` is the odd one and forks silently on it.
    const { respawner, runner } = harness();
    runner.willReturn({ code: 0, stdout: 'respawned 26b03f93\n', stderr: '', timedOut: false });

    await respawner.one(REF);

    expect(runner.requests[0]?.args).toEqual(['respawn', '26b03f93']);
    expect(runner.requests[0]?.args).not.toContain(REF.sessionId);
  });

  it('answers the ids the CLI said it respawned', async () => {
    const { respawner, runner } = harness();
    runner.willReturn({ code: 0, stdout: 'respawned 26b03f93\n', stderr: '', timedOut: false });

    const result = await respawner.one(REF);

    expect(result.ok).toBe(true);
    expect(result.ok ? result.value.respawned : []).toEqual(['26b03f93']);
  });

  it('reports a non-zero exit as a refusal rather than a success', async () => {
    const { respawner, runner } = harness();
    runner.willReturn({ code: 1, stdout: "No job matching 'x'\n", stderr: '', timedOut: false });

    const result = await respawner.one(REF);

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.error).toBe('respawn_failed');
  });

  it('refuses without spawning when there is no binary', async () => {
    const { respawner, runner } = harness('');

    const result = await respawner.one(REF);

    expect(result.ok ? '' : result.error).toBe('no_claude');
    expect(runner.requests).toHaveLength(0);
  });
});

describe('SessionRespawner — `--all` does not mean all (F.10.4)', () => {
  it('answers only the ids the output named, not one per session that exists', async () => {
    // The measurement: two background sessions, one restarted, one skipped because it had
    // finished. A count taken from the request would have said two.
    const { respawner, runner } = harness();
    runner.willReturn({ code: 0, stdout: 'respawned d1b2f43c\n', stderr: '', timedOut: false });

    const result = await respawner.all('365');

    expect(runner.requests[0]?.args).toEqual(['respawn', '--all']);
    expect(result.ok ? result.value.respawned : []).toEqual(['d1b2f43c']);
  });

  it('answers an EMPTY list when the CLI restarted nothing, rather than claiming success', async () => {
    // The honest shape of "there was nothing to restart". A deck that showed "respawned" here
    // would be telling the owner their sessions picked up a new binary when none did.
    const { respawner, runner } = harness();
    runner.willReturn({ code: 0, stdout: '', stderr: '', timedOut: false });

    const result = await respawner.all('365');

    expect(result.ok).toBe(true);
    expect(result.ok ? result.value.respawned : ['x']).toEqual([]);
  });

  it('reads several ids when several were restarted', async () => {
    const { respawner, runner } = harness();
    runner.willReturn({
      code: 0,
      stdout: 'respawned d1b2f43c\nrespawned 26b03f93\n',
      stderr: '',
      timedOut: false,
    });

    const result = await respawner.all('365');

    expect(result.ok ? result.value.respawned : []).toEqual(['d1b2f43c', '26b03f93']);
  });

  it('ignores a line that is not a respawn, so a banner cannot inflate the count', async () => {
    const { respawner, runner } = harness();
    runner.willReturn({
      code: 0,
      stdout: 'Starting background service…\nrespawned d1b2f43c\nall done\n',
      stderr: '',
      timedOut: false,
    });

    const result = await respawner.all('365');

    expect(result.ok ? result.value.respawned : []).toEqual(['d1b2f43c']);
  });
});

describe('SessionRespawner — the audit trail', () => {
  it('writes a row naming the subscription and what was asked for', async () => {
    const { respawner, runner, store } = harness();
    runner.willReturn({ code: 0, stdout: 'respawned d1b2f43c\n', stderr: '', timedOut: false });

    await respawner.all('365');

    const row = store.allAudit.find((one) => one.action === 'respawn');
    expect(row?.target).toBe('365:all');
    expect(row?.outcome).toBe('ok');
  });

  it('writes a failed row when the CLI refused', async () => {
    const { respawner, runner, store } = harness();
    runner.willReturn({ code: 1, stdout: '', stderr: '', timedOut: false });

    await respawner.one(REF);

    expect(store.allAudit.find((one) => one.action === 'respawn')?.outcome).toBe('failed');
  });
});
