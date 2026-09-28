// A launch starts only inside an imported folder — P10-T2, SEC-FS-1.
//
// Until P10-T2 the launcher trusted that its cwd had been screened, and `POST /sessions` handed it
// whatever the body carried. The Start launcher sends a folder on every press, so the launcher
// screens it itself: the folder the session starts in is the one the registry resolved, and one it
// refuses is a refused launch with an audit row and no process.
import { describe, expect, it } from 'vitest';
import { AuditLog } from '../../../core/application/audit-log.ts';
import { SessionLauncher } from '../../../core/application/session-launcher.ts';
import { FakeClock } from '../../fakes/fake-clock.ts';
import { FakeLaunchCommands } from '../../fakes/fake-launch-commands.ts';
import { FakeLaunchDirectories } from '../../fakes/fake-launch-directories.ts';
import { FakeLogger } from '../../fakes/fake-logger.ts';
import { FakeProcessRunner } from '../../fakes/fake-process-runner.ts';
import { FakeStore } from '../../fakes/fake-store.ts';

const NEW_ID = '11111111-2222-3333-4444-555555555555';
const PROJECT = String.raw`C:\Users\belas\Documents\development\xpert-new`;
const OUTSIDE = String.raw`C:\Windows\System32`;

interface Rig {
  readonly launcher: SessionLauncher;
  readonly store: FakeStore;
  readonly runner: FakeProcessRunner;
  readonly directories: FakeLaunchDirectories;
}

function build(): Rig {
  const store = new FakeStore();
  const runner = new FakeProcessRunner();
  runner.willReturn({ stdout: `Started background session ${NEW_ID}\n` });
  const directories = new FakeLaunchDirectories().only(PROJECT);
  const launcher = new SessionLauncher({
    commands: new FakeLaunchCommands(),
    roster: { allows: () => Promise.resolve(false) },
    directories,
    runner,
    audit: new AuditLog(store, new FakeClock(), new FakeLogger()),
    logger: new FakeLogger(),
  });
  return { launcher, store, runner, directories };
}

function launchIn(cwd: string | undefined): {
  readonly profileFn: 'claude-isg';
  readonly prompt: string;
  readonly name: string;
  readonly cwd: string | undefined;
  readonly agent: undefined;
} {
  return {
    profileFn: 'claude-isg',
    prompt: '/ship',
    name: 'xpert-new-0927',
    cwd,
    agent: undefined,
  };
}

describe('SessionLauncher — the folder (P10-T2)', () => {
  it('starts in a folder inside an imported project', async () => {
    const { launcher, runner } = build();

    const result = await launcher.launch(launchIn(String.raw`${PROJECT}\core`));

    expect(result.ok).toBe(true);
    expect(runner.requests[0]?.cwd).toBe(String.raw`${PROJECT}\core`);
  });

  it('refuses a folder outside every imported project, and runs nothing', async () => {
    const { launcher, runner, store } = build();

    const result = await launcher.launch(launchIn(OUTSIDE));

    expect(result).toEqual({ ok: false, error: 'bad_cwd' });
    expect(runner.requests).toHaveLength(0);
    expect(store.allAudit).toHaveLength(1);
    expect(store.allAudit[0]?.outcome).toBe('refused');
  });

  it('does not screen a launch with no folder, which starts wherever core is', async () => {
    const { launcher, directories } = build();

    const result = await launcher.launch(launchIn(undefined));

    expect(result.ok).toBe(true);
    expect(directories.asked).toHaveLength(0);
  });
});
