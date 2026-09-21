// In-memory `ProcessStream` — CODING-STANDARDS §10.1.
//
// A real implementation of the port over a scripted set of lines, not a stub: what `AskRunner` is
// tested on is what it does with them, so the request it was given is recorded and the lines are
// delivered through the same `onLine` a real child would use.
//
// **It can be held open**, which is the property the `busy` test needs: a run that has been
// accepted and has not finished is the state the single slot exists to describe, and a fake that
// always resolved immediately could not produce it.
import type {
  ProcessStream,
  ProcessStreamRequest,
  ProcessStreamResult,
  ProcessStreamSink,
} from '../../core/ports/process-stream.ts';

export class FakeProcessStream implements ProcessStream {
  public readonly asked: ProcessStreamRequest[] = [];
  private lines: readonly string[] = [];
  private result: ProcessStreamResult = { code: 0, timedOut: false, stderr: '' };
  private release: (() => void) | undefined;
  private sink: ProcessStreamSink | undefined;
  private held = false;

  /** What the next run will emit, in order, before it finishes. */
  public willEmit(lines: readonly string[]): void {
    this.lines = lines;
  }

  /** How the next run will end. */
  public willEndWith(result: ProcessStreamResult): void {
    this.result = result;
  }

  /** Makes the next run emit its lines and then WAIT, until `finish()` is called. */
  public holdOpen(): void {
    this.release = undefined;
    this.held = true;
  }

  /** Lets a held run finish. */
  public finish(): void {
    this.held = false;
    this.release?.();
    this.release = undefined;
  }

  /** Delivers one more line to a run that is still open — for asserting relay order. */
  public emit(line: string): void {
    this.sink?.onLine(line);
  }

  public async run(
    request: ProcessStreamRequest,
    sink: ProcessStreamSink,
  ): Promise<ProcessStreamResult> {
    this.asked.push(request);
    this.sink = sink;
    for (const line of this.lines) sink.onLine(line);
    if (this.held) {
      await new Promise<void>((resolve) => {
        this.release = resolve;
      });
    }
    return this.result;
  }
}
