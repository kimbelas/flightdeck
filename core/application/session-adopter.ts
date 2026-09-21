// Adopting a session that was started outside Flightdeck — P6-T7, SPEC §4.3, RESEARCH.md G.55.
//
// SPEC's line is *"Sessions started outside Flightdeck are visible with full vitals but read-only —
// interactive sessions cannot be attached. When one exits, the deck offers to adopt it
// (`--bg --resume`). This is the migration path to F7, not a limitation to hide."* This is that
// offer: the conversation comes back as a background job under its own id, and a background job is
// one the deck can put in a pane.
//
// **The argv is `--bg --resume <full-uuid>` and NOTHING else** — `SessionResumer`'s argv exactly,
// and for the same measured reason. On 2.1.278 the binary now says it in words when you get it
// wrong: *"background session 22147988 keeps its own saved options, so the flags you passed
// started a copy as ab17fd7a. Without flags, the same command continues 22147988 itself."* So
// there is no `-n` here and there cannot be, which costs the session its name — see `adopt`.
//
// **The folder comes from core's own reading, never from the browser.** That is the one thing
// this class does that `SessionResumer` does not, and G.55 is why: a session with no `--bg`
// history has no saved options, so the adopted session runs in the PROCESS cwd. Core's own cwd is
// not where that terminal was, and a session that silently changed folder is P6-T1's "the one
// failure a terminal must not have". A resumed BACKGROUND session keeps its saved cwd and needs
// none of this, which is why `SessionResumer` is correct as it stands and was left alone.
//
// **A separate class from `SessionResumer`, and the argv being identical is the argument FOR the
// split rather than against it.** They answer different questions: a resume wakes a background job
// that is still listed and still remembers where it ran, and an adoption takes a session the
// listing has already forgotten and has to be told where it was. One class doing both would need a
// parameter that means "look this up" and a caller that knows when to pass it.
import type { AuditOutcome } from '../../contracts/audit-row.ts';
import { isFullSessionId } from '../../contracts/pty-protocol.ts';
import type { AdoptFailure } from '../../contracts/launch-reply.ts';
import type { SessionRow } from '../../contracts/session-row.ts';
import type { SubscriptionId } from '../../contracts/session.ts';
import type { ClaudeInstall } from '../adapters/claude-cli/claude-install.ts';
import type { Logger } from '../ports/logger.ts';
import type { ProcessRunner } from '../ports/process-runner.ts';
import { err, ok, type Result } from '../shared/result.ts';
import type { AuditLog } from './audit-log.ts';

export type { AdoptFailure };

export interface AdoptRequest {
  readonly subscription: SubscriptionId;
  /** FULL uuid. A short one would start a copy rather than the session (F.2.7, G.55). */
  readonly sessionId: string;
}

/**
 * Where core last saw a session — P6-T7.
 *
 * One method wearing an interface, `SessionForker`'s reason: this class needs the folder and
 * nothing else, and taking the whole `Reconciler` would make a spawn depend on the timer, the
 * watcher and the event sink.
 */
export interface SessionDirectory {
  rowFor(subscription: SubscriptionId, sessionId: string): SessionRow | undefined;
}

/** F.2.9's budget, as a resume's: a cold daemon start is 5.4 s and a warm `--bg` 1.3–2.0 s. */
const ADOPT_TIMEOUT_MS = 60_000;

export interface SessionAdopterParts {
  readonly install: ClaudeInstall;
  readonly sessions: SessionDirectory;
  readonly runner: ProcessRunner;
  readonly audit: AuditLog;
  readonly logger: Logger;
}

export class SessionAdopter {
  private readonly parts: SessionAdopterParts;

  constructor(parts: SessionAdopterParts) {
    this.parts = parts;
  }

  /**
   * Brings `sessionId` back as a background session, in the folder it was working in.
   *
   * @returns the same id it was given, as a resume does — an adoption keeps the id, which is what
   * makes it an adoption rather than a copy (G.55). Nothing is parsed out of stdout for that
   * reason: reading a different id back would mean reporting on a fork we had just made by
   * accident, and the point of the argv is that we cannot.
   *
   * **The name is lost and that is not a bug here to fix.** `-n` would keep it and `-n` forks, so
   * the adopted session is called after its own short id until somebody renames it. The deck says
   * so on the button; silently making a second session would be the worse of the two.
   *
   * Writes exactly one audit row on every path out, refusals included (SEC-PROC-3). The argv is
   * safe to record in full: two flags and an id the deck already has, no prompt and no name.
   */
  public async adopt(request: AdoptRequest): Promise<Result<string, AdoptFailure>> {
    const { executable } = this.parts.install;
    if (executable === undefined) return this.refuse(request, 'no_claude', 'claude.exe not found');
    // F.2.7's control rather than input hygiene: a short id does not fail, it starts a copy.
    if (!isFullSessionId(request.sessionId)) {
      return this.refuse(request, 'bad_session', 'not a full lowercase session uuid');
    }

    const row = this.parts.sessions.rowFor(request.subscription, request.sessionId);
    // Not "unknown session": core has no memory of it, which after a restart is the ordinary
    // reason and is a different thing from the id being wrong.
    if (row === undefined) return this.refuse(request, 'not_adoptable', 'no row for that session');
    // Only an ENDED interactive session. A live one is somebody's open terminal, and adopting it
    // would start a second process against a conversation already being typed into; a background
    // session is already what an adoption produces, and `resume` is its verb.
    if (row.kind !== 'interactive') return this.refuse(request, 'not_adoptable', 'not interactive');
    if (row.live) return this.refuse(request, 'still_running', 'terminal still open');
    // The folder is core's own reading. An empty one is a row the listing gave no cwd, and running
    // in core's directory instead would be the silent folder change this class exists to prevent.
    if (row.cwd === '') return this.refuse(request, 'not_adoptable', 'no folder known');

    return this.wake(request, executable, row.cwd);
  }

  /**
   * The spawn.
   *
   * Split from `adopt` so the refusals above read as one list: everything before this point
   * decides whether an adoption may happen, and this is it happening.
   */
  private async wake(
    request: AdoptRequest,
    executable: string,
    cwd: string,
  ): Promise<Result<string, AdoptFailure>> {
    const result = await this.parts.runner.run({
      command: executable,
      args: ['--bg', '--resume', request.sessionId],
      env: this.parts.install.envFor(request.subscription),
      // The measurement this class rests on: a session with no `--bg` history has no saved cwd,
      // so without this the adopted session runs wherever core happens to be (G.55).
      cwd,
      timeoutMs: ADOPT_TIMEOUT_MS,
    });

    if (result.code !== 0 || result.timedOut) {
      this.parts.logger.warn('adopt_failed', {
        subscription: request.subscription,
        session: request.sessionId,
        code: result.code,
        timedOut: result.timedOut,
      });
      this.write(request, 'failed', result.timedOut ? 'timed out' : `exit ${String(result.code)}`);
      return err('adopt_failed');
    }

    this.parts.logger.info('session_adopted', {
      subscription: request.subscription,
      session: request.sessionId,
    });
    this.write(request, 'ok', undefined);
    return ok(request.sessionId);
  }

  private refuse(
    request: AdoptRequest,
    failure: AdoptFailure,
    reason: string,
  ): Result<string, AdoptFailure> {
    this.write(request, 'refused', reason);
    return err(failure);
  }

  private write(request: AdoptRequest, outcome: AuditOutcome, reason: string | undefined): void {
    this.parts.audit.record({
      action: 'adopt',
      target: request.sessionId,
      args: ['--bg', '--resume'],
      outcome,
      ...(reason === undefined ? {} : { reason }),
    });
  }
}
