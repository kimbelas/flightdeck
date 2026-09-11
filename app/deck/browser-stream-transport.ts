'use client';

// The browser's half of the store's stream — P1-T9.
//
// Two methods because the store needs two things from the environment and neither exists in a
// test: a connection, and a way to wait before retrying one. Injecting them is what keeps
// `DeckStore`'s reconnect logic testable without a real two-second pause (CODING-STANDARDS §10.1,
// the same argument as `Clock` and `Scheduler` in core).
import { BrowserEventStream } from './browser-event-stream.ts';
import type { EventStreamSource, StreamTransport } from './deck-store.ts';

export class BrowserStreamTransport implements StreamTransport {
  public open(url: string): EventStreamSource {
    return new BrowserEventStream(url);
  }

  public wait(ms: number, task: () => void): () => void {
    const timer = setTimeout(task, ms);
    return () => {
      clearTimeout(timer);
    };
  }
}
