// P1-T9. The wire format, and the promise that writing to a stream can never fail at the caller.
//
// The headers are asserted by name rather than as a block: `no-transform` is the one P0-T8 measured
// (RESEARCH.md F.6.3) and a diff that dropped it would otherwise pass a `toEqual` that someone
// updated to match.
import { describe, expect, it } from 'vitest';
import { SseStream, type StreamSocket } from '../../../core/http/sse-stream.ts';

class FakeSocket implements StreamSocket {
  public status = 0;
  public headers: Readonly<Record<string, string>> = {};
  public readonly chunks: string[] = [];
  public writableEnded = false;
  public failWrites = false;

  public get body(): string {
    return this.chunks.join('');
  }

  public writeHead(status: number, headers: Readonly<Record<string, string>>): void {
    this.status = status;
    this.headers = headers;
  }

  public write(chunk: string): boolean {
    if (this.failWrites) throw new Error('EPIPE');
    this.chunks.push(chunk);
    return true;
  }

  public end(): void {
    this.writableEnded = true;
  }
}

describe('SseStream — the head', () => {
  it('answers 200 with the event-stream content type', () => {
    const socket = new FakeSocket();

    new SseStream(socket);

    expect(socket.status).toBe(200);
    expect(socket.headers['content-type']).toBe('text/event-stream; charset=utf-8');
  });

  it('sets no-transform, which is the only header that stops Next gzipping the stream', () => {
    const socket = new FakeSocket();

    new SseStream(socket);

    expect(socket.headers['cache-control']).toBe('no-store, no-transform');
  });

  it('states the reconnect delay before anything else, which also flushes the head', () => {
    const socket = new FakeSocket();

    new SseStream(socket, 1500);

    expect(socket.chunks[0]).toBe('retry: 1500\n\n');
  });
});

describe('SseStream — frames', () => {
  it('writes an event and its JSON payload', () => {
    const socket = new FakeSocket();

    new SseStream(socket).send('session.upsert', { sessionId: 'a' });

    expect(socket.body).toContain('event: session.upsert\ndata: {"sessionId":"a"}\n\n');
  });

  it('keeps a payload containing a newline on one data line', () => {
    // A raw newline would end the frame early and deliver half a row. JSON.stringify escapes it,
    // which is the reason `data:` is written once rather than split per line.
    const socket = new FakeSocket();

    new SseStream(socket).send('session.upsert', { name: 'two\nlines' });

    expect(socket.body).toContain('data: {"name":"two\\nlines"}\n\n');
    expect(socket.body.split('\n').filter((line) => line.startsWith('data:'))).toHaveLength(1);
  });

  it('writes a comment that carries no event name', () => {
    const socket = new FakeSocket();

    new SseStream(socket).comment('hb');

    expect(socket.body).toContain(': hb\n\n');
    expect(socket.body).not.toContain('event: hb');
  });
});

describe('SseStream — closing', () => {
  it('ends the socket once, however many times it is closed', () => {
    const socket = new FakeSocket();
    const stream = new SseStream(socket);
    let closes = 0;
    stream.onClose(() => {
      closes += 1;
    });

    stream.close();
    stream.close();

    expect(closes).toBe(1);
    expect(socket.writableEnded).toBe(true);
  });

  it('drops a frame written after the client has gone, rather than throwing at the producer', () => {
    const socket = new FakeSocket();
    const stream = new SseStream(socket);
    stream.close();
    const after = socket.body;

    expect(() => {
      stream.send('session.upsert', { sessionId: 'a' });
    }).not.toThrow();
    expect(socket.body).toBe(after);
  });

  it('closes itself when the socket fails mid-write, so the subscription is released', () => {
    const socket = new FakeSocket();
    const stream = new SseStream(socket);
    let closed = false;
    stream.onClose(() => {
      closed = true;
    });

    socket.failWrites = true;
    expect(() => {
      stream.send('session.upsert', {});
    }).not.toThrow();

    expect(closed).toBe(true);
    expect(stream.isOpen).toBe(false);
  });

  it('runs a close handler registered after the close, rather than dropping it', () => {
    const socket = new FakeSocket();
    const stream = new SseStream(socket);
    stream.close();
    let closed = false;

    stream.onClose(() => {
      closed = true;
    });

    expect(closed).toBe(true);
  });

  it('treats a socket ended under it as closed', () => {
    const socket = new FakeSocket();
    const stream = new SseStream(socket);

    socket.writableEnded = true;

    expect(stream.isOpen).toBe(false);
  });
});
