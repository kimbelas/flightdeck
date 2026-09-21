// Handing a session to Windows Terminal — P6-T2, SPEC §5.7(4), and detaching first.
//
// **Detaching first is the whole of it.** `claude attach` is last-one-wins: F.2.6 measured that a
// second attach is accepted and the first is EVICTED, exiting cleanly ~2.4 s later. So a pop-out
// that just opened a terminal would silently steal the pane, and the pane would report an exit
// code 0 it cannot tell apart from the session ending. `PaneRegistry` knows who holds what
// (SEC-WS-3), so the hold is released here, before the terminal is asked for — and the order is
// not a nicety: reversed, the two attaches race and the survivor is whichever won.
//
// **Releasing the pane is not stopping the session.** F.2.6 also measured that every session keeps
// its pid across a killed attach, which is what the P5a gate rests on. The pane card goes away;
// the conversation does not.
//
// **The reply says opened, not attached.** What core can answer for is that Windows Terminal was
// started. Whether `claude attach` then found the job happens in a window core does not own, and
// claiming otherwise would be the third button this project has caught lying about an outcome.
import type { AuditOutcome } from '../../contracts/audit-row.ts';
import type { PopoutFailure } from '../../contracts/launch-reply.ts';
import type { PtyTarget } from '../../contracts/pty-protocol.ts';
import type { SessionRef } from '../../contracts/session-ref.ts';
import type { Logger } from '../ports/logger.ts';
import type { ProcessRunner } from '../ports/process-runner.ts';
import type { TerminalCommands } from '../ports/terminal-commands.ts';
import { err, ok, type Result } from '../shared/result.ts';
import type { AuditLog } from './audit-log.ts';

export type { PopoutFailure };

/** Measured at 1.09 s for `wt -w 0 nt` returning while the tab lives on (G.50). This is room. */
const POPOUT_TIMEOUT_MS = 20_000;

/**
 * The one method of `PaneRegistry` this needs.
 *
 * A port of its own, so a test of "it detaches before it opens" owns neither a ConPTY nor an AppX
 * package — and so the dependency reads in the right direction: the popper asks for a release, it
 * does not reach into the registry's map.
 */
export interface PaneHolders {
  /** Closes the pane holding this target, if one does. @returns whether one was released. */
  releaseFor(target: PtyTarget): boolean;
}

/** What the caller knows about the session, beyond its id. Both come off the row on screen. */
export interface PopoutRequest {
  readonly ref: SessionRef;
  readonly title: string;
  readonly cwd: string | undefined;
}

export interface SessionPopperParts {
  readonly terminals: TerminalCommands;
  readonly panes: PaneHolders;
  readonly runner: ProcessRunner;
  readonly audit: AuditLog;
  readonly logger: Logger;
}

export class SessionPopper {
  private readonly parts: SessionPopperParts;

  constructor(parts: SessionPopperParts) {
    this.parts = parts;
  }

  /**
   * Detaches the pane, then opens the terminal.
   *
   * @returns whether a pane was released, so the deck can say "detached and popped out" rather
   * than guessing. `no_terminal` when Windows Terminal or Claude Code is not installed here.
   */
  public async popOut(request: PopoutRequest): Promise<Result<boolean, PopoutFailure>> {
    const { ref, title, cwd } = request;
    // BEFORE the spawn. A terminal that attached while the pane still held the session would evict
    // it, and the eviction is silent at the CLI (F.2.6).
    const detached = this.parts.panes.releaseFor(targetOf(ref));

    const spec = { shortId: ref.shortId, subscription: ref.subscription, title, cwd };
    const command = await this.parts.terminals.popout(spec);
    if (command === undefined) return this.refuse(ref, 'no_terminal');

    const result = await this.parts.runner.run({ ...command, timeoutMs: POPOUT_TIMEOUT_MS });
    if (result.code !== 0 || result.timedOut) {
      this.parts.logger.warn('popout_failed', { session: ref.shortId, code: result.code });
      return this.refuse(ref, 'popout_failed');
    }

    this.record(ref, 'ok');
    this.parts.logger.info('popped_out', { session: ref.shortId, detached });
    return ok(detached);
  }

  private refuse(ref: SessionRef, failure: PopoutFailure): Result<boolean, PopoutFailure> {
    this.record(ref, failure === 'no_terminal' ? 'refused' : 'failed');
    return err(failure);
  }

  /** SEC-PROC-3: every mutating action writes a row, and this one starts a process. */
  private record(ref: SessionRef, outcome: AuditOutcome): void {
    this.parts.audit.record({
      action: 'session.popout',
      target: ref.sessionId,
      args: [ref.subscription],
      outcome,
    });
  }
}

/** The pane target this session would be held under — `PaneRegistry`'s own key, by its own type. */
function targetOf(ref: SessionRef): PtyTarget {
  return { kind: 'session', sessionId: ref.sessionId, subscription: ref.subscription };
}
