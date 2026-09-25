// Daemon visibility — P7-T4, SPEC §6(13), RESEARCH.md B.3, F.2.15, F.2.16.
//
// **Three witnesses, and they disagree in known ways.** The roster says which supervisor and which
// workers the daemon last CLAIMED; it is a cache the daemon stops writing when it exits, so on this
// machine both rosters named dead supervisors when P5a-T4 looked, one for nine days. The process
// probe says whether a pid EXISTS, which a reissued pid answers wrongly. The log says what HAPPENED
// — starts, shutdowns, how each session ended — and is the only one of the three that is never
// stale about the past. So the verdict is built in that order of trust: the log's "that pid shut
// down" beats the probe's "that pid exists", and the probe beats the roster's claim.
//
// **Read per request, never cached, never polled.** The whole value of the roster here is that it
// is read FRESH (`reads.ts`, P5a-T4's reason): a supervisor that died a minute ago is exactly the
// state a cached answer would hide. The read is two small files and a handful of `kill(pid, 0)`s —
// milliseconds — and it happens when somebody opens the panel.
import { parseDaemonLog } from '../../contracts/daemon-log.ts';
import type { RosterView } from '../../contracts/daemon-roster.ts';
import type {
  DaemonReport,
  DaemonSupervisor,
  DaemonWorker,
  SubscriptionDaemon,
  SupervisorState,
} from '../../contracts/daemon-report.ts';
import { SUBSCRIPTION_IDS, type SubscriptionId } from '../../contracts/session.ts';
import { DaemonHistory, type SupervisorRun } from '../domain/daemon-history.ts';
import type { Clock } from '../ports/clock.ts';
import type { DaemonLogSource } from '../ports/daemon-log-source.ts';
import type { ProcessProbe } from '../ports/process-probe.ts';
import type { RosterSource } from '../ports/roster-source.ts';

export interface DaemonReaderParts {
  readonly roster: RosterSource;
  readonly log: DaemonLogSource;
  readonly probe: ProcessProbe;
  readonly clock: Clock;
}

export class DaemonReader {
  private readonly parts: DaemonReaderParts;

  constructor(parts: DaemonReaderParts) {
    this.parts = parts;
  }

  /** Both subscriptions, always both — a subscription with no daemon ever is `absent`, not missing. */
  public async read(): Promise<DaemonReport> {
    const daemons = await Promise.all(SUBSCRIPTION_IDS.map((id) => this.readOne(id)));
    return { at: this.parts.clock.now().getTime(), daemons };
  }

  private async readOne(subscription: SubscriptionId): Promise<SubscriptionDaemon> {
    const text = await this.parts.log.tail(subscription);
    const history = DaemonHistory.of(parseDaemonLog(text ?? ''));
    const roster = this.parts.roster.read(subscription);
    return {
      subscription,
      supervisor: this.supervisor(roster, history),
      workers: this.workers(roster),
      endings: history.endings,
      logRead: text !== undefined,
    };
  }

  /**
   * The headline — see the header for the order of trust.
   *
   * With no roster, the log's still-open start is the only candidate, and it counts only if its
   * pid is alive: a start with no shutdown after it and no process behind it is a supervisor that
   * died without logging, which is `absent` rather than `stale` because no roster is claiming it.
   *
   * The start and exit reported are the claimed pid's OWN run when the log has it — "the roster
   * names 3828, which shut down …" must be about 3828, not about whichever daemon ran last.
   */
  private supervisor(roster: RosterView | undefined, history: DaemonHistory): DaemonSupervisor {
    const last = history.lastRun;
    const claimed = roster?.supervisorPid;
    const open = last !== undefined && last.exitedAt === undefined ? last.pid : undefined;
    const pid = claimed ?? open;
    const run = (claimed === undefined ? undefined : history.runOf(claimed)) ?? last;
    return {
      state: this.stateOf(claimed, open, history),
      pid,
      rosterUpdatedAt: roster?.updatedAt,
      ...runFields(run),
    };
  }

  private stateOf(
    claimed: number | undefined,
    open: number | undefined,
    history: DaemonHistory,
  ): SupervisorState {
    if (claimed !== undefined) {
      if (history.hasExited(claimed) === true) return 'stale';
      return this.parts.probe.isAlive(claimed) ? 'running' : 'stale';
    }
    return open !== undefined && this.parts.probe.isAlive(open) ? 'running' : 'absent';
  }

  /** The roster's workers, keyed by short id, oldest first. `cwd` is deliberately not carried. */
  private workers(roster: RosterView | undefined): readonly DaemonWorker[] {
    if (roster === undefined) return [];
    return Object.entries(roster.workers)
      .map(([shortId, worker]) => ({
        shortId,
        pid: worker.pid,
        alive: worker.pid !== undefined && this.parts.probe.isAlive(worker.pid),
        startedAt: worker.startedAt,
        cliVersion: worker.cliVersion,
      }))
      .sort((left, right) => (left.startedAt ?? 0) - (right.startedAt ?? 0));
  }
}

/** A run's four facts, or four `undefined`s when the log's window holds no supervisor start. */
function runFields(
  run: SupervisorRun | undefined,
): Pick<DaemonSupervisor, 'startedAt' | 'version' | 'exitedAt' | 'exitCause'> {
  if (run === undefined) {
    return { startedAt: undefined, version: undefined, exitedAt: undefined, exitCause: undefined };
  }
  return {
    startedAt: run.startedAt,
    version: run.version,
    exitedAt: run.exitedAt,
    exitCause: run.exitCause,
  };
}
