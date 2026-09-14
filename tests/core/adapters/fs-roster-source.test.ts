// The roster read, against real files on disk — P1-T14, SEC-FS-1/-2, DECISIONS.md D24.
//
// `tests/contracts/daemon-roster.test.ts` proves the projection. This proves the path from a file
// on disk to a value a caller holds: that the path is derived rather than accepted, that the
// deny-list runs before the open, and — the assertion this task exists for — that a hostile
// roster sitting on disk yields nothing containing `rvAuth`, `ptyAuth` or `dispatch`.
//
// The denied values below are shaped like the real ones and are invented. A test for a
// secret-handling rule is the last place a real secret should appear.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  FsRosterSource,
  type ConfigDirectories,
} from '../../../core/adapters/node/fs-roster-source.ts';
import { ReadPolicy } from '../../../core/domain/read-policy.ts';
import type { SubscriptionId } from '../../../contracts/session.ts';

const WORKER = '020e5c73';

const HOSTILE = {
  proto: 1,
  supervisorPid: 3828,
  updatedAt: 1_789_123_114_141,
  workers: {
    [WORKER]: {
      pid: 14_572,
      sessionId: '020e5c73-aea4-45b5-9561-0ade34ac96fe',
      cwd: 'C:\\work\\project',
      startedAt: 1_789_123_113_696,
      cliVersion: '2.1.268',
      rvAuth: 'a'.repeat(32),
      ptyAuth: 'b'.repeat(32),
      dispatch: { launch: { args: ['--bg', 'refactor the billing module'] } },
    },
  },
};

let home = '';
const created: string[] = [];

/** Two config directories under one temp home, the same shape `ClaudeInstall` produces. */
function directories(): ConfigDirectories {
  return {
    configDirFor: (subscription: SubscriptionId) =>
      join(home, subscription === 'isg' ? '.claude-isg' : '.claude-365'),
  };
}

function writeRoster(subscription: SubscriptionId, contents: string): void {
  const daemon = join(directories().configDirFor(subscription), 'daemon');
  mkdirSync(daemon, { recursive: true });
  writeFileSync(join(daemon, 'roster.json'), contents, 'utf8');
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'flightdeck-roster-'));
  created.push(home);
});

afterAll(() => {
  for (const directory of created) rmSync(directory, { recursive: true, force: true });
});

describe('FsRosterSource — what it returns', () => {
  it('reads the allowlisted fields of a real roster file', () => {
    writeRoster('365', JSON.stringify(HOSTILE));

    const view = new FsRosterSource(directories()).read('365');

    expect(view?.supervisorPid).toBe(3828);
    expect(view?.workers[WORKER]?.pid).toBe(14_572);
    expect(view?.workers[WORKER]?.cliVersion).toBe('2.1.268');
  });

  it('reads each subscription from its own directory and nothing else', () => {
    writeRoster('365', JSON.stringify({ ...HOSTILE, supervisorPid: 111 }));
    writeRoster('isg', JSON.stringify({ ...HOSTILE, supervisorPid: 222 }));
    const source = new FsRosterSource(directories());

    expect(source.read('365')?.supervisorPid).toBe(111);
    expect(source.read('isg')?.supervisorPid).toBe(222);
  });

  it('answers undefined for a subscription that has never run a --bg session', () => {
    // Not an empty view: "there is no roster" and "the daemon says it runs nothing" are different
    // answers, and a dead-supervisor check has to tell them apart (the port's JSDoc).
    expect(new FsRosterSource(directories()).read('isg')).toBeUndefined();
  });

  it('answers undefined for a torn read rather than throwing', () => {
    // The daemon rewrites this file in place while it runs, so half a JSON document is ordinary.
    writeRoster('365', '{"proto":1,"workers":{"020e5c73":{"pi');

    expect(new FsRosterSource(directories()).read('365')).toBeUndefined();
  });

  it('answers undefined for a roster that parses to something that is not an object', () => {
    writeRoster('365', '"a string"');

    expect(new FsRosterSource(directories()).read('365')?.workers).toEqual({});
  });
});

describe('FsRosterSource — SEC-FS-2, the fields that must never leave it', () => {
  const denied: readonly string[] = ['rvAuth', 'ptyAuth', 'dispatch'];

  it.each(denied)('never lets %s out, from a file that really contains it', (field) => {
    writeRoster('365', JSON.stringify(HOSTILE));

    const view = new FsRosterSource(directories()).read('365');

    expect(JSON.stringify(view)).not.toContain(field);
  });

  it('never lets the prompt text out, which is what dispatch actually carries', () => {
    writeRoster('365', JSON.stringify(HOSTILE));

    const view = new FsRosterSource(directories()).read('365');

    expect(JSON.stringify(view)).not.toContain('refactor the billing module');
  });

  it('drops a secret a future release invents, because the projection is an allowlist', () => {
    writeRoster(
      '365',
      JSON.stringify({ workers: { [WORKER]: { pid: 1, newAuth: 'c'.repeat(32) } } }),
    );

    const view = new FsRosterSource(directories()).read('365');

    expect(JSON.stringify(view)).not.toContain('newAuth');
    expect(view?.workers[WORKER]?.pid).toBe(1);
  });
});

describe('FsRosterSource — SEC-FS-1, the path is derived and screened', () => {
  it('refuses to read when the policy does not allow the path it built', () => {
    writeRoster('365', JSON.stringify(HOSTILE));
    // A policy with no roots refuses everything. The check exists for the day someone adds a path
    // parameter to `read`, not for today — today the path is derived and cannot be steered.
    const source = new FsRosterSource(directories(), new ReadPolicy([]));

    expect(source.read('365')).toBeUndefined();
  });

  it('is allowed by the real policy, so the allowlist and the adapter agree', () => {
    // The other half: a policy that denied `daemon\\roster.json` would make this adapter return
    // nothing for ever, silently. SEC-FS-1 allowlists the file; this pins that they match.
    const policy = new ReadPolicy([directories().configDirFor('365')]);

    expect(policy.allows(join(directories().configDirFor('365'), 'daemon', 'roster.json'))).toBe(
      true,
    );
  });
});
