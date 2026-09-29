// Connect and Disconnect, as one use case (P1-T11, D13).
//
// Planning and writing are separate calls on purpose. `plan()` is safe to run at any time and is
// what the CLI shows; `apply()` takes a plan it was given rather than computing one of its own, so
// there is no path where something is written that the owner was not shown. That is D13's promise
// and SEC-FS-3's procedure, expressed as a signature rather than as a convention.
import type {
  AppliedChange,
  ConnectDirection,
  ConnectPlan,
  FileChange,
} from '../../contracts/connect-plan.ts';
import type { ConfigFile } from '../ports/config-file.ts';
import type { CoreHealth } from '../ports/core-health.ts';
import type { Logger } from '../ports/logger.ts';
import type { SessionEnvironment } from '../ports/session-environment.ts';
import type { SourcePatcher } from '../ports/source-patcher.ts';
import { CORE_PORT } from '../../contracts/origins.ts';
import { ConnectPlanner, type SettingsSource, type StatuslineSource } from './connect-planner.ts';

export interface ConnectorParts {
  readonly files: ConfigFile;
  readonly health: CoreHealth;
  readonly patcher: SourcePatcher;
  readonly environment: SessionEnvironment;
  readonly settingsPaths: readonly { readonly subscription: string; readonly path: string }[];
  readonly statuslinePath: string;
  readonly logger: Logger;
  /** The core the hooks post to. 4950 when omitted; an outpost's own port there (P11-T0). */
  readonly corePort?: number;
}

export type ApplyOutcome =
  | { readonly ok: true; readonly applied: readonly AppliedChange[] }
  | { readonly ok: false; readonly reason: string; readonly applied: readonly AppliedChange[] };

export class Connector {
  private readonly files: ConfigFile;
  private readonly health: CoreHealth;
  private readonly patcher: SourcePatcher;
  private readonly environment: SessionEnvironment;
  private readonly settingsPaths: readonly {
    readonly subscription: string;
    readonly path: string;
  }[];
  private readonly statuslinePath: string;
  private readonly logger: Logger;
  private readonly corePort: number;

  constructor(parts: ConnectorParts) {
    this.files = parts.files;
    this.health = parts.health;
    this.patcher = parts.patcher;
    this.environment = parts.environment;
    this.settingsPaths = parts.settingsPaths;
    this.statuslinePath = parts.statuslinePath;
    this.logger = parts.logger;
    this.corePort = parts.corePort ?? CORE_PORT;
  }

  /** Reads every file and works out the change. Writes nothing, whatever the answer. */
  public plan(direction: ConnectDirection): ConnectPlan {
    const settings: readonly SettingsSource[] = this.settingsPaths.map((entry) => ({
      subscription: entry.subscription,
      path: entry.path,
      contents: this.files.read(entry.path),
    }));
    const statusline: StatuslineSource = {
      path: this.statuslinePath,
      contents: this.files.read(this.statuslinePath),
    };
    const planner = new ConnectPlanner({
      settings,
      statusline,
      patcher: this.patcher,
      environment: this.environment,
      corePort: this.corePort,
    });
    return direction === 'connect' ? planner.connect() : planner.disconnect();
  }

  /**
   * Writes a plan that was already shown.
   *
   * **Connect refuses while core is down** (F.1.5). Disconnect does not ask, and must not: a dead
   * core is the single most likely reason somebody is running Disconnect at all, and a repair tool
   * that requires the broken thing to be working is not a repair tool (SECURITY.md §5.3).
   *
   * @returns which files were written and where each backup went. A failure part-way through
   * stops immediately and reports what had already been applied, because the backups are the
   * recovery path and the operator needs to be told they exist.
   */
  public async apply(direction: ConnectDirection, plan: ConnectPlan): Promise<ApplyOutcome> {
    if (!plan.ok) return { ok: false, reason: 'the plan was refused', applied: [] };
    if (direction === 'connect' && !(await this.health.isRunning())) {
      return { ok: false, reason: 'core is not running', applied: [] };
    }
    const written = this.write(direction, plan.changes);
    if (!written.ok) return written;

    // Last, and deliberately after the files: a published key with no hooks installed is inert,
    // where installed hooks with no key behind them are a 401 on every turn (F.1.5). If the order
    // has to be wrong for a moment, this is the harmless way round.
    try {
      if (plan.environment === 'publish') this.environment.publish();
      if (plan.environment === 'withdraw') this.environment.withdraw();
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : 'failed';
      return {
        ok: false,
        reason: `${this.environment.describe()}: ${reason}`,
        applied: written.applied,
      };
    }
    return written;
  }

  private write(direction: ConnectDirection, changes: readonly FileChange[]): ApplyOutcome {
    const applied: AppliedChange[] = [];
    for (const change of changes) {
      // Re-read and compare before replacing: the plan was computed from contents that were true
      // when it was shown, and a file that moved under us is a file whose diff the owner did not
      // actually approve.
      if (this.files.read(change.path) !== change.before) {
        return { ok: false, reason: `${change.path} changed since the plan was made`, applied };
      }
      try {
        applied.push({ path: change.path, backup: this.files.replace(change.path, change.after) });
      } catch (cause) {
        const reason = cause instanceof Error ? cause.message : 'write failed';
        return { ok: false, reason: `${change.path}: ${reason}`, applied };
      }
    }
    this.logger.info(`flightdeck_${direction}`, { files: applied.length });
    return { ok: true, applied };
  }
}
