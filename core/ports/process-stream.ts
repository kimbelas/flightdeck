// A child process read LINE BY LINE while it runs — P4-T4, CODING-STANDARDS §7.
//
// `ProcessRunner`'s twin, and a separate port rather than a flag on it because the two make
// opposite promises. `ProcessRunner` buffers everything and answers once: right for
// `claude agents --json`, which is a listing. An Ask run writes its answer over seconds or minutes
// and the panel is supposed to fill as it goes, so a port that resolves with the whole of stdout
// would make the streaming impossible at the seam rather than in the UI.
//
// **The sink takes whole lines, never chunks.** `stream-json` puts one JSON document per line, and
// a chunk boundary falls wherever the pipe buffer happened to fill — halfway through a UUID as
// readily as between records. Reassembly belongs here, once, rather than in every caller.
export interface ProcessStreamRequest {
  readonly command: string;
  /** An array, always. No command strings anywhere (SEC-PROC-1). */
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly cwd?: string;
  /** Bounds the PROCESS, not the cost — the budget flag does that. See `ASK_TIMEOUT_MS`. */
  readonly timeoutMs: number;
}

/** How a run ended. A non-zero code is a value, as it is on `ProcessRunner`, never a throw. */
export interface ProcessStreamResult {
  readonly code: number;
  /** True when the timeout fired and the child was killed. */
  readonly timedOut: boolean;
  /** Whatever the child said on stderr, capped — enough to log, never shown to a browser. */
  readonly stderr: string;
}

export interface ProcessStreamSink {
  /** One complete line of stdout, without its terminator. */
  onLine(line: string): void;
}

export interface ProcessStream {
  /**
   * Runs the child, calling `sink.onLine` for each line of stdout as it arrives.
   *
   * @returns how it ended, after the child has exited and stdout has been drained. A trailing
   * partial line — a child killed mid-record — is DROPPED rather than delivered, because half a
   * JSON document is not a record and the parser would only discard it one layer up.
   * @throws never.
   */
  run(request: ProcessStreamRequest, sink: ProcessStreamSink): Promise<ProcessStreamResult>;
}
