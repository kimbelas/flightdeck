// Starting a background session — the only way a pane in the browser can ever be typed into.
//
// Pulled ahead of P4 by D30, and the constraint that forces it is Claude Code's, not Flightdeck's:
// `claude attach` takes background sessions only (SPEC §5.2), so every interactive session on the
// machine is permanently read-only in a pane. A deck that can *start* sessions is therefore the
// difference between watching terminals and using them.
//
// `--bg` **requires an initial prompt** (RESEARCH.md B.4). The prompt is passed as an argv element
// and never interpolated into a command string — it is user text heading for a process, which is
// exactly SEC-PROC-1's case.
import type { AuditOutcome } from '../../contracts/audit-row.ts';
import type { LaunchFailure } from '../../contracts/launch-reply.ts';
import type { SubscriptionId } from '../../contracts/session.ts';
import type { ClaudeInstall } from '../adapters/claude-cli/claude-install.ts';
import type { Logger } from '../ports/logger.ts';
import type { ProcessRunner } from '../ports/process-runner.ts';
import { err, ok, type Result } from '../shared/result.ts';
import type { AuditLog } from './audit-log.ts';

// The codes themselves are in contracts/launch-reply.ts: the deck reads them off the wire, so a
// second copy here is how a rename turns into a message nobody sees.
export type { LaunchFailure };

export interface LaunchRequest {
  readonly subscription: SubscriptionId;
  readonly prompt: string;
  readonly name: string | undefined;
  readonly cwd: string | undefined;
}

/** `--bg` returns as soon as the session is registered, but not instantly. */
const LAUNCH_TIMEOUT_MS = 60_000;
const MAX_PROMPT_CHARS = 8000;
const MAX_NAME_CHARS = 80;

export interface SessionLauncherParts {
  readonly install: ClaudeInstall;
  readonly runner: ProcessRunner;
  readonly audit: AuditLog;
  readonly logger: Logger;
}

export class SessionLauncher {
  private readonly install: ClaudeInstall;
  private readonly runner: ProcessRunner;
  private readonly audit: AuditLog;
  private readonly logger: Logger;

  constructor(parts: SessionLauncherParts) {
    this.install = parts.install;
    this.runner = parts.runner;
    this.audit = parts.audit;
    this.logger = parts.logger;
  }

  /**
   * Starts a background session and returns the id `claude` printed.
   *
   * Writes exactly one audit row, on every path out — including the two refusals, which are the
   * rows a reviewer actually looks for (SEC-PROC-3). The row's `args` deliberately exclude the
   * prompt: `contracts/audit-row.ts` says the argv as it was run, and the one place that rule
   * bends is the field that carries the owner's own words into a table kept forever (SEC-DATA-2).
   *
   * @returns the new session's id, which the deck uses to open a pane straight away.
   */
  public async launch(request: LaunchRequest): Promise<Result<string, LaunchFailure>> {
    const { executable } = this.install;
    if (executable === undefined) return this.refuse(request, 'no_claude', 'claude.exe not found');
    if (!isSane(request)) return this.refuse(request, 'bad_request', 'prompt or name out of range');

    const args = ['--bg', ...nameArgs(request.name), request.prompt];
    const result = await this.runner.run({
      command: executable,
      args,
      env: this.install.envFor(request.subscription),
      timeoutMs: LAUNCH_TIMEOUT_MS,
    });

    if (result.code !== 0 || result.timedOut) {
      // The prompt is deliberately absent from the log: it is user text (SEC-DATA-2).
      this.logger.warn('launch_failed', {
        subscription: request.subscription,
        code: result.code,
        timedOut: result.timedOut,
      });
      const why = result.timedOut ? 'timed out' : `exit ${String(result.code)}`;
      this.write(request, 'failed', why);
      return err('launch_failed');
    }

    const id = firstSessionId(result.stdout);
    if (id === undefined) {
      this.logger.warn('launch_id_not_found', { subscription: request.subscription });
      this.write(request, 'failed', 'no session id in output');
      return err('launch_failed');
    }
    this.logger.info('session_launched', { subscription: request.subscription, session: id });
    this.write(request, 'ok', undefined, id);
    return ok(id);
  }

  private refuse(
    request: LaunchRequest,
    failure: LaunchFailure,
    reason: string,
  ): Result<string, LaunchFailure> {
    this.write(request, 'refused', reason);
    return err(failure);
  }

  /** The target is the session once there is one, and the subscription until then. */
  private write(
    request: LaunchRequest,
    outcome: AuditOutcome,
    reason: string | undefined,
    sessionId?: string,
  ): void {
    this.audit.record({
      action: 'launch',
      target: sessionId ?? request.subscription,
      // The flags, never the prompt — see `launch`.
      args: ['--bg', ...nameArgs(request.name)],
      outcome,
      ...(reason === undefined ? {} : { reason }),
    });
  }
}

function isSane(request: LaunchRequest): boolean {
  const prompt = request.prompt.trim();
  if (prompt === '' || prompt.length > MAX_PROMPT_CHARS) return false;
  return request.name === undefined || request.name.length <= MAX_NAME_CHARS;
}

function nameArgs(name: string | undefined): readonly string[] {
  return name === undefined || name.trim() === '' ? [] : ['--name', name];
}

/**
 * The session id out of `--bg`'s output.
 *
 * It prints the id that `attach`, `logs`, `stop` and `rm` take (RESEARCH.md B.1), but the
 * surrounding wording is not a contract, so this matches the shape rather than the sentence.
 */
function firstSessionId(stdout: string): string | undefined {
  const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.exec(stdout);
  if (uuid !== null) return uuid[0];
  const short = /\b[0-9a-f]{8}\b/i.exec(stdout);
  return short?.[0];
}
