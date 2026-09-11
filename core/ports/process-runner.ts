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
  readonly timeoutMs: number;
}

export interface ProcessRunner {
  /** @throws never — a spawn failure comes back as a non-zero code with the reason on stderr. */
  run(request: ProcessRequest): Promise<ProcessResult>;
}
