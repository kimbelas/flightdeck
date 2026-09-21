// Deleting a background session — P4-T2, and the most destructive verb Flightdeck exposes.
//
// **`rm` deletes a LIVE session without asking.** F.2.8 measured `claude rm <live-id>` printing
// `removed <id>` with no confirmation and no refusal, and deleting `jobs/<id>/` with it. Nothing
// resumes afterwards; the conversation is gone. That is why this class exists separately from
// `SessionStopper` rather than as a second method on it, and why the deck puts a confirm step in
// front of it — the roadmap task says in as many words that it must not arrive behind a button
// that looks like `stop`.
//
// **It takes the SHORT id and refuses the full uuid** — the same way round as `stop`, measured in
// P4-T2 (RESEARCH.md F.8.4):
//
//   claude rm fe534daf-100b-4797-a59f-ca0714840328   No job matching '<uuid>'   exit 1, 0.44 s
//   claude rm fe534daf                               removed fe534daf           exit 0, 0.88 s
//   claude rm fe534daf   (again)                     No job matching            exit 1
//
// So three of the four verbs now have a measured id form and they do not agree: `--resume` wants
// the full uuid and FORKS on a short one, `stop` and `rm` want the short one and fail loudly on a
// uuid. The short id is TAKEN from the `SessionRef` rather than sliced off the uuid, for
// `SessionStopper`'s reason — contracts/session-ref.ts refuses to let the deck guess at a value
// that names a job directory (F.7.1).
//
// **The audit row is the point, not a formality.** SEC-PROC-3 exists for exactly this verb: it is
// the only action Flightdeck takes that destroys something, and the row is the only record that it
// was Flightdeck that took it — `daemon.log` cannot tell a deletion from a session that ended
// (F.2.3).
import type { AuditOutcome } from '../../contracts/audit-row.ts';
import type { RemoveFailure } from '../../contracts/launch-reply.ts';
import type { SessionRef } from '../../contracts/session-ref.ts';
import type { ClaudeInstall } from '../adapters/claude-cli/claude-install.ts';
import type { Logger } from '../ports/logger.ts';
import type { ProcessRunner } from '../ports/process-runner.ts';
import { err, ok, type Result } from '../shared/result.ts';
import type { AuditLog } from './audit-log.ts';

export type { RemoveFailure };

/** F.8.4 measured `rm` at 0.88 s warm. The budget is the daemon being cold, not the verb. */
const REMOVE_TIMEOUT_MS = 30_000;

export interface SessionRemoverParts {
  readonly install: ClaudeInstall;
  readonly runner: ProcessRunner;
  readonly audit: AuditLog;
  readonly logger: Logger;
}

export class SessionRemover {
  private readonly install: ClaudeInstall;
  private readonly runner: ProcessRunner;
  private readonly audit: AuditLog;
  private readonly logger: Logger;

  constructor(parts: SessionRemoverParts) {
    this.install = parts.install;
    this.runner = parts.runner;
    this.audit = parts.audit;
    this.logger = parts.logger;
  }

  /**
   * Deletes `ref`, and answers its full id so the deck can drop the row.
   *
   * It runs `claude.exe` directly rather than through a profile function, unlike a launch. That is
   * not an inconsistency with D4: the profile exists to decide which MODEL and which account a new
   * session runs under, and a deletion starts nothing — the account is already fixed by the ref,
   * and going through PowerShell would add a shell and 400 ms to a verb that needs neither. The
   * same reading `SessionStopper` and `SessionResumer` already take.
   *
   * **No confirmation is asked for here, deliberately.** A use case that prompted would be a use
   * case that cannot be called from a script, and the confirm belongs where the person is — the
   * deck's two-step button (`SessionRowCard`). What this class owes is the audit row.
   */
  public async remove(ref: SessionRef): Promise<Result<string, RemoveFailure>> {
    const { executable } = this.install;
    if (executable === undefined) return this.refuse(ref, 'no_claude', 'claude.exe not found');

    const args = ['rm', ref.shortId];
    const result = await this.runner.run({
      command: executable,
      args,
      env: this.install.envFor(ref.subscription),
      timeoutMs: REMOVE_TIMEOUT_MS,
    });

    if (result.code !== 0 || result.timedOut) {
      this.logger.warn('remove_failed', {
        subscription: ref.subscription,
        session: ref.sessionId,
        code: result.code,
        timedOut: result.timedOut,
      });
      this.write(ref, 'failed', result.timedOut ? 'timed out' : `exit ${String(result.code)}`);
      return err('remove_failed');
    }

    this.logger.info('session_removed', {
      subscription: ref.subscription,
      session: ref.sessionId,
    });
    this.write(ref, 'ok', undefined);
    return ok(ref.sessionId);
  }

  private refuse(
    ref: SessionRef,
    failure: RemoveFailure,
    reason: string,
  ): Result<string, RemoveFailure> {
    this.write(ref, 'refused', reason);
    return err(failure);
  }

  /** The full id is the target, not the short one: the audit table is read against `/sessions`. */
  private write(ref: SessionRef, outcome: AuditOutcome, reason: string | undefined): void {
    this.audit.record({
      action: 'rm',
      target: ref.sessionId,
      args: ['rm'],
      outcome,
      ...(reason === undefined ? {} : { reason }),
    });
  }
}
