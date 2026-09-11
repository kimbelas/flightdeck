// Turning a bind target into an argv on this machine — SEC-PROC-1.
//
// Where the binary lives and which config directory a subscription uses are ClaudeInstall's to
// know; this class only decides what a pane runs. Splitting them is not tidiness: the session
// source reads the listing with the same install, and a pane attached under one config dir while
// the listing was read under another shows a session that is not there.
import { join } from 'node:path';
import type { PtyTarget } from '../../../contracts/pty-protocol.ts';
import { SessionId } from '../../domain/session-id.ts';
import type { PtyCommands, TerminalSize } from '../../ports/pty-commands.ts';
import type { PtySpec } from '../../ports/pty-host.ts';
import type { ClaudeInstall } from '../claude-cli/claude-install.ts';

export class WindowsPtyCommands implements PtyCommands {
  private readonly install: ClaudeInstall;
  private readonly shell: string;

  constructor(install: ClaudeInstall) {
    this.install = install;
    this.shell = join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'cmd.exe');
  }

  public forTarget(target: PtyTarget, size: TerminalSize): PtySpec | undefined {
    if (target.kind === 'shell') {
      return {
        command: this.shell,
        args: [],
        cwd: this.install.userHome,
        cols: size.cols,
        rows: size.rows,
        env: process.env,
      };
    }

    const { executable } = this.install;
    if (executable === undefined) return undefined;
    const short = shortIdOf(target.sessionId);
    if (short === undefined) return undefined;
    return {
      command: executable,
      // `attach` takes the id positionally. It is matched against a shape before it gets here and
      // it is an array element, so there is no command string for it to escape from.
      args: ['attach', short],
      cwd: this.install.userHome,
      cols: size.cols,
      rows: size.rows,
      // The one line that decides which of the two accounts this pane is attached to.
      env: this.install.envFor(target.subscription),
    };
  }
}

/**
 * The eight-character id `attach` actually takes.
 *
 * Measured, not assumed: attaching with the full uuid gets `No job matching '<uuid>'. Run 'claude
 * agents' to list running sessions.` and exit 1 — the socket opens, the pane mounts, and the
 * session dies immediately with a message no one is reading. SessionId already documented that
 * `stop`, `rm`, `logs` and `attach` take the short form; this is the one place that has to act on
 * it, and it goes through SessionId rather than slicing so the pair stays one value (F.2.1).
 *
 * `undefined` rather than a throw, because `forTarget` promises never to throw — a malformed id
 * becomes a refused pane, which the deck already renders.
 */
function shortIdOf(sessionId: string): string | undefined {
  try {
    return SessionId.parse(sessionId).short;
  } catch {
    return undefined;
  }
}
