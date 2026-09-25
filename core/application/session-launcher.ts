// Starting a background session — the only way a pane in the browser can ever be typed into.
//
// Pulled ahead of P4 by D30, and the constraint that forces it is Claude Code's, not Flightdeck's:
// `claude attach` takes background sessions only (SPEC §5.2), so every interactive session on the
// machine is permanently read-only in a pane. A deck that can *start* sessions is therefore the
// difference between watching terminals and using them.
//
// **P4-T2 changed what this runs, and nothing else about it.** Until this task it spawned
// `claude.exe` with `CLAUDE_CONFIG_DIR` set, which reproduces `claude-365` and `claude-isg` and
// silently loses what the other two functions do — `claude-isg-ticket` pins `opusplan[1m]` plus two
// environment variables, `claude-isg-orch` pins a model, an agent and a name. D4 says model routing
// lives in the profile, so the launch goes through the profile: `PowerShellLaunchCommands` builds
// the argv, this class decides whether to run it and what the answer means.
//
// `--bg` **requires an initial prompt** (RESEARCH.md B.4) and **a name is required too** as of
// P4-T2 — SPEC §5.7's "forced naming (no more `development-63`)", and D7's `unnamed` flag answered
// at the only moment it can be. A session nobody named is one nobody can find again.
//
// **The prompt never enters a command string.** It travels as `FD_PROMPT` and is read back by
// `$env:FD_PROMPT` in argument mode, which is a value rather than source — measured against
// spaces, apostrophes, `$`, `;`, `|` and a prompt that reads like flags (RESEARCH.md F.8.2). That
// is SEC-PROC-1, and it is the port's promise rather than this class's.
//
// **An agent is checked HERE, at launch, as well as at save (P9-T1).** A preset remembers a name
// from the project's `.claude/agents` roster; the file can be deleted between the save and the
// press, and a launch that trusted the stored name would start an agent Claude Code will not find.
// So a launch with an agent asks `AgentRoster` about the folder it is about to start in, and a name
// that is not there is a refused launch with an audit row, not a session.
//
// **The cwd is honoured as of P4-T1, and was parsed and dropped before it.** The path reaching here
// has been screened by `PresetBook`/`ProjectRegistry`; this class does not re-screen it, and must
// never be given one that has not been.
import type { AuditOutcome } from '../../contracts/audit-row.ts';
import type { LaunchFailure } from '../../contracts/launch-reply.ts';
import {
  pinsAgent,
  pinsSessionName,
  subscriptionOfProfileFunction,
  type ProfileFunction,
} from '../../contracts/launch-preset.ts';
import type { Logger } from '../ports/logger.ts';
import type { LaunchCommands } from '../ports/launch-commands.ts';
import type { ProcessRunner } from '../ports/process-runner.ts';
import { err, ok, type Result } from '../shared/result.ts';
import type { AuditLog } from './audit-log.ts';

// The codes themselves are in contracts/launch-reply.ts: the deck reads them off the wire, so a
// second copy here is how a rename turns into a message nobody sees.
export type { LaunchFailure };

export interface LaunchRequest {
  /** SEC-PROC-2's allowlist, narrowed by the route's parser. It is the model AND the account (D44). */
  readonly profileFn: ProfileFunction;
  readonly prompt: string;
  readonly name: string;
  readonly cwd: string | undefined;
  /** `--agent`, or `undefined` for none. Shaped by the route's parser, checked here (P9-T1). */
  readonly agent: string | undefined;
}

/** The one question a launch asks of the roster (`AgentRoster.allows`) — P9-T1. */
export interface LaunchAgentRoster {
  allows(cwd: string, agent: string): Promise<boolean>;
}

/**
 * `--bg` returns as soon as the session is registered, but not instantly.
 *
 * F.8.1 measured the whole PowerShell route at 2.7 s warm — ~270 ms for the shell, ~135 ms for the
 * profile, the rest `--bg`'s own. The budget is a cold daemon (5.4 s, F.2.9), not the shell.
 */
const LAUNCH_TIMEOUT_MS = 60_000;
const MAX_PROMPT_CHARS = 8000;
const MAX_NAME_CHARS = 80;

export interface SessionLauncherParts {
  readonly commands: LaunchCommands;
  readonly roster: LaunchAgentRoster;
  readonly runner: ProcessRunner;
  readonly audit: AuditLog;
  readonly logger: Logger;
}

export class SessionLauncher {
  private readonly commands: LaunchCommands;
  private readonly roster: LaunchAgentRoster;
  private readonly runner: ProcessRunner;
  private readonly audit: AuditLog;
  private readonly logger: Logger;

  constructor(parts: SessionLauncherParts) {
    this.commands = parts.commands;
    this.roster = parts.roster;
    this.runner = parts.runner;
    this.audit = parts.audit;
    this.logger = parts.logger;
  }

  /**
   * Starts a background session and returns the id `claude` printed.
   *
   * Writes exactly one audit row, on every path out — including the two refusals, which are the
   * rows a reviewer actually looks for (SEC-PROC-3). The row's `args` deliberately exclude the
   * prompt AND the name: `contracts/audit-row.ts` says the argv as it was run, and the one place
   * that rule bends is the fields that carry the owner's own words into a table kept forever
   * (SEC-DATA-2). Here that costs nothing, because neither is in the argv.
   *
   * @returns the new session's id, which the deck uses to open a pane straight away.
   */
  public async launch(request: LaunchRequest): Promise<Result<string, LaunchFailure>> {
    if (!isSane(request)) return this.refuse(request, 'bad_request', 'prompt or name out of range');
    const agentRefusal = await this.refuseAgent(request);
    if (agentRefusal !== undefined) return agentRefusal;
    const command = this.commands.forProfile(request.profileFn, {
      name: request.name,
      prompt: request.prompt,
      agent: request.agent,
    });
    if (command === undefined) return this.refuse(request, 'no_shell', 'powershell.exe not found');

    const result = await this.runner.run({
      command: command.command,
      args: command.args,
      env: command.env,
      // The cwd the session will live in. Spread rather than passed as `undefined`, because
      // `exactOptionalPropertyTypes` is on and an absent property and an undefined one are
      // different values to this compiler (the shape `AuditLog`'s `reason` already takes).
      ...(request.cwd === undefined ? {} : { cwd: request.cwd }),
      timeoutMs: LAUNCH_TIMEOUT_MS,
    });

    if (result.code !== 0 || result.timedOut) {
      // The prompt is deliberately absent from the log: it is user text (SEC-DATA-2).
      this.logger.warn('launch_failed', {
        profileFn: request.profileFn,
        code: result.code,
        timedOut: result.timedOut,
      });
      const why = result.timedOut ? 'timed out' : `exit ${String(result.code)}`;
      this.write(request, 'failed', why);
      return err('launch_failed');
    }

    const id = firstSessionId(result.stdout);
    if (id === undefined) {
      // Its OWN code, not `launch_failed` — exit 0 means a session may well exist, and telling the
      // owner it failed is how they end up with two (contracts/launch-reply.ts).
      this.logger.warn('launch_id_not_found', { profileFn: request.profileFn });
      this.write(request, 'failed', 'no session id in output');
      return err('no_session_id');
    }
    this.logger.info('session_launched', { profileFn: request.profileFn, session: id });
    this.write(request, 'ok', undefined, id);
    return ok(id);
  }

  /**
   * The two agent refusals, or `undefined` when there is no agent or the roster holds it.
   *
   * `pins_agent` first, because it is a string test. A launch with an agent and no cwd is
   * `unknown_agent`: there is no project to read a roster from, so there is no name it could be on.
   */
  private async refuseAgent(
    request: LaunchRequest,
  ): Promise<Result<string, LaunchFailure> | undefined> {
    const { agent, cwd } = request;
    if (agent === undefined) return undefined;
    if (pinsAgent(request.profileFn)) {
      return this.refuse(request, 'pins_agent', 'the function pins its own agent');
    }
    if (cwd === undefined || !(await this.roster.allows(cwd, agent))) {
      this.logger.warn('launch_agent_refused', { profileFn: request.profileFn });
      return this.refuse(request, 'unknown_agent', "not in the project's agent roster");
    }
    return undefined;
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
      target: sessionId ?? subscriptionOfProfileFunction(request.profileFn),
      // The profile function and the flags, never the prompt or the name — see `launch`. The agent
      // IS here (P9-T1): it is a roster name on the argv, not the owner's prose.
      args:
        request.agent === undefined
          ? [request.profileFn, '--bg']
          : [request.profileFn, '--bg', '--agent', request.agent],
      outcome,
      ...(reason === undefined ? {} : { reason }),
    });
  }
}

/**
 * A name is required now, which is the one rule here that is a product decision (SPEC §5.7).
 *
 * Except for the one function that names itself: `claude-isg-orch` passes `-n orchestrator`, so
 * requiring a second name would be requiring one that is thrown away — a field the owner fills in
 * and never sees again is worse than no field.
 */
function isSane(request: LaunchRequest): boolean {
  const prompt = request.prompt.trim();
  if (prompt === '' || prompt.length > MAX_PROMPT_CHARS) return false;
  const name = request.name.trim();
  if (name.length > MAX_NAME_CHARS) return false;
  return name !== '' || pinsSessionName(request.profileFn);
}

/**
 * The session id out of `--bg`'s output.
 *
 * It prints the id that `attach`, `logs`, `stop` and `rm` take (RESEARCH.md B.1), but the
 * surrounding wording is not a contract, so this matches the shape rather than the sentence. What
 * F.8.1 actually observed through the profile route is `backgrounded · 17d31085 · fd-t2-probe`
 * followed by four help lines that repeat the short id — hence the FIRST match, and hence a uuid
 * preferred over eight hex characters when both are present.
 */
function firstSessionId(stdout: string): string | undefined {
  const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.exec(stdout);
  if (uuid !== null) return uuid[0];
  const short = /\b[0-9a-f]{8}\b/i.exec(stdout);
  return short?.[0];
}
