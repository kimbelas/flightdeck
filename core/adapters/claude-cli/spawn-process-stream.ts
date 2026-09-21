// `spawn` with an argument array, read line by line — P4-T4, SEC-PROC-1.
//
// `spawn` rather than `execFile` because `execFile` only answers when the child has exited and the
// whole of stdout is in memory, which is precisely what this port exists not to do. Never `exec`,
// never `shell: true`: the argv is an array from the caller down to `CreateProcess`.
//
// **The spawn itself can throw before there is a process**, the lesson `ExecFileProcessRunner`
// carries from G.10 — Windows answered `spawn UNKNOWN` on a machine briefly unable to start one,
// on the calling stack rather than through an event, and an unhandled rejection took core down.
// A spawn that never happened is exit code -1 like any other failure.
//
// **stdout is decoded as UTF-8 across chunk boundaries.** A `StringDecoder` rather than
// `chunk.toString()`: a multi-byte character split across two reads becomes two replacement
// characters otherwise, and a prompt or an answer with an em dash in it is the ordinary case here,
// not the exotic one.
import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import type {
  ProcessStream,
  ProcessStreamRequest,
  ProcessStreamResult,
  ProcessStreamSink,
} from '../../ports/process-stream.ts';

/** Enough of stderr to explain a failure in the log, and never enough to be a memory problem. */
const MAX_STDERR_CHARS = 8000;

export class SpawnProcessStream implements ProcessStream {
  /** @throws never — see the port. */
  public run(request: ProcessStreamRequest, sink: ProcessStreamSink): Promise<ProcessStreamResult> {
    return new Promise((resolve) => {
      try {
        this.pump(request, sink, resolve);
      } catch (cause) {
        resolve({ code: -1, timedOut: false, stderr: reasonOf(cause) });
      }
    });
  }

  private pump(
    request: ProcessStreamRequest,
    sink: ProcessStreamSink,
    resolve: (result: ProcessStreamResult) => void,
  ): void {
    const child = spawn(request.command, [...request.args], {
      env: { ...request.env },
      cwd: request.cwd,
      windowsHide: true,
      shell: false,
    });
    const lines = new LineReader(sink);
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, request.timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      lines.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString('utf8')).slice(0, MAX_STDERR_CHARS);
    });
    // `error` fires for a spawn that failed asynchronously; `close` fires once stdio is drained,
    // which `exit` does not guarantee — and a run whose last record arrived after we stopped
    // listening is a run with no `done`.
    child.on('error', (cause: Error) => {
      clearTimeout(timer);
      resolve({ code: -1, timedOut, stderr: stderr === '' ? cause.message : stderr });
    });
    child.on('close', (code: number | null) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, timedOut, stderr });
    });
  }
}

/**
 * Chunks in, whole lines out.
 *
 * The trailing partial line is deliberately never delivered: `stream-json` is one document per
 * line, so a fragment left when the child was killed is not a record, and handing it on would only
 * move the discard one layer up into the parser.
 */
class LineReader {
  private readonly sink: ProcessStreamSink;
  private readonly decoder = new StringDecoder('utf8');
  private held = '';

  constructor(sink: ProcessStreamSink) {
    this.sink = sink;
  }

  public push(chunk: Buffer): void {
    this.held += this.decoder.write(chunk);
    const parts = this.held.split('\n');
    // The last element is whatever came after the final newline — a partial line, or ''.
    this.held = parts.pop() ?? '';
    for (const part of parts) {
      const line = part.endsWith('\r') ? part.slice(0, -1) : part;
      if (line !== '') this.sink.onLine(line);
    }
  }
}

/** Enough to tell a bad argument from a refusal in the log, and never the argv itself. */
function reasonOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'spawn failed';
}
