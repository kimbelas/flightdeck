// Handing a conversation to a new working tree — P6-T6, SPEC §6(8), RESEARCH.md G.54.
//
// SPEC's line is *"Session handoff — resume in a new worktree with `--resume --fork-session`"*, and
// the thing it is for is the moment a session has worked something out and you want to try the next
// idea without losing what it knows. A fork keeps the conversation and takes a new id; the original
// is untouched and can be resumed later as if nothing happened.
//
// **The argv is `--bg --resume <full-uuid> --fork-session -n <name>`, and all four parts were
// measured before this class existed** (G.54). F.2.7 had said "any extra flag forks it" on binary
// 2.1.268, which would have made this a game of picking a flag; on 2.1.278 `--fork-session` is
// documented and `-n` names the fork rather than accidentally causing it.
//
// **The fork runs in the PROCESS cwd.** That is the measurement the whole feature rested on: had a
// resume restored the original session's directory, a handoff would have silently opened in the old
// tree, which is P6-T1's "the one failure a terminal must not have". It does not — so the worktree
// is passed as the cwd, exactly as a launch passes one.
//
// **The new id comes out of STDOUT and is not the one we were given.** A resume answers with the id
// it was handed because a correct resume keeps it (`SessionResumer`); a fork cannot, because the
// whole point is that there is now a second session. It is parsed the way `SessionLauncher` parses
// a launch's.
//
// **The target is screened, and by the registry rather than here.** `resolveDirectory` is the one
// that admits a worktree — `resolveRoot` refuses anything below a project and `ReadPolicy` refuses
// directories outright, and G.26 and G.28 each cost a live bug to learn that loosening either of
// those is the wrong way to reach one. Nothing about a handoff widens what core may touch.
//
// **It does not CREATE the worktree.** `git worktree add` is a second process, a second class of
// failure and a branch name to invent, and a handoff into a tree that already exists is the whole
// of what SPEC asks for. The deck offers the worktrees `WorktreeReader` already found (P3-T4).
import type { AuditOutcome } from '../../contracts/audit-row.ts';
import { isFullSessionId } from '../../contracts/pty-protocol.ts';
import type { HandoffFailure } from '../../contracts/launch-reply.ts';
import type { SubscriptionId } from '../../contracts/session.ts';
import type { ClaudeInstall } from '../adapters/claude-cli/claude-install.ts';
import type { Logger } from '../ports/logger.ts';
import type { ProcessRunner } from '../ports/process-runner.ts';
import { err, ok, type Result } from '../shared/result.ts';
import type { AuditLog } from './audit-log.ts';
import type { ProjectRegistry } from './project-registry.ts';

export type { HandoffFailure };

export interface HandoffRequest {
  readonly subscription: SubscriptionId;
  /** The session being handed off. FULL uuid — a short one forks something else (F.2.7). */
  readonly sessionId: string;
  /** Where the fork is to run. Screened by `resolveDirectory`; must be inside an imported project. */
  readonly cwd: string;
  /** What to call the fork. Without it both sessions wear the original's name (G.54). */
  readonly name: string;
}

/** F.2.9's budget, as a resume's: a cold daemon start is 5.4 s and a warm `--bg` 1.3–2.0 s. */
const HANDOFF_TIMEOUT_MS = 60_000;

/** Long enough to say what the fork is for, short enough to read in a row. `-n`'s own cap. */
const MAX_NAME_CHARS = 80;

/**
 * The id `--bg` prints, as `SessionLauncher` reads one.
 *
 * Eight hex characters after `backgrounded ·`, which is what the CLI actually emits. A fork that
 * printed nothing this matches is `no_session_id` rather than a failure: the session may well
 * exist, and telling the owner it failed is how they make a second one.
 */
const PRINTED_ID = /\b([0-9a-f]{8})\b/u;

export interface SessionHandoffParts {
  readonly install: ClaudeInstall;
  readonly registry: ProjectRegistry;
  readonly runner: ProcessRunner;
  readonly audit: AuditLog;
  readonly logger: Logger;
}

export class SessionHandoff {
  private readonly parts: SessionHandoffParts;

  constructor(parts: SessionHandoffParts) {
    this.parts = parts;
  }

  /**
   * Forks `sessionId` into `cwd` under `name`, and answers with the NEW session's short id.
   *
   * The original is not touched: it keeps its id, its name and its conversation, and can be resumed
   * afterwards as if this had not happened. That is what makes a handoff safe to press — it is the
   * one verb in the deck that adds a session without being able to lose one.
   *
   * Writes exactly one audit row on every path out, refusals included (SEC-PROC-3). The argv is
   * recorded without the name: it is the owner's own text, and the one place the "record the argv"
   * rule bends is the fields that carry that into a table kept forever (SEC-DATA-2).
   */
  public async handOff(request: HandoffRequest): Promise<Result<string, HandoffFailure>> {
    const { executable } = this.parts.install;
    if (executable === undefined) return this.refuse(request, 'no_claude', 'claude.exe not found');
    // F.2.7's control rather than input hygiene: a short id does not fail, it forks something else.
    if (!isFullSessionId(request.sessionId)) {
      return this.refuse(request, 'bad_session', 'not a full lowercase session uuid');
    }
    // Trimmed HERE and not only in the route, so the class is right when it is called directly.
    // A name with a space on each end is a different row in the deck from the same name without.
    const name = request.name.trim();
    if (!isSaneName(name)) return this.refuse(request, 'bad_name', 'name out of range');

    // The registry's screen, not this class's. It is the only one that admits a worktree.
    const resolved = await this.parts.registry.resolveDirectory(request.cwd);
    if (!resolved.ok) return this.refuse(request, 'bad_cwd', resolved.error);

    return this.fork(request, { executable, name, cwd: resolved.value });
  }

  /**
   * The spawn, and reading the new id back out of it.
   *
   * Split from `handOff` so that the refusals above read as one list: everything before this point
   * decides whether a fork may happen, and everything here is the fork happening.
   */
  private async fork(
    request: HandoffRequest,
    spec: { readonly executable: string; readonly name: string; readonly cwd: string },
  ): Promise<Result<string, HandoffFailure>> {
    const result = await this.parts.runner.run({
      command: spec.executable,
      args: ['--bg', '--resume', request.sessionId, '--fork-session', '-n', spec.name],
      env: this.parts.install.envFor(request.subscription),
      // The measurement this whole class rests on: the fork runs HERE, not where the original did.
      cwd: spec.cwd,
      timeoutMs: HANDOFF_TIMEOUT_MS,
    });

    if (result.code !== 0 || result.timedOut) {
      this.parts.logger.warn('handoff_failed', {
        subscription: request.subscription,
        session: request.sessionId,
        code: result.code,
        timedOut: result.timedOut,
      });
      this.write(request, 'failed', result.timedOut ? 'timed out' : `exit ${String(result.code)}`);
      return err('handoff_failed');
    }

    const forked = PRINTED_ID.exec(result.stdout)?.[1];
    if (forked === undefined) {
      // Its own code, as a launch's is: exit 0 means a fork may well exist, and "it failed" is how
      // the owner ends up with two (contracts/launch-reply.ts).
      this.parts.logger.warn('handoff_id_not_found', { session: request.sessionId });
      this.write(request, 'failed', 'no session id in output');
      return err('no_session_id');
    }

    this.parts.logger.info('session_handed_off', {
      subscription: request.subscription,
      from: request.sessionId,
      to: forked,
    });
    this.write(request, 'ok', undefined, forked);
    return ok(forked);
  }

  private refuse(
    request: HandoffRequest,
    failure: HandoffFailure,
    reason: string,
  ): Result<string, HandoffFailure> {
    this.write(request, 'refused', reason);
    return err(failure);
  }

  private write(
    request: HandoffRequest,
    outcome: AuditOutcome,
    reason: string | undefined,
    forked?: string,
  ): void {
    this.parts.audit.record({
      action: 'handoff',
      target: request.sessionId,
      // No name: it is the owner's own text (SEC-DATA-2). The new id is the fact worth keeping.
      args: ['--bg', '--resume', '--fork-session', ...(forked === undefined ? [] : [forked])],
      outcome,
      ...(reason === undefined ? {} : { reason }),
    });
  }
}

function isSaneName(name: string): boolean {
  return name.length > 0 && name.length <= MAX_NAME_CHARS;
}
