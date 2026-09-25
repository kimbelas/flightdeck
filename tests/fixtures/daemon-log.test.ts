// The `daemon.log` fixtures — P7-T4, DECISIONS.md D28, D60.
//
// D28 moved this capture into the task that parses it, and these are the assertions that argument
// was for: the retirement words RESEARCH.md B.3 and F.2.15 quote survive the scrub readable, the
// retire → settle pair still names ONE session after it, and the roster fixture captured in P0-T9
// joins this log on the supervisor pid — the join that makes F.2.16's dead daemon visible.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseDaemonLog } from '../../contracts/daemon-log.ts';
import { projectRoster } from '../../contracts/daemon-roster.ts';
import { DaemonReader } from '../../core/application/daemon-reader.ts';
import { DaemonHistory } from '../../core/domain/daemon-history.ts';
import { FakeClock } from '../fakes/fake-clock.ts';
import { FakeDaemonLogSource } from '../fakes/fake-daemon-log-source.ts';
import { FakeProcessProbe } from '../fakes/fake-process-probe.ts';
import { FakeRosterSource } from '../fakes/fake-roster-source.ts';

const FIXTURES = join(import.meta.dirname, '..', '..', 'fixtures', 'daemon');
const ISG = readFileSync(join(FIXTURES, 'daemon-isg.log'), 'utf8');
const LOG_365 = readFileSync(join(FIXTURES, 'daemon-365.log'), 'utf8');
const ROSTER: unknown = JSON.parse(readFileSync(join(FIXTURES, 'roster.json'), 'utf8'));

describe('the scrubbed daemon.log fixtures', () => {
  it('carry all three retirement reasons, readable — the words the parser exists for', () => {
    const reasons = new Set(
      [...parseDaemonLog(ISG), ...parseDaemonLog(LOG_365)].flatMap((event) =>
        event.kind === 'retired' ? [event.reason] : [],
      ),
    );

    expect([...reasons].sort()).toEqual(['empty-idle', 'idle-prompt', 'settled']);
  });

  it('keep a retirement and its settlement naming the same session, 1-5 s apart (F.2.15)', () => {
    const events = parseDaemonLog(ISG);
    const retirements = events.filter((event) => event.kind === 'retired');
    expect(retirements.length).toBeGreaterThan(0);
    for (const retirement of retirements) {
      const settled = events.find(
        (event) =>
          event.kind === 'settled' &&
          event.shortId === retirement.shortId &&
          event.at >= retirement.at,
      );
      expect(settled?.at).toBeDefined();
      expect((settled?.at ?? 0) - retirement.at).toBeLessThan(5_000);
    }
  });

  it('carry no account name, and no path segment that is not structural', () => {
    for (const text of [ISG, LOG_365]) {
      expect(text).not.toMatch(/belas|Kimpoy/iu);
      expect(text).not.toContain('anthropic');
      expect(text).toContain('C:\\Users\\path-');
    }
  });

  it('classify the endings the way F.2.3 says only the log can', () => {
    const endings = DaemonHistory.of(parseDaemonLog(ISG)).endings;

    expect(new Set(endings.map((ending) => ending.reason))).toEqual(
      new Set(['retired', 'stopped']),
    );
    // No session in isg's window FINISHED on its own: every `(done)` in it followed a retirement,
    // which is F.2.3's point — the listing would have called all of them `done` alike.
    expect(endings.filter((ending) => ending.reason === 'finished')).toEqual([]);
  });

  // F.2.16's own supervisor: the roster named 23140 after it had gone. Its log has a second start
  // 266 ms after it that was REFUSED — which must not read as 23140 being replaced.
  it('pin the shutdown after a refused second start on the supervisor that kept running', () => {
    const history = DaemonHistory.of(parseDaemonLog(ISG));

    expect(history.runOf(23_140)?.exitCause).toBe('idle_exit');
    expect(history.runOf(34_948)).toBeUndefined();
  });

  it('carry the [low memory] mark F.2.15 found cutting the timer to ~32 minutes', () => {
    const low = parseDaemonLog(LOG_365).filter(
      (event) => event.kind === 'retired' && event.lowMemory,
    );

    expect(low.map((event) => (event.kind === 'retired' ? event.idleMinutes : 0))).toEqual([32, 5]);
  });

  // P0-T9's roster names supervisorPid 3828. isg's log saw 3828 start and idle-exit ten seconds
  // later — so, with no process behind the number, the reading is F.2.16's stale roster, and the
  // log is why it says so even if the pid were reissued.
  it('join the P0-T9 roster on its supervisor pid, which the log saw shut down', async () => {
    const roster = new FakeRosterSource().willReturn('isg', projectRoster(ROSTER));
    const log = new FakeDaemonLogSource().willReturn('isg', ISG).willReturn('365', LOG_365);
    const probe = new FakeProcessProbe().willBeAlive(3828);
    const reader = new DaemonReader({ roster, log, probe, clock: new FakeClock() });

    const report = await reader.read();
    const isg = report.daemons.find((daemon) => daemon.subscription === 'isg');

    expect(DaemonHistory.of(parseDaemonLog(ISG)).hasExited(3828)).toBe(true);
    expect(isg?.supervisor).toMatchObject({ state: 'stale', pid: 3828 });
    expect(isg?.workers.map((worker) => worker.shortId)).toEqual(['2f3e94f3']);
  });
});
