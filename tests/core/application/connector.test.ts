// Connect refuses while core is down (F.1.5), Disconnect never asks, and nothing is written that
// the owner was not shown (D13). Those three sentences are this file.
import { describe, expect, it } from 'vitest';
import { Connector } from '../../../core/application/connector.ts';
import { FakeConfigFile } from '../../fakes/fake-config-file.ts';
import { FakeCoreHealth } from '../../fakes/fake-core-health.ts';
import { FakeLogger } from '../../fakes/fake-logger.ts';
import { FakeSessionEnvironment } from '../../fakes/fake-session-environment.ts';
import { FakeSourcePatcher } from '../../fakes/fake-source-patcher.ts';

const SETTINGS_PATH = 'C:\\cfg\\settings.json';
const STATUSLINE_PATH = 'C:\\hooks\\statusline.py';

interface Harness {
  readonly connector: Connector;
  readonly files: FakeConfigFile;
  readonly health: FakeCoreHealth;
  readonly environment: FakeSessionEnvironment;
}

function harness(running = true): Harness {
  const files = new FakeConfigFile({
    [SETTINGS_PATH]: '{\n  "model": "opus"\n}\n',
    [STATUSLINE_PATH]: 'def main():\n    pass\n',
  });
  const health = new FakeCoreHealth(running);
  const environment = new FakeSessionEnvironment();
  const connector = new Connector({
    files,
    health,
    patcher: new FakeSourcePatcher(),
    environment,
    settingsPaths: [{ subscription: '365', path: SETTINGS_PATH }],
    statuslinePath: STATUSLINE_PATH,
    logger: new FakeLogger(),
  });
  return { connector, files, health, environment };
}

describe('Connector', () => {
  it('planning writes nothing at all', async () => {
    const { connector, files } = harness();

    connector.plan('connect');
    await Promise.resolve();

    expect(files.operations).toEqual([]);
  });

  it('refuses to connect while core is down, before touching a file', async () => {
    const { connector, files, health } = harness(false);

    const outcome = await connector.apply('connect', connector.plan('connect'));

    expect(outcome.ok).toBe(false);
    expect(outcome.ok ? '' : outcome.reason).toBe('core is not running');
    expect(files.operations).toEqual([]);
    expect(health.asked).toBe(1);
  });

  it('disconnects without asking whether core is running \u2014 that is when it is needed most', async () => {
    // A dead core is the likeliest reason somebody is running Disconnect at all: a repair tool
    // that requires the broken thing to be working is not a repair tool (SECURITY.md \u00a75.3).
    const { connector, health } = harness();
    await connector.apply('connect', connector.plan('connect'));
    const askedWhileConnecting = health.asked;
    health.running = false;

    const outcome = await connector.apply('disconnect', connector.plan('disconnect'));

    expect(outcome.ok).toBe(true);
    expect(health.asked).toBe(askedWhileConnecting);
  });

  it('backs every file up BEFORE replacing it (SEC-FS-3)', async () => {
    const { connector, files } = harness();

    await connector.apply('connect', connector.plan('connect'));

    expect(files.operations).toEqual([
      `backup ${SETTINGS_PATH}`,
      `write ${SETTINGS_PATH}`,
      `backup ${STATUSLINE_PATH}`,
      `write ${STATUSLINE_PATH}`,
    ]);
  });

  it('reports where each backup went', async () => {
    const { connector } = harness();

    const outcome = await connector.apply('connect', connector.plan('connect'));

    expect(outcome.applied.map((a) => a.backup)).toEqual([
      `${SETTINGS_PATH}.bak-fake`,
      `${STATUSLINE_PATH}.bak-fake`,
    ]);
  });

  it('refuses a plan whose file changed after it was shown', async () => {
    const { connector, files } = harness();
    const plan = connector.plan('connect');
    files.files.set(SETTINGS_PATH, '{\n  "model": "sonnet"\n}\n');

    const outcome = await connector.apply('connect', plan);

    expect(outcome.ok).toBe(false);
    expect(outcome.ok ? '' : outcome.reason).toContain('changed since the plan was made');
    expect(files.operations).toEqual([]);
  });

  it('stops at the first failed write and still reports the backups already taken', async () => {
    const { connector, files } = harness();
    files.failOn = STATUSLINE_PATH;

    const outcome = await connector.apply('connect', connector.plan('connect'));

    expect(outcome.ok).toBe(false);
    expect(outcome.applied.map((a) => a.path)).toEqual([SETTINGS_PATH]);
  });

  it('publishes the env var AFTER the files, so a failure never leaves hooks with no key', async () => {
    const { connector, files, environment } = harness();

    await connector.apply('connect', connector.plan('connect'));

    expect(environment.calls).toEqual(['publish']);
    expect(files.operations.at(-1)).toBe(`write ${STATUSLINE_PATH}`);
  });

  it('does not publish the env var when a file write failed', async () => {
    const { connector, files, environment } = harness();
    files.failOn = SETTINGS_PATH;

    await connector.apply('connect', connector.plan('connect'));

    expect(environment.calls).toEqual([]);
  });

  it('reports a failed publish rather than claiming success', async () => {
    const { connector, environment } = harness();
    environment.failOnPublish = true;

    const outcome = await connector.apply('connect', connector.plan('connect'));

    expect(outcome.ok).toBe(false);
    expect(outcome.ok ? '' : outcome.reason).toContain('setx refused');
  });

  it('withdraws the env var on disconnect', async () => {
    const { connector, environment } = harness();
    await connector.apply('connect', connector.plan('connect'));

    await connector.apply('disconnect', connector.plan('disconnect'));

    expect(environment.calls).toEqual(['publish', 'withdraw']);
  });

  it('disconnect restores the files exactly', async () => {
    const { connector, files } = harness();
    const before = new Map(files.files);
    await connector.apply('connect', connector.plan('connect'));

    await connector.apply('disconnect', connector.plan('disconnect'));

    expect(files.files.get(SETTINGS_PATH)).toBe(before.get(SETTINGS_PATH));
    expect(files.files.get(STATUSLINE_PATH)).toBe(before.get(STATUSLINE_PATH));
  });

  it('will not apply a refused plan', async () => {
    const { connector, files } = harness();
    files.files.set(SETTINGS_PATH, 'not json');

    const outcome = await connector.apply('connect', connector.plan('connect'));

    expect(outcome.ok).toBe(false);
    expect(files.operations).toEqual([]);
  });
});
