// In-memory `LaunchCommands` — CODING-STANDARDS §10.1.
//
// A real implementation of the port over a fixed command, not a stub: what `SessionLauncher` is
// tested on is what it does with the answer, and what it PASSED — the name and the prompt — is the
// SEC-PROC-1 assertion, so both are recorded rather than discarded.
//
// The thing this fake cannot establish is the thing that matters most about the real adapter: that
// `$env:FD_PROMPT` reaches the child as one argv element. A fake can only honour a contract, never
// prove one, so that half is measured in `tests/win/powershell-launch.test.ts` against a real
// `powershell.exe`.
import type { ProfileFunction } from '../../contracts/launch-preset.ts';
import type {
  LaunchCommand,
  LaunchCommands,
  LaunchText,
} from '../../core/ports/launch-commands.ts';

export interface RecordedLaunch {
  readonly profileFn: ProfileFunction;
  readonly text: LaunchText;
}

export class FakeLaunchCommands implements LaunchCommands {
  public readonly asked: RecordedLaunch[] = [];
  private available = true;

  /** Makes every subsequent call answer `undefined`, as a machine with no PowerShell would. */
  public breakShell(): void {
    this.available = false;
  }

  public forProfile(profileFn: ProfileFunction, text: LaunchText): LaunchCommand | undefined {
    this.asked.push({ profileFn, text });
    if (!this.available) return undefined;
    return {
      command: 'C:\\powershell.exe',
      args: ['-NoLogo', '-NonInteractive', '-EncodedCommand', `encoded:${profileFn}`],
      // The two variables the real scripts read, so a test can assert that neither the prompt nor
      // the name ever reaches `args`.
      env: { FD_NAME: text.name, FD_PROMPT: text.prompt },
    };
  }
}
