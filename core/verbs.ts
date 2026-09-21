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
