// Stopping a running background session — P4-T2b, the other half of P4-T2a.
//
// **`stop` takes the SHORT id and refuses the full uuid — the exact mirror of `--resume`**
// (RESEARCH.md F.2.8b, measured while restoring a session P4-T2a had woken):
//
//   claude stop cfe7facb-a785-4b2d-...   No job matching '<uuid>'.   exit 1
//   claude stop cfe7facb                 stopped cfe7facb            exit 0
//
// The two verbs disagree about which form of the id they take, in opposite directions, and each
// one's wrong form fails differently — `--resume` with a short id succeeds and forks a copy, `stop`
// with a full uuid fails loudly. So they share no id helper, deliberately: `SessionResumer` screens
// the full uuid and this screens the short one, and neither could be made to serve the other.
//
// **Stopping is not destructive and has no confirmation step.** The session survives, its
// transcript survives, and P4-T2a wakes it again under its own id. `rm` is the verb that deletes
// (F.2.8) and is deliberately absent: it needs a confirm of its own and must not arrive behind a
// button that looks like this one.
import type { AuditOutcome } from '../../contracts/audit-row.ts';
import type { StopFailure } from '../../contracts/launch-reply.ts';
import type { SessionRef } from '../../contracts/session-ref.ts';
import type { ClaudeInstall } from '../adapters/claude-cli/claude-install.ts';
import type { Logger } from '../ports/logger.ts';
import type { ProcessRunner } from '../ports/process-runner.ts';
import { err, ok, type Result } from '../shared/result.ts';
import type { AuditLog } from './audit-log.ts';

export type { StopFailure };

/** F.2.9 measured `stop` at 1.44 s warm. The budget is the daemon being cold, not the verb. */
const STOP_TIMEOUT_MS = 30_000;

export interface SessionStopperParts {
  readonly install: ClaudeInstall;
  readonly runner: ProcessRunner;
  readonly audit: AuditLog;
  readonly logger: Logger;
}

export class SessionStopper {
  private readonly install: ClaudeInstall;
  private readonly runner: ProcessRunner;
  private readonly audit: AuditLog;
  private readonly logger: Logger;

  constructor(parts: SessionStopperParts) {
    this.install = parts.install;
    this.runner = parts.runner;
    this.audit = parts.audit;
    this.logger = parts.logger;
  }

  /**
   * Stops `ref`, and answers its full id so the deck can find the row again.
   *
   * The ref arrives already screened by `parseSessionRefPayload` — both ids, both shapes — so what
   * is left here is the argv and the row. The SHORT id is what goes on the command line, and it is
   * taken from the ref rather than sliced off the uuid: that equality is an observation about how
   * Claude Code names jobs today (F.7.1), and contracts/session-ref.ts already refuses to let the
   * deck guess at it.
   */
  public async stop(ref: SessionRef): Promise<Result<string, StopFailure>> {
    const { executable } = this.install;
    if (executable === undefined) return this.refuse(ref, 'no_claude', 'claude.exe not found');

    const args = ['stop', ref.shortId];
    const result = await this.runner.run({
      command: executable,
      args,
      env: this.install.envFor(ref.subscription),
      timeoutMs: STOP_TIMEOUT_MS,
    });

    if (result.code !== 0 || result.timedOut) {
      this.logger.warn('stop_failed', {
        subscription: ref.subscription,
        session: ref.sessionId,
        code: result.code,
        timedOut: result.timedOut,
      });
      this.write(ref, 'failed', result.timedOut ? 'timed out' : `exit ${String(result.code)}`);
      return err('stop_failed');
    }

    this.logger.info('session_stopped', {
      subscription: ref.subscription,
      session: ref.sessionId,
    });
    this.write(ref, 'ok', undefined);
    return ok(ref.sessionId);
  }

  private refuse(
    ref: SessionRef,
    failure: StopFailure,
    reason: string,
  ): Result<string, StopFailure> {
    this.write(ref, 'refused', reason);
    return err(failure);
  }

  /** The full id is the target, not the short one: the audit table is read against `/sessions`. */
  private write(ref: SessionRef, outcome: AuditOutcome, reason: string | undefined): void {
    this.audit.record({
      action: 'stop',
      target: ref.sessionId,
      args: ['stop'],
      outcome,
      ...(reason === undefined ? {} : { reason }),
    });
  }
}
