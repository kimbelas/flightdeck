// Restarting a background session so it picks up the current binary — P4-T5.
//
// **`respawn` takes the SHORT id and refuses the full uuid** (RESEARCH.md F.10.3), which makes it
// the fourth verb with a measured id form and the third to agree:
//
//   claude respawn 26b03f93                                    respawned 26b03f93   exit 0, 1.96 s
//   claude respawn 26b03f93-0000-0000-0000-000000000000        No job matching      exit 1
//
// So `stop`, `rm` and `respawn` all want the short id and fail loudly on a uuid, and `--resume`
// wants the full uuid and FORKS SILENTLY on a short one (F.2.7). Four verbs, two rules, and the
// odd one out is the only one that fails quietly — which is still why there is no shared id helper.
//
// **`--all` does not mean all, and the deck must not say it does.** Measured with two background
// sessions present, one `blocked` and one `done`, `respawn --all` printed `respawned d1b2f43c` and
// left the other alone (F.10.4) — while respawning that same session by name worked. A button
// labelled "respawn all" would therefore be a button that quietly skips whatever has finished, so
// the reply carries the ids the CLI actually named and the deck reports those rather than a count
// it assumed.
import type { SessionRef } from '../../contracts/session-ref.ts';
import type { SubscriptionId } from '../../contracts/session.ts';
import type { ClaudeInstall } from '../adapters/claude-cli/claude-install.ts';
import type { Logger } from '../ports/logger.ts';
import type { ProcessRunner } from '../ports/process-runner.ts';
import { err, ok, type Result } from '../shared/result.ts';
import type { AuditLog } from './audit-log.ts';

/** F.10.3 measured one at 1.96 s and `--all` at 1.08 s. The budget is a cold daemon. */
const RESPAWN_TIMEOUT_MS = 60_000;

export const RESPAWN_FAILURES = ['no_claude', 'respawn_failed'] as const;
export type RespawnFailure = (typeof RESPAWN_FAILURES)[number];

/** Which sessions the CLI said it restarted — the ids it printed, never a count we assumed. */
export interface RespawnResult {
  readonly subscription: SubscriptionId;
  readonly respawned: readonly string[];
}

export interface SessionRespawnerParts {
  readonly install: ClaudeInstall;
  readonly runner: ProcessRunner;
  readonly audit: AuditLog;
  readonly logger: Logger;
}

export class SessionRespawner {
  private readonly install: ClaudeInstall;
  private readonly runner: ProcessRunner;
  private readonly audit: AuditLog;
  private readonly logger: Logger;

  constructor(parts: SessionRespawnerParts) {
    this.install = parts.install;
    this.runner = parts.runner;
    this.audit = parts.audit;
    this.logger = parts.logger;
  }

  /** One session, by its SHORT id — the form the CLI takes (F.10.3). */
  public one(ref: SessionRef): Promise<Result<RespawnResult, RespawnFailure>> {
    return this.run(ref.subscription, [ref.shortId], ref.sessionId);
  }

  /**
   * Every background session the CLI decides to restart on one subscription.
   *
   * Named `all` after the flag, and the reply is deliberately the ids it printed: `--all` skips a
   * session that has finished (F.10.4), so "how many" is a question only the output can answer.
   */
  public all(subscription: SubscriptionId): Promise<Result<RespawnResult, RespawnFailure>> {
    return this.run(subscription, ['--all'], 'all');
  }

  private async run(
    subscription: SubscriptionId,
    args: readonly string[],
    target: string,
  ): Promise<Result<RespawnResult, RespawnFailure>> {
    const { executable } = this.install;
    if (executable === undefined) {
      this.write(subscription, target, 'refused', 'claude.exe not found');
      return err('no_claude');
    }
    const result = await this.runner.run({
      command: executable,
      args: ['respawn', ...args],
      env: this.install.envFor(subscription),
      timeoutMs: RESPAWN_TIMEOUT_MS,
    });
    if (result.code !== 0 || result.timedOut) {
      this.logger.warn('respawn_failed', { subscription, target, code: result.code });
      this.write(
        subscription,
        target,
        'failed',
        result.timedOut ? 'timed out' : `exit ${String(result.code)}`,
      );
      return err('respawn_failed');
    }
    const respawned = idsIn(result.stdout);
    this.logger.info('sessions_respawned', { subscription, count: respawned.length });
    this.write(subscription, target, 'ok', `${String(respawned.length)} respawned`);
    return ok({ subscription, respawned });
  }

  private write(
    subscription: SubscriptionId,
    target: string,
    outcome: 'ok' | 'refused' | 'failed',
    reason: string,
  ): void {
    this.audit.record({
      action: 'respawn',
      target: `${subscription}:${target}`,
      args: ['respawn'],
      outcome,
      reason,
    });
  }
}

/**
 * The short ids the CLI said it respawned.
 *
 * Read out of the output rather than assumed from the request, because `--all` genuinely restarts
 * fewer sessions than there are (F.10.4). `respawned <id>` is the line; anything else is ignored.
 */
function idsIn(stdout: string): readonly string[] {
  return [...stdout.matchAll(/^respawned\s+([0-9a-f]{8})\s*$/gmu)].map((match) => match[1] ?? '');
}
