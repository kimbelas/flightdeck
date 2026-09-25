// `ProcessEnder`, as `taskkill /PID <pid> /FI "IMAGENAME eq claude.exe" /T /F` — P6-T8, D63.
//
// **The image filter is the control, and taskkill's exit code cannot be trusted to report it.**
// Measured (RESEARCH.md G.60): against a pid that is not `claude.exe` the filter leaves it running
// and prints "No tasks running with the specified criteria" — with exit code 0, the same code as a
// kill that worked. So the answer is never read off taskkill. The adapter asks the probe afterwards
// whether the pid is still there, and that is the whole of what `end` reports.
//
// `/F` because an interactive `claude.exe` is a console process, and without it taskkill sends a
// window-close message a console process never receives. `/T` for the port's reason: the tree.
// By absolute path, for `powerShellPath`'s reason (SEC-PROC-2) — core runs as a logon task, and a
// service's `PATH` is not the interactive one.
import type { ProcessProbe } from '../../ports/process-probe.ts';
import type { ProcessEnder } from '../../ports/process-ender.ts';
import type { ProcessRunner } from '../../ports/process-runner.ts';

/** The measured exit was 1.4 s from the call to the pty seeing it (G.60); five is the margin. */
const GONE_WITHIN_MS = 5000;
const POLL_MS = 100;
const TASKKILL_TIMEOUT_MS = 10_000;

export interface TaskkillProcessEnderParts {
  /** `%SystemRoot%\System32\taskkill.exe`. */
  readonly taskkill: string;
  readonly runner: ProcessRunner;
  readonly probe: ProcessProbe;
  /** A wait between probes. Injected so a test does not spend five real seconds on one case. */
  readonly pause: (ms: number) => Promise<void>;
}

export class TaskkillProcessEnder implements ProcessEnder {
  private readonly parts: TaskkillProcessEnderParts;

  constructor(parts: TaskkillProcessEnderParts) {
    this.parts = parts;
  }

  /** @throws never — see the port. */
  public async end(pid: number): Promise<boolean> {
    if (!Number.isInteger(pid) || pid <= 0) return false;
    await this.parts.runner.run({
      command: this.parts.taskkill,
      args: ['/PID', String(pid), '/FI', 'IMAGENAME eq claude.exe', '/T', '/F'],
      // Windows' own variables and nothing of the owner's: taskkill needs `SystemRoot` to load, and
      // nothing else in core's environment is any of its business.
      env: { SystemRoot: process.env['SystemRoot'] },
      timeoutMs: TASKKILL_TIMEOUT_MS,
    });
    for (let waited = 0; waited < GONE_WITHIN_MS; waited += POLL_MS) {
      if (!this.parts.probe.isAlive(pid)) return true;
      await this.parts.pause(POLL_MS);
    }
    return !this.parts.probe.isAlive(pid);
  }
}
