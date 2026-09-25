// What the fixture core answers on `GET /daemon` — P7-T4.
//
// Not hand-written, unlike most of the fixture core: it is core's OWN `DaemonReader` over the
// committed, scrubbed captures — `fixtures/daemon/roster.json` from P0-T9 and both subscriptions'
// `daemon.log` — so what the deck draws is what core would conclude from those files (D35). Only
// the process probe is a stand-in, and it answers "alive" for 3828 on purpose: that is the pid the
// roster names and the one the log saw shut down, so the stale verdict the smoke asserts is the
// LOG overruling a process table that says the number exists (RESEARCH.md F.2.16).
import { readFileSync } from 'node:fs';
import { parseDaemonLog } from '../../../contracts/daemon-log.ts';
import { projectRoster } from '../../../contracts/daemon-roster.ts';
import { DaemonReader } from '../../../core/application/daemon-reader.ts';

const FIXTURES = new URL('../../../fixtures/daemon/', import.meta.url);

/** The pid P0-T9's roster fixture names as its supervisor. */
export const FIXTURE_SUPERVISOR_PID = 3828;

function text(name) {
  return readFileSync(new URL(name, FIXTURES), 'utf8');
}

/**
 * Two hours after the newest line of either log.
 *
 * The scrubber shifts every instant by six years (capture-fixtures.mjs), so against the real clock
 * every age on the panel would read `313w`. Pinning "now" just after the capture keeps the ages the
 * smoke reads — `2h ago`, `4d ago` — the ones the owner would have seen when it was taken.
 */
export const FIXTURE_DAEMON_NOW_OFFSET_MS = 2 * 3_600_000;

export function fixtureDaemonReader() {
  const roster = projectRoster(JSON.parse(text('roster.json')));
  const logs = { isg: text('daemon-isg.log'), 365: text('daemon-365.log') };
  const newest = Math.max(
    ...Object.values(logs).flatMap((log) => parseDaemonLog(log).map((event) => event.at)),
  );
  const now = () => newest + FIXTURE_DAEMON_NOW_OFFSET_MS;
  return new DaemonReader({
    roster: { read: (subscription) => (subscription === 'isg' ? roster : undefined) },
    log: { tail: (subscription) => Promise.resolve(logs[subscription]) },
    probe: { isAlive: (pid) => pid === FIXTURE_SUPERVISOR_PID },
    clock: { now: () => new Date(now()) },
  });
}
