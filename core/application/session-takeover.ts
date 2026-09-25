// Moving a LIVE interactive session into Flightdeck — P6-T8, D63.
//
// P6-T7 gave the deck SPEC §4.3's migration path: close the terminal, and the row offers `adopt`.
// This is the same path in one press. It ends the terminal's `claude.exe`, which is what closing
// the terminal did, and then adopts the conversation exactly as `SessionAdopter` does — `--bg
// --resume <uuid>` in the folder the session was working in. Measured end to end on a throwaway
// session (RESEARCH.md G.60): the listing forgets the session the moment its process is gone, and
// the adoption answers `backgrounded · <short> (idle — send a prompt to start)` under the same id.
//
// **This is the one place core ends a process it did not start, which SEC-PROC-5 otherwise
// forbids.** D63 is the argument for the exception, and these are its limits, each one a refusal
// below:
//
//   - The pid comes from `claude agents --json`, read at the moment of the press — never from the
//     request, and never from a sweep that may be ten seconds old (`LiveSessionLookup`).
//   - Only an INTERACTIVE session. A background one is already attachable, and its process
//     belongs to the daemon.
//   - Only an IDLE one. A busy session is mid-turn, and ending it would cut that turn off. The
//     listing's `status` is the reading; anything but `idle` refuses, including no status at all.
//   - Only `claude.exe`. `ProcessEnder` filters on the image name, so a pid Windows reissued in
//     the second between the listing and the kill is left alone.
//
// The deck asks for a second press before it sends this, as it does for `rm`: the terminal it
// ends is somebody's open window, and it does not come back.
import type { AuditOutcome } from '../../contracts/audit-row.ts';
import { isFullSessionId } from '../../contracts/pty-protocol.ts';
import type { TakeoverFailure } from '../../contracts/launch-reply.ts';
import type { SubscriptionId } from '../../contracts/session.ts';
import type { ClaudeInstall } from '../adapters/claude-cli/claude-install.ts';
import type { LiveSessionLookup } from '../ports/live-session-lookup.ts';
import type { Logger } from '../ports/logger.ts';
import type { ProcessEnder } from '../ports/process-ender.ts';
import { err, ok, type Result } from '../shared/result.ts';
import type { AuditLog } from './audit-log.ts';
import type { AdoptRequest, SessionAdopter } from './session-adopter.ts';

export type { TakeoverFailure };

export interface TakeoverRequest {
  readonly subscription: SubscriptionId;
  /** FULL uuid, for the adoption at the end — a short one would start a copy (F.2.7). */
  readonly sessionId: string;
}

export interface SessionTakeoverParts {
  readonly install: ClaudeInstall;
  readonly lookup: LiveSessionLookup;
  readonly ender: ProcessEnder;
  /** The adoption at the end. `adoptAt` rather than `adopt` — see that method for why. */
  readonly adopter: Pick<SessionAdopter, 'adoptAt'>;
  readonly audit: AuditLog;
  readonly logger: Logger;
}

export class SessionTakeover {
  private readonly parts: SessionTakeoverParts;

  constructor(parts: SessionTakeoverParts) {
    this.parts = parts;
  }

  /**
   * Ends the session's terminal process and brings the conversation back as a background session.
   *
   * @returns the id it was given, as an adoption does — it is the same session afterwards.
   *
   * Writes one `takeover` audit row on every path out (SEC-PROC-3), and a successful end is
   * followed by the adoption's own `adopt` row: two actions happened, and the log says both. The
   * pid is in the argv of the row that ended it, which is what somebody reading the log afterwards
   * needs in order to tell which window closed. A refusal ended nothing and records no argv.
   */
  public async takeOver(request: TakeoverRequest): Promise<Result<string, TakeoverFailure>> {
    if (this.parts.install.executable === undefined) {
      return this.refuse(request, 'no_claude', 'claude.exe not found');
    }
    if (!isFullSessionId(request.sessionId)) {
      return this.refuse(request, 'bad_session', 'not a full lowercase session uuid');
    }

    const found = await this.parts.lookup.find(request.subscription, request.sessionId);
    // An unreadable listing is not "it ended": nothing is known, so nothing is ended.
    if (!found.ok) return this.refuse(request, 'not_running', 'listing unreadable');
    const record = found.value;
    if (record?.pid === undefined) return this.refuse(request, 'not_running', 'no live process');
    // `kind` absent is read as interactive everywhere else (`ClaudeCliSessionSource`), because that
    // is the kind Flightdeck refuses to attach. HERE the safe reading is the opposite — ending a
    // process is the dangerous direction — so only an explicit `interactive` is taken over.
    if (record.kind !== 'interactive') {
      return this.refuse(request, 'not_interactive', 'not an interactive session');
    }
    if (record.status !== 'idle') return this.refuse(request, 'busy', 'session is not idle');
    const cwd = record.cwd ?? '';
    // Checked BEFORE the kill: a session that cannot be adopted must not lose its terminal first.
    if (cwd === '') return this.refuse(request, 'no_folder', 'no folder known');

    return this.move(request, record.pid, cwd);
  }

  /** The two steps, split from the refusals so those read as one list — `SessionAdopter`'s shape. */
  private async move(
    request: TakeoverRequest,
    pid: number,
    cwd: string,
  ): Promise<Result<string, TakeoverFailure>> {
    const ended = await this.parts.ender.end(pid);
    if (!ended) {
      this.parts.logger.warn('takeover_end_failed', { session: request.sessionId, pid });
      this.write(request, 'failed', 'still running after taskkill', pid);
      return err('end_failed');
    }
    this.write(request, 'ok', undefined, pid);

    const adoption: AdoptRequest = request;
    const adopted = await this.parts.adopter.adoptAt(adoption, cwd);
    if (!adopted.ok) {
      // The terminal is gone and the adoption failed, so the row becomes an ENDED interactive
      // session on the next sweep — and that row offers `adopt`, which is the retry. Nothing is
      // lost but the one click.
      this.parts.logger.warn('takeover_adopt_failed', { session: request.sessionId });
      return err('adopt_failed');
    }
    this.parts.logger.info('session_taken_over', {
      subscription: request.subscription,
      session: request.sessionId,
    });
    return ok(adopted.value);
  }

  private refuse(
    request: TakeoverRequest,
    failure: TakeoverFailure,
    reason: string,
  ): Result<string, TakeoverFailure> {
    this.write(request, 'refused', reason);
    return err(failure);
  }

  /**
   * The row. `args` is taskkill's argv as `TaskkillProcessEnder` runs it, pid included, and empty
   * on a refusal — contracts/audit-row.ts wants the command as run, and a refusal ran none.
   */
  private write(
    request: TakeoverRequest,
    outcome: AuditOutcome,
    reason: string | undefined,
    pid?: number,
  ): void {
    this.parts.audit.record({
      action: 'takeover',
      target: request.sessionId,
      args:
        pid === undefined
          ? []
          : ['/PID', String(pid), '/FI', 'IMAGENAME eq claude.exe', '/T', '/F'],
      outcome,
      ...(reason === undefined ? {} : { reason }),
    });
  }
}
