// Daemon visibility — P7-T4. The order of trust under test: the log's "that pid shut down" beats
// the probe's "that pid exists", and the probe beats the roster's claim (RESEARCH.md F.2.16).
import { describe, expect, it } from 'vitest';
import { DaemonReader } from '../../../core/application/daemon-reader.ts';
import type { SubscriptionDaemon } from '../../../contracts/daemon-report.ts';
import type { SubscriptionId } from '../../../contracts/session.ts';
import { FakeClock } from '../../fakes/fake-clock.ts';
import { FakeDaemonLogSource, logLine } from '../../fakes/fake-daemon-log-source.ts';
import { FakeProcessProbe } from '../../fakes/fake-process-probe.ts';
import { FakeRosterSource, rosterView } from '../../fakes/fake-roster-source.ts';

const NOW = Date.parse('2026-09-25T12:00:00.000Z');
const START = logLine(
  NOW - 60_000,
  'supervisor',
  '─── daemon start ─── version=2.1.282 pid=3828 origin=transient',
);
const EXIT = logLine(
  NOW - 30_000,
  'supervisor',
  'shutting down (cause=idle_exit, uptime=30s, leases=0, live_workers=0)',
);

interface Rig {
  readonly reader: DaemonReader;
  readonly roster: FakeRosterSource;
  readonly log: FakeDaemonLogSource;
  readonly probe: FakeProcessProbe;
}

function rig(): Rig {
  const roster = new FakeRosterSource();
  const log = new FakeDaemonLogSource();
  const probe = new FakeProcessProbe();
  const clock = new FakeClock(NOW);
  return { reader: new DaemonReader({ roster, log, probe, clock }), roster, log, probe };
}

async function readOne(parts: Rig, subscription: SubscriptionId): Promise<SubscriptionDaemon> {
  const report = await parts.reader.read();
  const daemon = report.daemons.find((one) => one.subscription === subscription);
  if (daemon === undefined) throw new Error(`no ${subscription} in the report`);
  return daemon;
}

describe('DaemonReader', () => {
  it('answers both subscriptions, stamped with the clock', async () => {
    const report = await rig().reader.read();

    expect(report.at).toBe(NOW);
    expect(report.daemons.map((daemon) => daemon.subscription)).toEqual(['isg', '365']);
    expect(report.daemons.every((daemon) => daemon.supervisor.state === 'absent')).toBe(true);
    expect(report.daemons.every((daemon) => !daemon.logRead)).toBe(true);
  });

  it('calls a roster whose supervisor is alive running', async () => {
    const parts = rig();
    parts.roster.willReturn('isg', rosterView({ supervisorPid: 3828 }));
    parts.log.willReturn('isg', START);
    parts.probe.willBeAlive(3828);

    const daemon = await readOne(parts, 'isg');
    expect(daemon.supervisor).toMatchObject({ state: 'running', pid: 3828, version: '2.1.282' });
    expect(daemon.logRead).toBe(true);
  });

  it('calls a roster naming a dead supervisor stale — F.2.16', async () => {
    const parts = rig();
    parts.roster.willReturn('isg', rosterView({ supervisorPid: 3828, updatedAt: NOW - 9e8 }));

    const daemon = await readOne(parts, 'isg');
    expect(daemon.supervisor).toMatchObject({
      state: 'stale',
      pid: 3828,
      rosterUpdatedAt: NOW - 9e8,
    });
  });

  // The pid-reuse case: the process table says the number exists, the log says that supervisor
  // shut down. The log wins, and the probe is not even asked.
  it('believes the log over the probe when the log saw that supervisor shut down', async () => {
    const parts = rig();
    parts.roster.willReturn('isg', rosterView({ supervisorPid: 3828 }));
    parts.log.willReturn('isg', [START, EXIT].join('\n'));
    parts.probe.willBeAlive(3828);

    const daemon = await readOne(parts, 'isg');
    expect(daemon.supervisor).toMatchObject({
      state: 'stale',
      exitedAt: NOW - 30_000,
      exitCause: 'idle_exit',
    });
    expect(parts.probe.asked).not.toContain(3828);
  });

  it('describes the CLAIMED supervisor’s own run, not whichever daemon ran last', async () => {
    const parts = rig();
    const later = logLine(
      NOW - 1000,
      'supervisor',
      '─── daemon start ─── version=2.1.290 pid=9999 origin=transient',
    );
    parts.roster.willReturn('isg', rosterView({ supervisorPid: 3828 }));
    parts.log.willReturn('isg', [START, EXIT, later].join('\n'));

    expect((await readOne(parts, 'isg')).supervisor).toMatchObject({
      state: 'stale',
      pid: 3828,
      version: '2.1.282',
      exitedAt: NOW - 30_000,
    });
  });

  it('with no roster, finds a live supervisor from the log’s still-open start', async () => {
    const parts = rig();
    parts.log.willReturn('365', START);
    parts.probe.willBeAlive(3828);

    expect((await readOne(parts, '365')).supervisor).toMatchObject({ state: 'running', pid: 3828 });
  });

  it('with no roster, calls a closed or dead start absent rather than stale', async () => {
    const closed = rig();
    closed.log.willReturn('365', [START, EXIT].join('\n'));
    const dead = rig();
    dead.log.willReturn('365', START);

    expect((await readOne(closed, '365')).supervisor).toMatchObject({
      state: 'absent',
      pid: undefined,
    });
    expect((await readOne(dead, '365')).supervisor.state).toBe('absent');
  });

  it('lists the roster’s workers oldest first, with whether each pid is still a process', async () => {
    const parts = rig();
    const worker = { sessionId: undefined, cwd: 'C:\\work', cliVersion: '2.1.282' };
    parts.roster.willReturn(
      'isg',
      rosterView({
        workers: {
          bbbbbbbb: { ...worker, pid: 20, startedAt: 2 },
          aaaaaaaa: { ...worker, pid: 10, startedAt: 1 },
          cccccccc: { ...worker, pid: undefined, startedAt: undefined },
        },
      }),
    );
    parts.probe.willBeAlive(10);

    const { workers } = await readOne(parts, 'isg');
    expect(workers.map((one) => [one.shortId, one.alive])).toEqual([
      ['cccccccc', false],
      ['aaaaaaaa', true],
      ['bbbbbbbb', false],
    ]);
    // `cwd` is deliberately not carried to the wire.
    expect(JSON.stringify(workers)).not.toContain('work');
  });

  it('reports how the sessions ended, from the log', async () => {
    const parts = rig();
    parts.log.willReturn(
      'isg',
      [
        logLine(NOW - 3000, 'bg', 'bg retire a41e908d: idle-prompt, idle 32m [low memory]'),
        logLine(NOW - 2000, 'bg', 'bg settled a41e908d (done)'),
      ].join('\n'),
    );

    expect((await readOne(parts, 'isg')).endings).toEqual([
      {
        shortId: 'a41e908d',
        at: NOW - 2000,
        reason: 'retired',
        retireReason: 'idle-prompt',
        idleMinutes: 32,
        lowMemory: true,
      },
    ]);
  });
});
