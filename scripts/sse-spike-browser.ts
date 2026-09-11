// P0-T8 — the half only a real browser can answer.
//
// The Node probe measures buffering, which is a property of the server. What it cannot prove is
// that the page is *allowed* to open the stream at all: `EventSource` is subject to the CSP's
// connect-src, it cannot set a single header, and what it sends is decided by Chromium rather
// than by us. P0-T7 made the same split for the same reason — a Node client that sets its own
// Origin proves nothing about Origin (RESEARCH.md F.4.1).
import { chromium, type Browser } from 'playwright';

export interface BrowserStream {
  readonly opened: boolean;
  readonly events: number;
  readonly firstEventMs: number;
  readonly gapsMs: readonly number[];
  readonly error: string | undefined;
}

/** Opens an EventSource from the deck page and reports when each event landed, in page time. */
export class BrowserSseCheck {
  private readonly origin: string;

  constructor(origin: string) {
    this.origin = origin;
  }

  public async run(path: string, expected: number): Promise<BrowserStream> {
    let browser: Browser | undefined;
    try {
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      await page.goto(this.origin, { waitUntil: 'load' });
      // Callback form, never the string form: the string form is `eval` inside the page, which
      // this CSP correctly refuses (RESEARCH.md F.5.1).
      return await page.evaluate(collect, { path, expected });
    } finally {
      await browser?.close();
    }
  }
}

/**
 * Runs inside the page. Resolves when `expected` events have arrived or the stream ends.
 *
 * `EventSource` reconnects on close by design, so it is closed explicitly the moment the count
 * is reached — otherwise the page reopens the stream forever and the browser is left holding a
 * producer nobody is reading.
 */
function collect(input: { path: string; expected: number }): Promise<BrowserStream> {
  return new Promise((resolve) => {
    const startedAt = performance.now();
    const at: number[] = [];
    const source = new EventSource(input.path);
    const finish = (error: string | undefined): void => {
      source.close();
      const gapsMs = at
        .slice(1)
        .map((value, index) => Number((value - (at[index] ?? 0)).toFixed(1)));
      resolve({
        opened: at.length > 0,
        events: at.length,
        firstEventMs: Number((at[0] ?? -1).toFixed(1)),
        gapsMs,
        error,
      });
    };
    source.addEventListener('session.updated', () => {
      at.push(performance.now() - startedAt);
      if (at.length >= input.expected) finish(undefined);
    });
    source.addEventListener('error', () => {
      finish(at.length > 0 ? undefined : 'EventSource error before any event');
    });
    setTimeout(() => {
      finish(at.length > 0 ? undefined : 'no events within the budget');
    }, 20_000);
  });
}
