// One subscription's background daemon, as the panel says it — P7-T4, SPEC §6(13).
//
// **The sentence that matters is the stale one.** A roster naming a supervisor that has gone is
// RESEARCH.md F.2.16: `stop`, `rm` and `logs` all fail, keep failing, and say "try again in a
// moment" about a condition that never resolves — until a new `--bg` launch starts a daemon. So the
// `stale` headline names the pid, says how long ago the log saw it go, and says what fixes it,
// because that is the question the owner has when a stop button did nothing.
//
// **`idle-prompt` is drawn as a request for attention, not as an ending.** F.2.15: it is the daemon
// retiring a session that was BLOCKED — waiting for the owner — so the owner never answered it. It
// reads `state: done` in every listing, which is exactly why it has to be said here.
import type {
  DaemonEnding,
  DaemonWorker,
  SubscriptionDaemon,
} from '../../contracts/daemon-report.ts';
import type { SubscriptionId } from '../../contracts/session.ts';
import { agoLabel } from './ago.ts';

export type DaemonTone = 'ok' | 'bad' | 'quiet';

/** One ending, ready to draw. `attention` marks the idle-prompt retirements. */
export interface DaemonEndingLine {
  readonly key: string;
  readonly shortId: string;
  readonly label: string;
  readonly detail: string;
  readonly attention: boolean;
}

export interface DaemonWorkerLine {
  readonly shortId: string;
  readonly label: string;
  readonly alive: boolean;
}

/** What each of the daemon's retirement words means, in the owner's terms (F.2.15). */
const RETIRED_BECAUSE: Readonly<Record<string, string>> = {
  'idle-prompt': 'retired while waiting for you',
  settled: 'retired after finishing',
  'empty-idle': 'retired before its first turn',
};

export class DaemonViewModel {
  private readonly daemon: SubscriptionDaemon;
  private readonly now: number;

  constructor(daemon: SubscriptionDaemon, now: number) {
    this.daemon = daemon;
    this.now = now;
  }

  public get subscription(): SubscriptionId {
    return this.daemon.subscription;
  }

  public get tone(): DaemonTone {
    switch (this.daemon.supervisor.state) {
      case 'running':
        return 'ok';
      case 'stale':
        return 'bad';
      case 'absent':
        return 'quiet';
    }
  }

  /** One sentence: is there a daemon to talk to, and if not, since when and what brings one back. */
  public get headline(): string {
    const { supervisor } = this.daemon;
    const pid = supervisor.pid === undefined ? '' : ` ${String(supervisor.pid)}`;
    switch (supervisor.state) {
      case 'running':
        return `running — supervisor${pid}${this.versionText()}${this.sinceText(supervisor.startedAt, 'up')}`;
      case 'stale':
        return (
          `not running — the roster still names supervisor${pid}${this.exitText()}. ` +
          'stop, rm and logs fail until a --bg launch starts a new one.'
        );
      case 'absent':
        return supervisor.startedAt === undefined
          ? 'no background daemon has run here'
          : `not running${this.exitText()}. The next --bg launch starts one.`;
    }
  }

  public get workers(): readonly DaemonWorkerLine[] {
    return this.daemon.workers.map((worker) => ({
      shortId: worker.shortId,
      label: this.workerLabel(worker),
      alive: worker.alive,
    }));
  }

  public get endings(): readonly DaemonEndingLine[] {
    return this.daemon.endings.map((ending, index) => ({
      key: `${ending.shortId}-${String(ending.at)}-${String(index)}`,
      shortId: ending.shortId,
      label: endingLabel(ending),
      detail: `${this.agoText(ending.at)}${endingDetail(ending)}`,
      attention: ending.reason === 'retired' && ending.retireReason === 'idle-prompt',
    }));
  }

  /** How many sessions the daemon retired while they waited on the owner — the count to worry about. */
  public get unanswered(): number {
    return this.endings.filter((ending) => ending.attention).length;
  }

  /** Said only when the log could not be read, so an empty history is not mistaken for a quiet one. */
  public get logNote(): string | undefined {
    return this.daemon.logRead ? undefined : 'daemon.log could not be read';
  }

  private workerLabel(worker: DaemonWorker): string {
    const pid = worker.pid === undefined ? 'no pid' : `pid ${String(worker.pid)}`;
    const version = worker.cliVersion === undefined ? '' : ` · ${worker.cliVersion}`;
    const since = this.sinceText(worker.startedAt, 'started');
    return `${pid}${worker.alive ? '' : ' (gone)'}${version}${since}`;
  }

  private versionText(): string {
    const { version } = this.daemon.supervisor;
    return version === undefined ? '' : `, v${version}`;
  }

  private exitText(): string {
    const { exitedAt, exitCause } = this.daemon.supervisor;
    if (exitedAt === undefined) return '';
    const cause = exitCause === undefined ? '' : ` (${exitCause})`;
    return `, which shut down ${agoLabel(this.now - exitedAt)} ago${cause}`;
  }

  private sinceText(at: number | undefined, verb: string): string {
    return at === undefined ? '' : ` · ${verb} ${agoLabel(this.now - at)} ago`;
  }

  private agoText(at: number): string {
    return `${agoLabel(this.now - at)} ago`;
  }
}

function endingLabel(ending: DaemonEnding): string {
  if (ending.reason !== 'retired') return ending.reason;
  return RETIRED_BECAUSE[ending.retireReason] ?? `retired (${ending.retireReason})`;
}

/**
 * The printed idle figure is an UPPER bound — F.2.15 measured it as the session's age — so it is
 * drawn as `≤`, not as a measurement. `[low memory]` is what cut the timer to ~32 minutes.
 */
function endingDetail(ending: DaemonEnding): string {
  if (ending.reason !== 'retired') return '';
  const memory = ending.lowMemory ? ' · low memory' : '';
  return ` · idle ≤ ${String(ending.idleMinutes)}m${memory}`;
}
