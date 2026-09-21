// `InstallDoctor` — the version chip's read and its one write (P4-T5).
//
// The split this file pins is between them. `doctor` reads and writes no audit row, because a row
// per panel open would bury the rows that matter. `update` has **no check-only form** — its help
// says "Check for updates and install if available" and offers no flag (RESEARCH.md F.10.2) — so
// pressing it can replace the binary every session on the machine then starts, and it writes one.
import { describe, expect, it } from 'vitest';
import { ClaudeInstall } from '../../../core/adapters/claude-cli/claude-install.ts';
import { AuditLog } from '../../../core/application/audit-log.ts';
import { InstallDoctor } from '../../../core/application/install-doctor.ts';
import { FakeClock } from '../../fakes/fake-clock.ts';
import { FakeLogger } from '../../fakes/fake-logger.ts';
import { FakeProcessRunner } from '../../fakes/fake-process-runner.ts';
import { FakeStore } from '../../fakes/fake-store.ts';

const DOCTOR = [
  'Claude Code doctor',
  'Running: npm-global (2.1.278)',
  'Platform: win32-x64',
  'Path: C:\\Users\\ada\\AppData\\Roaming\\npm\\claude.exe',
  'Auto-updates: enabled',
  'No installation issues found.',
].join('\n');

interface Harness {
  readonly doctor: InstallDoctor;
  readonly runner: FakeProcessRunner;
  readonly store: FakeStore;
}

function harness(executable = 'C:\\claude.exe'): Harness {
  const runner = new FakeProcessRunner();
  const store = new FakeStore();
  return {
    doctor: new InstallDoctor({
      install: new ClaudeInstall('C:\\home', executable),
      runner,
      audit: new AuditLog(store, new FakeClock(), new FakeLogger()),
      logger: new FakeLogger(),
    }),
    runner,
    store,
  };
}

describe('InstallDoctor — check', () => {
  it('runs `doctor` under the subscription it was asked about', async () => {
    const { doctor, runner } = harness();
    runner.willReturn({ code: 0, stdout: DOCTOR });

    await doctor.check('isg');

    expect(runner.requests[0]?.args).toEqual(['doctor']);
    expect(runner.requests[0]?.env['CLAUDE_CONFIG_DIR']).toContain('.claude-isg');
  });

  it('answers the narrowed health, with the account name gone (SEC-DATA-2)', async () => {
    const { doctor, runner } = harness();
    runner.willReturn({ code: 0, stdout: DOCTOR });

    const health = await doctor.check('365');

    expect(health.ok).toBe(true);
    expect(JSON.stringify(health)).not.toContain('ada');
    expect(health.ok ? health.value.autoUpdates : undefined).toBe(true);
  });

  it('writes NO audit row — it reads and changes nothing', async () => {
    // A row per panel open would bury the rows a reviewer is actually looking for. SEC-PROC-3 is
    // about mutating actions, and this is not one.
    const { doctor, runner, store } = harness();
    runner.willReturn({ code: 0, stdout: DOCTOR });

    await doctor.check('365');

    expect(store.allAudit).toHaveLength(0);
  });

  it('refuses without spawning when there is no binary', async () => {
    const { doctor, runner } = harness('');

    const health = await doctor.check('365');

    expect(health.ok ? '' : health.error).toBe('no_claude');
    expect(runner.requests).toHaveLength(0);
  });

  it('reports a non-zero exit as a failure rather than an empty reading', async () => {
    const { doctor, runner } = harness();
    runner.willReturn({ code: 1, stdout: '' });

    expect((await doctor.check('365')).ok).toBe(false);
  });
});

describe('InstallDoctor — update', () => {
  it('reads "already up to date" as no change, which is the usual answer', async () => {
    // Auto-updates are enabled on this machine and last succeeded two days before the measurement
    // (F.10.1), so the button says this almost every time.
    const { doctor, runner } = harness();
    runner.willReturn({ code: 0, stdout: 'Claude Code is up to date (2.1.278)' });

    const updated = await doctor.update('365');

    expect(updated.ok ? updated.value.changed : true).toBe(false);
    expect(updated.ok ? updated.value.version : '').toBe('2.1.278');
  });

  it('writes an audit row, because there is no check-only form of this verb', async () => {
    const { doctor, runner, store } = harness();
    runner.willReturn({ code: 0, stdout: 'Claude Code is up to date (2.1.278)' });

    await doctor.update('365');

    const row = store.allAudit.find((one) => one.action === 'update');
    expect(row?.outcome).toBe('ok');
    expect(row?.target).toBe('365');
  });

  it('never relays the hook error Flightdeck caused by being down', async () => {
    // `update` runs a session lifecycle and fires SessionEnd, so its stdout carries an
    // ECONNREFUSED against Flightdeck's own port when core is stopped (F.10.2).
    const { doctor, runner } = harness();
    runner.willReturn({
      code: 0,
      stdout:
        'Claude Code is up to date (2.1.278)\nSessionEnd hook [http://127.0.0.1:4950/hooks] failed: connect ECONNREFUSED 127.0.0.1:4950',
    });

    const updated = await doctor.update('365');

    expect(JSON.stringify(updated)).not.toContain('ECONNREFUSED');
    expect(JSON.stringify(updated)).not.toContain('4950');
  });

  it('writes a refused row and spawns nothing with no binary', async () => {
    const { doctor, runner, store } = harness('');

    const updated = await doctor.update('365');

    expect(updated.ok ? '' : updated.error).toBe('no_claude');
    expect(runner.requests).toHaveLength(0);
    expect(store.allAudit.find((one) => one.action === 'update')?.outcome).toBe('refused');
  });
});
