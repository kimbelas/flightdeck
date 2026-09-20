// Running a child process and collecting its output — CODING-STANDARDS §7.
//
// A port because `claude agents --json` costs ~763 ms per config dir (RESEARCH.md B.2) and no unit
// test should pay that, nor depend on which sessions happen to be running on the machine. The
// adapter above it is tested against scrubbed fixtures; this is the seam.
export interface ProcessResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  /** True when the timeout fired — a timed-out sweep is an ordinary answer, not an exception. */
  readonly timedOut: boolean;
}

export interface ProcessRequest {
  readonly command: string;
  /** An array, always. No command strings anywhere (SEC-PROC-1). */
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string | undefined>>;
  /**
   * The directory the child starts in, or absent for core's own — P4-T1.
   *
   * Optional rather than required because most callers have no opinion: `agents --json` and
   * `claude stop` are about a config directory, not a folder, and `git` is given `-C <root>`
   * precisely so that it needs none (P3-T2). A LAUNCH is the case that does — a background session
   * inherits the cwd it was started in, and a preset that names a project folder and then started
   * the session in core's own would be a button that lies about where it goes.
   *
   * It is a path core has already screened (`ProjectRegistry.resolveDirectory`), never one that
   * arrived from a browser: this port hands it straight to `execFile`, which does no checking of
   * its own.
   */
  readonly cwd?: string;
  readonly timeoutMs: number;
}

export interface ProcessRunner {
  /** @throws never — a spawn failure comes back as a non-zero code with the reason on stderr. */
  run(request: ProcessRequest): Promise<ProcessResult>;
}
