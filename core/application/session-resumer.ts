// Waking a stopped background session — P4-T2a, and the narrow half of P4-T2.
//
// Most rows in the deck are background sessions that have finished, and every one of them said
// "Not running. Resume it to attach." with nothing to press. This is the press. The rest of
// P4-T2 — presets, the PowerShell profile functions, quota-aware routing — is untouched: waking a
// session needs none of it, because it is one argv with one argument in it.
//
// **The argv is `--bg --resume <full lowercase uuid>` and NOTHING else, and that is measured**
// (RESEARCH.md F.2.7). Every other spelling silently forks:
//
//   `--bg --resume <shortId> "<prompt>"`          copy under a new id, name lost
//   `--bg --resume <full-uuid> -n <name> ...`     copy — ANY extra flag forks it
//   `--bg --resume <full-uuid>`                   wakes it under its own id, saved options restored
//
// So the shape check on the id is not input hygiene, it is the control: a short id does not fail,
// it quietly makes a second session. And there is no prompt argument here on purpose — F.2.7 says
// the prompt goes in after the wake, which for Flightdeck means the owner types it into the pane.
//
// A separate class from `SessionLauncher` rather than a method on it. They share three ports and
// nothing else: launch builds a session out of a prompt and has to find the new id in stdout,
// resume names a session that already exists and already knows its id. One class doing both would
// be two verbs sharing a name.
import type { AuditOutcome } from '../../contracts/audit-row.ts';
import { isFullSessionId } from '../../contracts/pty-protocol.ts';
import type { ResumeFailure } from '../../contracts/launch-reply.ts';
import type { SubscriptionId } from '../../contracts/session.ts';
import type { ClaudeInstall } from '../adapters/claude-cli/claude-install.ts';
import type { Logger } from '../ports/logger.ts';
import type { ProcessRunner } from '../ports/process-runner.ts';
import { err, ok, type Result } from '../shared/result.ts';
import type { AuditLog } from './audit-log.ts';

export type { ResumeFailure };

export interface ResumeRequest {
  readonly subscription: SubscriptionId;
  readonly sessionId: string;
}

/** F.2.9 measured a warm `--bg` at 1.3–2.0 s and a cold daemon start at 5.4 s. */
const RESUME_TIMEOUT_MS = 60_000;

export interface SessionResumerParts {
  readonly install: ClaudeInstall;
  readonly runner: ProcessRunner;
  readonly audit: AuditLog;
  readonly logger: Logger;
}

export class SessionResumer {
  private readonly install: ClaudeInstall;
  private readonly runner: ProcessRunner;
  private readonly audit: AuditLog;
  private readonly logger: Logger;

  constructor(parts: SessionResumerParts) {
    this.install = parts.install;
    this.runner = parts.runner;
    this.audit = parts.audit;
    this.logger = parts.logger;
  }

  /**
   * Wakes `sessionId` under its own id, and answers that same id.
   *
   * The id it returns is deliberately the one it was GIVEN rather than anything parsed out of
   * stdout. That is the whole promise of F.2.7's third row — a correct resume keeps the id — so
   * reading a different one back out of the output would be reporting on a fork we just made.
   *
   * Writes exactly one audit row on every path out, including both refusals (SEC-PROC-3). The argv
   * is safe to record in full here, unlike a launch's: it carries no prompt and no name, only the
   * two flags and an id the deck already has.
   */
  public async resume(request: ResumeRequest): Promise<Result<string, ResumeFailure>> {
    const { executable } = this.install;
    if (executable === undefined) return this.refuse(request, 'no_claude', 'claude.exe not found');
    // The control, not the validation — see the header. A short id would wake a COPY.
    if (!isFullSessionId(request.sessionId)) {
      return this.refuse(request, 'bad_session', 'not a full lowercase session uuid');
    }

    const args = ['--bg', '--resume', request.sessionId];
    const result = await this.runner.run({
      command: executable,
      args,
      env: this.install.envFor(request.subscription),
      timeoutMs: RESUME_TIMEOUT_MS,
    });

    if (result.code !== 0 || result.timedOut) {
      this.logger.warn('resume_failed', {
        subscription: request.subscription,
        session: request.sessionId,
        code: result.code,
        timedOut: result.timedOut,
      });
      this.write(request, 'failed', result.timedOut ? 'timed out' : `exit ${String(result.code)}`);
      return err('resume_failed');
    }

    this.logger.info('session_resumed', {
      subscription: request.subscription,
      session: request.sessionId,
    });
    this.write(request, 'ok', undefined);
    return ok(request.sessionId);
  }

  private refuse(
    request: ResumeRequest,
    failure: ResumeFailure,
    reason: string,
  ): Result<string, ResumeFailure> {
    this.write(request, 'refused', reason);
    return err(failure);
  }

  private write(request: ResumeRequest, outcome: AuditOutcome, reason: string | undefined): void {
    this.audit.record({
      action: 'resume',
      target: request.sessionId,
      args: ['--bg', '--resume'],
      outcome,
      ...(reason === undefined ? {} : { reason }),
    });
  }
}
