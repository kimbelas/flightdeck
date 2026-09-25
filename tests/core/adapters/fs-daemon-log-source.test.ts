// The daemon.log read, against real files on disk — P7-T4, SEC-FS-1.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { FsDaemonLogSource } from '../../../core/adapters/node/fs-daemon-log-source.ts';
import type { ConfigDirectories } from '../../../core/adapters/node/fs-roster-source.ts';
import { ReadPolicy } from '../../../core/domain/read-policy.ts';
import type { SubscriptionId } from '../../../contracts/session.ts';

let home = '';
const created: string[] = [];

function directories(): ConfigDirectories {
  return {
    configDirFor: (subscription: SubscriptionId) =>
      join(home, subscription === 'isg' ? '.claude-isg' : '.claude-365'),
  };
}

function writeLog(subscription: SubscriptionId, contents: string): void {
  const directory = directories().configDirFor(subscription);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'daemon.log'), contents, 'utf8');
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'flightdeck-daemon-log-'));
  created.push(home);
});

afterAll(() => {
  for (const directory of created) rmSync(directory, { recursive: true, force: true });
});

describe('FsDaemonLogSource', () => {
  it('reads the whole log when it fits in the window', async () => {
    writeLog('isg', 'one\ntwo\n');

    expect(await new FsDaemonLogSource(directories()).tail('isg')).toBe('one\ntwo\n');
  });

  it('reads only the end of a long log, starting at a whole line', async () => {
    writeLog('365', `${'x'.repeat(100)}\nsecond line\nthird\n`);

    // The last 20 bytes are `x\nsecond line\nthird\n`; the partial `x` line is dropped.
    expect(await new FsDaemonLogSource(directories(), undefined, 20).tail('365')).toBe(
      'second line\nthird\n',
    );
  });

  it('answers an empty tail when the window lands inside one long line', async () => {
    writeLog('365', 'y'.repeat(100));

    expect(await new FsDaemonLogSource(directories(), undefined, 20).tail('365')).toBe('');
  });

  it('answers undefined when there is no log — a subscription that never ran --bg', async () => {
    expect(await new FsDaemonLogSource(directories()).tail('isg')).toBeUndefined();
  });

  it('asks the read policy first, and a refusal is undefined without an open', async () => {
    writeLog('isg', 'secret\n');
    const elsewhere = new ReadPolicy([join(home, 'somewhere-else')]);

    expect(await new FsDaemonLogSource(directories(), elsewhere).tail('isg')).toBeUndefined();
  });
});
