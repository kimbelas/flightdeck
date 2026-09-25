// `GET /daemon` on the deck's side of the wire — P7-T4. The parser drops what it cannot vouch
// for rather than coercing it (CODING-STANDARDS §11 rule 1).
import { describe, expect, it } from 'vitest';
import { parseDaemonReport } from '../../contracts/daemon-report.ts';

const SUPERVISOR = {
  state: 'stale',
  pid: 27_708,
  rosterUpdatedAt: 1_789_976_327_838,
  startedAt: 1_789_976_311_277,
  version: '2.1.278',
  exitedAt: 1_789_976_332_799,
  exitCause: 'idle_exit',
};

const DAEMON = {
  subscription: 'isg',
  supervisor: SUPERVISOR,
  workers: [
    { shortId: '2f3e94f3', pid: 14_572, alive: false, startedAt: 1, cliVersion: '2.1.268' },
  ],
  endings: [
    {
      shortId: 'a41e908d',
      at: 5,
      reason: 'retired',
      retireReason: 'idle-prompt',
      idleMinutes: 32,
      lowMemory: true,
    },
    { shortId: '78a31323', at: 4, reason: 'stopped' },
  ],
  logRead: true,
};

describe('parseDaemonReport', () => {
  it('reads a whole report back as core sent it', () => {
    expect(parseDaemonReport({ at: 9, daemons: [DAEMON] })).toEqual({ at: 9, daemons: [DAEMON] });
  });

  it('refuses a reply that is not a report', () => {
    expect(parseDaemonReport(undefined)).toBeUndefined();
    expect(parseDaemonReport({ at: 'soon', daemons: [] })).toBeUndefined();
    expect(parseDaemonReport({ at: 1 })).toBeUndefined();
    expect(parseDaemonReport([])).toBeUndefined();
  });

  it('drops a daemon of an unknown subscription or with no supervisor state it knows', () => {
    const report = parseDaemonReport({
      at: 1,
      daemons: [
        { ...DAEMON, subscription: 'work' },
        { ...DAEMON, supervisor: { ...SUPERVISOR, state: 'restarting' } },
        { ...DAEMON, supervisor: 'up' },
        'isg',
      ],
    });

    expect(report?.daemons).toEqual([]);
  });

  it('drops workers and endings whose id is not a short id, or whose reason is not one', () => {
    const report = parseDaemonReport({
      at: 1,
      daemons: [
        {
          ...DAEMON,
          workers: [{ shortId: '../../x' }, { shortId: 'abcdef01' }, 7],
          endings: [
            { shortId: 'abcdef01', at: 1, reason: 'exploded' },
            { shortId: 'abcdef01', reason: 'stopped' },
            { shortId: 'abcdef01', at: 2, reason: 'retired' },
          ],
          logRead: 'yes',
        },
      ],
    });

    const [daemon] = report?.daemons ?? [];
    expect(daemon?.workers).toEqual([
      {
        shortId: 'abcdef01',
        pid: undefined,
        alive: false,
        startedAt: undefined,
        cliVersion: undefined,
      },
    ]);
    expect(daemon?.endings).toEqual([
      {
        shortId: 'abcdef01',
        at: 2,
        reason: 'retired',
        retireReason: 'unknown',
        idleMinutes: 0,
        lowMemory: false,
      },
    ]);
    expect(daemon?.logRead).toBe(false);
  });

  it('bounds a word that arrived as a paragraph, and drops a negative or fractional number', () => {
    const report = parseDaemonReport({
      at: 1,
      daemons: [
        {
          ...DAEMON,
          supervisor: { ...SUPERVISOR, version: 'v'.repeat(500), pid: -1, startedAt: 1.5 },
        },
      ],
    });

    const supervisor = report?.daemons[0]?.supervisor;
    expect(supervisor?.version).toHaveLength(40);
    expect(supervisor?.pid).toBeUndefined();
    expect(supervisor?.startedAt).toBeUndefined();
  });
});
