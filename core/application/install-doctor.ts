// `claude doctor` and `claude update`, per subscription — P4-T5, SEC-DATA-2.
//
// Both run `claude.exe` directly, as `stop`, `rm`, `resume` and Ask do: neither starts a session,
// so the profile function has nothing to contribute (D47's reading, applied again).
//
// **Neither result is relayed raw.** `doctor` prints the binary's path, which carries the Windows
// account name, and the two lines that name the employer's policy source; `update` prints whatever
// the SessionEnd hook did, which with core down is a Flightdeck ECONNREFUSED against Flightdeck's
// own port (RESEARCH.md F.10.1, F.10.2). `contracts/install-health.ts` narrows both, and this
// class is what hands it the stdout.
//
// **`update` writes an audit row and `doctor` does not.** Doctor reads; update can change the
// binary every session on this machine then runs. SEC-PROC-3's line is "every mutating action
// writes a row", and this is where that line falls.
import {
  parseInstallHealth,
  parseUpdateResult,
  type InstallHealth,
  type UpdateResult,
} from '../../contracts/install-health.ts';
import type { SubscriptionId } from '../../contracts/session.ts';
import type { ClaudeInstall } from '../adapters/claude-cli/claude-install.ts';
import type { Logger } from '../ports/logger.ts';
import type { ProcessRunner } from '../ports/process-runner.ts';
import { err, ok, type Result } from '../shared/result.ts';
import type { AuditLog } from './audit-log.ts';

/** F.10.1 measured doctor at 1.98 s. The budget is a cold daemon, not the verb. */
const DOCTOR_TIMEOUT_MS = 30_000;
/** F.10.2 measured update at 3.8 s when already current; installing one is slower. */
const UPDATE_TIMEOUT_MS = 180_000;

/** Why a reading or an update could not be taken. A closed union, as every refusal here is. */
export const INSTALL_FAILURES = ['no_claude', 'failed'] as const;
export type InstallFailure = (typeof INSTALL_FAILURES)[number];

export interface InstallDoctorParts {
  readonly install: ClaudeInstall;
  readonly runner: ProcessRunner;
  readonly audit: AuditLog;
  readonly logger: Logger;
}

export class InstallDoctor {
  private readonly install: ClaudeInstall;
  private readonly runner: ProcessRunner;
  private readonly audit: AuditLog;
  private readonly logger: Logger;

  constructor(parts: InstallDoctorParts) {
    this.install = parts.install;
    this.runner = parts.runner;
    this.audit = parts.audit;
    this.logger = parts.logger;
  }

  /**
   * One subscription's installation health.
   *
   * No audit row: this reads and changes nothing, and a row per panel open would bury the rows
   * that matter (SEC-PROC-3 is about mutating actions).
   */
  public async check(subscription: SubscriptionId): Promise<Result<InstallHealth, InstallFailure>> {
    const { executable } = this.install;
    if (executable === undefined) return err('no_claude');
    const result = await this.runner.run({
      command: executable,
      args: ['doctor'],
      env: this.install.envFor(subscription),
      timeoutMs: DOCTOR_TIMEOUT_MS,
    });
    if (result.code !== 0 || result.timedOut) {
      this.logger.warn('doctor_failed', { subscription, code: result.code });
      return err('failed');
    }
    return ok(parseInstallHealth(subscription, result.stdout));
  }

  /**
   * Checks for an update and installs one if there is one.
   *
   * **There is no check-only form** — `claude update --help` says "Check for updates and install if
   * available" and offers no flag (F.10.2) — so pressing this can change the binary every session
   * on the machine then starts. That is why it writes an audit row, and why the deck puts it
   * behind its own button rather than running it when the panel opens.
   */
  public async update(subscription: SubscriptionId): Promise<Result<UpdateResult, InstallFailure>> {
    const { executable } = this.install;
    if (executable === undefined) return this.refuse(subscription, 'no_claude');
    const result = await this.runner.run({
      command: executable,
      args: ['update'],
      env: this.install.envFor(subscription),
      timeoutMs: UPDATE_TIMEOUT_MS,
    });
    if (result.code !== 0 || result.timedOut) {
      this.logger.warn('update_failed', { subscription, code: result.code });
      this.write(
        subscription,
        'failed',
        result.timedOut ? 'timed out' : `exit ${String(result.code)}`,
      );
      return err('failed');
    }
    const parsed = parseUpdateResult(subscription, result.stdout);
    this.logger.info('claude_updated', { subscription, changed: parsed.changed });
    this.write(
      subscription,
      'ok',
      parsed.changed ? `-> ${parsed.version ?? '?'}` : 'already current',
    );
    return ok(parsed);
  }

  private refuse(
    subscription: SubscriptionId,
    failure: InstallFailure,
  ): Result<UpdateResult, InstallFailure> {
    this.write(subscription, 'refused', 'claude.exe not found');
    return err(failure);
  }

  private write(
    subscription: SubscriptionId,
    outcome: 'ok' | 'refused' | 'failed',
    reason: string,
  ): void {
    this.audit.record({
      action: 'update',
      target: subscription,
      args: ['update'],
      outcome,
      reason,
    });
  }
}
