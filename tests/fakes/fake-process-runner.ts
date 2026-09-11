// In-memory ProcessRunner — CODING-STANDARDS §10.1.
//
// Queued results rather than a callback, so a test that sweeps both subscriptions can say what
// each one answered without caring which order they were awaited in.
import type {
  ProcessRequest,
  ProcessResult,
  ProcessRunner,
} from '../../core/ports/process-runner.ts';

export class FakeProcessRunner implements ProcessRunner {
  public readonly requests: ProcessRequest[] = [];
  private readonly byArg = new Map<string, ProcessResult>();
  private fallback: ProcessResult = { code: 0, stdout: '[]', stderr: '', timedOut: false };

  /** Answers any request whose argv contains `marker`. */
  public willReturnFor(marker: string, result: Partial<ProcessResult>): void {
    this.byArg.set(marker, { code: 0, stdout: '', stderr: '', timedOut: false, ...result });
  }

  public willReturn(result: Partial<ProcessResult>): void {
    this.fallback = { code: 0, stdout: '', stderr: '', timedOut: false, ...result };
  }

  public run(request: ProcessRequest): Promise<ProcessResult> {
    this.requests.push(request);
    for (const [marker, result] of this.byArg) {
      const inArgs = request.args.some((arg) => arg.includes(marker));
      const inEnv = (request.env['CLAUDE_CONFIG_DIR'] ?? '').includes(marker);
      if (inArgs || inEnv) return Promise.resolve(result);
    }
    return Promise.resolve(this.fallback);
  }
}
