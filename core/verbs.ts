// The things core can DO to a session, constructed — lifted out of `main.ts` in P4-T4.
//
// `feeds.ts` and `routes.ts`'s third sibling, split for the reason both of those were: `main.ts`
// has a 250-line limit and reached it again. Of what that file does — issue the secrets, wire the
// feeds, wire the server — this is the piece with a story of its own, and the story is which of
// these spawns go through the owner's PowerShell profile and which do not.
//
// **Only the LAUNCHER goes through the profile.** D4 put model routing in the four profile
// functions, and P2-T2's launcher — which spawned `claude.exe` with `CLAUDE_CONFIG_DIR` set —
// reproduced two of them and silently lost what the other two pin (P4-T2). Starting a session is
// therefore `powershell.exe` and one fixed script.
//
// **The other four spawn the binary directly, and that is not an inconsistency.** `stop`, `rm` and
// `resume` start nothing: the account is already fixed by the session they name, so the profile has
// nothing to contribute and would add a shell and ~400 ms. **Ask** joins them for a sharper reason
// (D47): every profile function passes `--dangerously-skip-permissions`, which SEC-PROC-4 forbids
// on an Ask, and `--permission-mode` beside it is not refused but SILENTLY IGNORED — measured on
// all three values (RESEARCH.md F.9.3). Through a function, the permission-mode control SPEC §5.2
// lists would be a dropdown that does nothing and the security control would be unenforceable.
import { DirectAskCommands } from './adapters/claude-cli/direct-ask-commands.ts';
import { SpawnProcessStream } from './adapters/claude-cli/spawn-process-stream.ts';
import { PowerShellLaunchCommands } from './adapters/windows/powershell-launch-commands.ts';
import type { ClaudeInstall } from './adapters/claude-cli/claude-install.ts';
import { AskRunner, type AskPublisher } from './application/ask-runner.ts';
import { InstallDoctor } from './application/install-doctor.ts';
import { SessionRespawner } from './application/session-respawner.ts';
import type { AuditLog } from './application/audit-log.ts';
import { SessionLauncher } from './application/session-launcher.ts';
import { SessionRemover } from './application/session-remover.ts';
import { SessionResumer } from './application/session-resumer.ts';
import { SessionStopper } from './application/session-stopper.ts';
import type { Clock } from './ports/clock.ts';
import type { Logger } from './ports/logger.ts';
import type { ProcessRunner } from './ports/process-runner.ts';
import type { RouterParts } from './routes.ts';

export interface SessionVerbParts {
  readonly install: ClaudeInstall;
  readonly runner: ProcessRunner;
  readonly audit: AuditLog;
  readonly logger: Logger;
}

/** The four verbs that act on a session — P4-T2. See the header for which one takes a shell. */
import { join } from 'node:path';
import { SessionPopper, type PaneHolders } from './application/session-popper.ts';
import { GroupLauncher } from './application/group-launcher.ts';
import { type PaneRegistry } from './application/pane-registry.ts';
import { SessionAdopter, type SessionDirectory } from './application/session-adopter.ts';
import { SessionHandoff } from './application/session-handoff.ts';
import { type ExecFileProcessRunner } from './adapters/claude-cli/execfile-process-runner.ts';
import type { ProjectSlice } from './projects.ts';
import { WindowsTerminalCommands } from './adapters/windows/windows-terminal-commands.ts';

/**
 * `powershell.exe` by absolute path, for `PowerShellLaunchCommands`' reason (SEC-PROC-2).
 *
 * Core runs as a logon task and a service's `PATH` is not the interactive one — the lesson
 * `ClaudeInstall` already carries about the npm shim.
 */
function powerShellPath(): string {
  return join(
    process.env['SystemRoot'] ?? 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
}

export function sessionVerbs(
  parts: SessionVerbParts,
): Pick<RouterParts, 'launcher' | 'resumer' | 'stopper' | 'remover' | 'respawner' | 'doctor'> {
  return {
    launcher: new SessionLauncher({
      commands: new PowerShellLaunchCommands(),
      runner: parts.runner,
      audit: parts.audit,
      logger: parts.logger,
    }),
    resumer: new SessionResumer(parts),
    stopper: new SessionStopper(parts),
    remover: new SessionRemover(parts),
    // P4-T5. Restarting a session so it picks up the current binary — the fourth verb with a
    // measured id form, and the third to take the SHORT one (RESEARCH.md F.10.3).
    respawner: new SessionRespawner(parts),
    // P4-T5. `doctor` reads and `update` can replace the binary; neither starts a session, so
    // both spawn it directly for D47's reason.
    doctor: new InstallDoctor(parts),
  };
}

export interface AskParts {
  readonly install: ClaudeInstall;
  readonly publisher: AskPublisher;
  readonly audit: AuditLog;
  readonly clock: Clock;
  readonly logger: Logger;
}

/** Ask — P4-T4, D47. The one spawn that must NOT go through a profile function. */
export function buildAsker(parts: AskParts): AskRunner {
  return new AskRunner({
    commands: new DirectAskCommands(parts.install),
    stream: new SpawnProcessStream(),
    publisher: parts.publisher,
    audit: parts.audit,
    clock: parts.clock,
    logger: parts.logger,
  });
}

/**
 * Popping a session out into Windows Terminal — P6-T2.
 *
 * Its own builder rather than a member of `sessionVerbs`, and the reason is what it needs: the
 * PANE REGISTRY. The other six verbs are about a session on disk; this one is about who currently
 * holds the attach, because it has to let go before Windows Terminal takes it (F.2.6). That is a
 * dependency `sessionVerbs` does not have and should not grow.
 */
export function buildPopper(
  parts: SessionVerbParts & { readonly panes: PaneHolders },
): SessionPopper {
  return new SessionPopper({
    terminals: new WindowsTerminalCommands({
      install: parts.install,
      runner: parts.runner,
      shell: powerShellPath(),
      logger: parts.logger,
    }),
    panes: parts.panes,
    runner: parts.runner,
    audit: parts.audit,
    logger: parts.logger,
  });
}

/**
 * Everything that acts on a session: the six verbs, the pop-out, the group press, the handoff
 * and the adoption.
 *
 * Together because the last two both need something the first makes. `buildPopper` needs the pane
 * registry, so the pane the pop-out detaches is the pane the socket server holds. And
 * `GroupLauncher` needs the SAME `SessionLauncher` the router gets (P6-T4) — a second one would be
 * a second audit trail for one press — plus the one preset book `projectSlice` holds, because
 * deciding what a group is is a question about presets.
 */
/**
 * What `sessionSlice` needs, which is far less than the whole HTTP side.
 *
 * Narrow on purpose, for `StartableCore`'s reason: this composes session verbs, and typing the
 * parameter as `HttpParts` would drag the guard, the feeds, the version string and the report into
 * a function that touches none of them.
 */
export interface SessionSliceParts {
  readonly install: ClaudeInstall;
  readonly runner: ExecFileProcessRunner;
  readonly audit: AuditLog;
  readonly projects: ProjectSlice;
  /**
   * Where core last saw each session — P6-T7. The reconciler, narrowed to one getter.
   *
   * An adoption is the one session verb that needs core's own memory: the folder it runs in is
   * not on the request and cannot be, and the listing has already forgotten the session
   * (`SessionAdopter`). Named `directory` rather than `sessions`, which on the parts object beside
   * it is the `SessionSource` — the thing that sweeps rather than the thing that remembers.
   */
  readonly directory: SessionDirectory;
  readonly logger: Logger;
}

export function sessionSlice(
  parts: SessionSliceParts,
  panes: PaneRegistry,
): Pick<
  RouterParts,
  | 'launcher'
  | 'resumer'
  | 'stopper'
  | 'remover'
  | 'respawner'
  | 'doctor'
  | 'popper'
  | 'groups'
  | 'forker'
  | 'adopter'
> {
  const { install, logger } = parts;
  const sessionParts = { install, runner: parts.runner, audit: parts.audit, logger };
  const verbs = sessionVerbs(sessionParts);
  return {
    ...verbs,
    popper: buildPopper({ ...sessionParts, panes }),
    // P6-T6. The registry, because a handoff names a FOLDER and `resolveDirectory` is the only
    // screen that admits a worktree (G.26, G.28).
    forker: new SessionHandoff({ ...sessionParts, registry: parts.projects.registry }),
    // P6-T7. The reconciler, because an adoption runs in the folder the terminal was in and core
    // is the only one that knows it — the browser sends a ref and no path (SEC-FS-1).
    adopter: new SessionAdopter({ ...sessionParts, sessions: parts.directory }),
    groups: new GroupLauncher({
      presets: parts.projects.presets,
      launcher: verbs.launcher,
      logger,
    }),
  };
}
