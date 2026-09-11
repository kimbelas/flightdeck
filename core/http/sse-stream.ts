// The SSE framing, in one class — everything `GET /stream` puts on the wire (P1-T9).
//
// It exists so that no route ever touches a socket. `Route` returns a value and `CoreServer`
// serialises it precisely so a handler cannot forget a security header (route.ts); a stream has no
// single value to return, so the guarantee moves here instead of being dropped — the header block
// below is written once, by this constructor, for every stream there will ever be.
//
// **`no-transform` is the load-bearing one and it is not decorative.** P0-T8 measured a proxied
// `text/event-stream` being gzipped, and a compressor holds a stream to the end: twelve events
// arrived as one chunk at 2.2 s, with a `200 OK` and nothing in any log (RESEARCH.md F.6.3). The
// deck's route handler repeats it on its own leg, which is the half D27 chose the transport for;
// this is the half that stops anything else that reads core directly from batching.
//
// **A `retry:` line goes out before anything else.** An `EventSource` reconnects on its own, and
// without this the delay is the browser's default. Core being restarted is an ordinary event on
// this machine (RESEARCH.md F.3.3), so how fast a deck comes back is core's decision to state.
import type { EventStream } from './route.ts';

/**
 * The slice of a `ServerResponse` a stream writes to.
 *
 * Narrow on purpose: a fake for it is four methods, so the framing below is testable without a
 * socket, and nothing here can reach for a response method that would end the stream by accident.
 */
export interface StreamSocket {
  readonly writableEnded: boolean;
  writeHead(status: number, headers: Readonly<Record<string, string>>): void;
  write(chunk: string): boolean;
  end(): void;
}

/** How long a disconnected browser waits before reopening. Loopback; there is nothing to back off. */
const RETRY_MS = 2000;

const STREAM_HEADERS: Readonly<Record<string, string>> = {
  'content-type': 'text/event-stream; charset=utf-8',
  'cache-control': 'no-store, no-transform',
  'x-content-type-options': 'nosniff',
  connection: 'keep-alive',
};

export class SseStream implements EventStream {
  private readonly socket: StreamSocket;
  private readonly closeHandlers: (() => void)[] = [];
  private ended = false;

  constructor(socket: StreamSocket, retryMs: number = RETRY_MS) {
    this.socket = socket;
    this.socket.writeHead(200, STREAM_HEADERS);
    // Immediately, rather than with the first event: it flushes the head, so a subscriber that
    // arrives during a quiet minute still knows it is connected.
    this.write(`retry: ${String(retryMs)}\n\n`);
  }

  /** Whether the connection is still writable. */
  public get isOpen(): boolean {
    return !this.ended && !this.socket.writableEnded;
  }

  /**
   * One frame.
   *
   * `data` is JSON, which is also what makes a single `data:` line correct: `JSON.stringify`
   * escapes every newline, and a raw newline inside a value would otherwise end the frame early
   * and deliver half a row.
   */
  public send(name: string, data: unknown): void {
    this.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  public comment(text: string): void {
    this.write(`: ${text}\n\n`);
  }

  public onClose(handler: () => void): void {
    if (this.ended) {
      handler();
      return;
    }
    this.closeHandlers.push(handler);
  }

  public close(): void {
    if (this.ended) return;
    this.ended = true;
    try {
      this.socket.end();
    } catch {
      // The client vanished mid-write. There is nothing left to end, and the handlers below still
      // have to run or the subscription outlives the socket.
    }
    for (const handler of this.closeHandlers) handler();
    this.closeHandlers.length = 0;
  }

  /**
   * Writes, or drops the frame if the stream is over.
   *
   * Dropping rather than throwing is the contract the producers depend on: publishing must not be
   * able to fail at the caller, and "the browser closed the tab between two events" is the ordinary
   * case, not an error (core/ports/event-sink.ts).
   */
  private write(chunk: string): void {
    if (!this.isOpen) return;
    try {
      this.socket.write(chunk);
    } catch {
      this.close();
    }
  }
}
