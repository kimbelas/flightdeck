// Where Claude Code lives on this machine, and which directory each subscription uses.
//
// One class rather than two answers, because the PTY commands and the session source must agree:
// a pane attached with one config dir while the listing was read with another shows a session that
// is not there. Both take this.
//
// **`claude` is not on PATH.** npm drops a `claude.cmd` shim in `%APPDATA%\npm`, which is on the
// interactive PATH but not necessarily on a service's — and core runs as a Windows logon task
// (D21). The shim is a batch file besides, which CreateProcess cannot execute. Its only job is to
// call a real `claude.exe` beside it, so that executable is found and named directly.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { SUBSCRIPTION_IDS, type SubscriptionId } from '../../../contracts/session.ts';

const CONFIG_DIRS: Readonly<Record<SubscriptionId, string>> = {
  '365': '.claude-365',
  isg: '.claude-isg',
};

function candidates(): readonly string[] {
  const appData = process.env['APPDATA'] ?? '';
  const local = process.env['LOCALAPPDATA'] ?? '';
  return [
    join(appData, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'),
    join(local, 'Programs', 'claude-code', 'claude.exe'),
  ];
}

export class ClaudeInstall {
  private readonly home: string;
  private readonly executablePath: string | undefined;

  /**
   * @param executable omit to discover it; pass a path to name it; pass `''` to say there is
   * none. The empty case is not a quirk — a test for "Claude is not installed" must not fall
   * back to discovery and then find the real binary on the machine running the test.
   */
  constructor(home: string = process.env['USERPROFILE'] ?? '', executable?: string) {
    this.home = home;
    if (executable === undefined)
      this.executablePath = candidates().find((path) => existsSync(path));
    else this.executablePath = executable === '' ? undefined : executable;
  }

  /** The binary, or `undefined` when Claude Code is not installed where we look. */
  public get executable(): string | undefined {
    return this.executablePath;
  }

  public get userHome(): string {
    return this.home;
  }

  /**
   * The config directory for a subscription.
   *
   * Chosen from the closed `SubscriptionId` union, never from a caller-supplied path: the browser
   * asks for `365`, not for a folder (SECURITY.md §11 rule 2).
   */
  public configDirFor(subscription: SubscriptionId): string {
    return join(this.home, CONFIG_DIRS[subscription]);
  }

  /**
   * The directories whose contents change when a session starts, ends or is written to —
   * DECISIONS.md D3 feed 5. A change in any of them means "sweep now, do not wait for the timer".
   *
   * They are derived here rather than accepted from a caller, for the same reason `configDirFor`
   * takes a `SubscriptionId` and not a path: nothing outside this class chooses which folders
   * core watches (SEC-FS-1). They need not exist — `jobs/` appears with the first background
   * session, and the watcher treats absence as an ordinary state.
   */
  public watchTargets(): readonly string[] {
    return SUBSCRIPTION_IDS.flatMap((subscription) => {
      const configDir = this.configDirFor(subscription);
      return [join(configDir, 'sessions'), join(configDir, 'jobs')];
    });
  }

  /** The environment a child needs to talk to one subscription and not the other. */
  public envFor(subscription: SubscriptionId): Readonly<Record<string, string | undefined>> {
    return { ...process.env, CLAUDE_CONFIG_DIR: this.configDirFor(subscription) };
  }
}
