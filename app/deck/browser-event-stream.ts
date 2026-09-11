'use client';

// `EventSource`, reduced to the two methods the store uses — P1-T9.
//
// The wrapper exists so `DeckStore` can be unit-tested without a browser, and for a second reason
// that is easy to miss: the tests compile under the Node TypeScript project, which has no DOM lib
// at all (tsconfig.json vs tsconfig.app.json). A store that named `EventSource` would not type-check
// in the project its own test lives in. The DOM stops here.
//
// Reconnection is deliberately NOT here. `EventSource` retries a dropped socket by itself but gives
// up for good on an HTTP error, which is precisely what core being down looks like — so the store
// owns retrying and this class stays a connection and nothing else.
import type { EventStreamSource } from './deck-store.ts';

export class BrowserEventStream implements EventStreamSource {
  private readonly source: EventSource;

  constructor(url: string) {
    this.source = new EventSource(url);
  }

  /**
   * Subscribes to one named frame.
   *
   * The listener is handed the raw `data` text rather than the event, so nothing above this file
   * touches a DOM type. A frame with no string payload — `error` and `open` carry none — arrives
   * as an empty string.
   */
  public on(type: string, listener: (data: string) => void): void {
    this.source.addEventListener(type, (event: Event) => {
      listener(event instanceof MessageEvent && typeof event.data === 'string' ? event.data : '');
    });
  }

  public close(): void {
    this.source.close();
  }
}
