// The deck's client state — CODING-STANDARDS §3 ("React is not exempt from OOP").
//
// A store class with immutable snapshots, bridged to React by `useSyncExternalStore`. Components
// render what this exposes and call its methods; none of the logic below belongs in a component.
//
// **It subscribes; it no longer polls.** P1-T9 gave core an event stream, so the deck's first frame
// is the whole picture and every one after it is a delta — the reconciler sweeps every 10 s and
// what it finds arrives here without anyone asking. `refresh()` survives as a deliberate act rather
// than as the update mechanism: it forces a fresh sweep now, which is also how the `unreadable`
// banner moves (SessionStreamRoute — a subscription core cannot read publishes no event).
//
// **Reconnection is this class's job, not the browser's.** An `EventSource` retries a dropped
// connection on its own but gives up permanently on an HTTP error, and "core is not running" is
// exactly that: the route handler answers 503 (RESEARCH.md F.6.7). Since core restarting is an
// ordinary event on this machine (F.3.3), a deck that stopped retrying would be a deck that needs
// a page reload every time. One path for both cases: close, wait, reopen.
import {
  byAttentionThenAge,
  sessionKey,
  type DeckSnapshot,
  type SessionRow,
} from '../../contracts/session-row.ts';
import type { SubscriptionId } from '../../contracts/session.ts';
import {
  DECK_STREAM_PATH,
  parseStreamFrame,
  STREAM_FRAME_NAMES,
  type StreamFrameName,
} from '../../contracts/stream-event.ts';

export interface DeckState {
  readonly rows: readonly SessionRow[];
  readonly unreadable: readonly SubscriptionId[];
  readonly coreUp: boolean;
  readonly loading: boolean;
  readonly error: string | undefined;
}

/**
 * One open connection to the stream, reduced to what the store uses.
 *
 * An interface rather than `EventSource` itself, for the same reason every port in core is one:
 * this file is unit-tested without a browser, and a DOM type here would also make it untypeable by
 * the Node TypeScript project the tests compile under (tsconfig.json vs tsconfig.app.json).
 */
export interface EventStreamSource {
  /** @param listener receives the frame's `data` text, unparsed. */
  on(type: string, listener: (data: string) => void): void;
  close(): void;
}

/** What the store needs from the browser: a connection, and a way to wait before retrying. */
export interface StreamTransport {
  open(url: string): EventStreamSource;
  /** @returns a cancel. Calling it after the task has run is a no-op. */
  wait(ms: number, task: () => void): () => void;
}

/** Matches core's own `retry:` hint (SseStream). Loopback; there is nothing to back off from. */
const RECONNECT_MS = 2000;

const EMPTY: DeckState = {
  rows: [],
  unreadable: [],
  coreUp: false,
  loading: false,
  error: undefined,
};

export class DeckStore {
  private readonly subscribers = new Set<() => void>();
  private readonly transport: StreamTransport;
  private state: DeckState = EMPTY;
  private source: EventStreamSource | undefined;
  private cancelRetry: (() => void) | undefined;

  constructor(transport: StreamTransport) {
    this.transport = transport;
  }

  public subscribe = (listener: () => void): (() => void) => {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  };

  /** A stable reference per state, which is what `useSyncExternalStore` requires. */
  public snapshot = (): DeckState => this.state;

  /**
   * Opens the stream. Idempotent — a second call while one is open does nothing.
   *
   * Idempotent because React's StrictMode mounts an effect twice in development, and two
   * connections would be two subscriptions at core and two snapshots racing into this state.
   */
  public connect(): void {
    if (this.source !== undefined) return;
    this.set({ loading: true });
    const source = this.transport.open(DECK_STREAM_PATH);
    this.source = source;
    for (const name of STREAM_FRAME_NAMES) {
      source.on(name, (data) => {
        this.receive(name, data);
      });
    }
    source.on('error', () => {
      this.reopenLater();
    });
  }

  /** Closes the stream and cancels any pending retry. Idempotent. */
  public disconnect(): void {
    this.cancelRetry?.();
    this.cancelRetry = undefined;
    this.source?.close();
    this.source = undefined;
  }

  /**
   * Sweeps both subscriptions now, through the same-origin rewrite.
   *
   * The token never appears here: `/api/core/*` is proxied server-side and `proxy.ts` attaches the
   * bearer on the way (SEC-HTTP-5). Only the PTY socket needs a credential in the page, and it is
   * a ticket rather than the token (D32).
   */
  public async refresh(): Promise<void> {
    this.set({ loading: true, error: undefined });
    try {
      const response = await fetch('/api/core/sessions', {
        headers: { accept: 'application/json' },
      });
      if (!response.ok) {
        // Core down is an ordinary state the deck renders, not an exception (RESEARCH.md F.3.3).
        this.set({ loading: false, coreUp: false, error: describe(response.status) });
        return;
      }
      const snapshot = (await response.json()) as DeckSnapshot;
      this.apply(snapshot);
    } catch {
      this.set({ loading: false, coreUp: false, error: 'Could not reach flightdeck-core.' });
    }
  }

  /**
   * Starts a background session.
   *
   * Nothing is fetched afterwards: the reconciler's next sweep publishes the new session as a
   * `session.upsert` and it arrives on the stream. A launch that returned an id core has not seen
   * yet is exactly the case P1-T4's two-sweep rule exists for (RESEARCH.md G.2).
   *
   * @returns the new session's id, or `undefined` if it could not start.
   */
  public async launch(
    subscription: SubscriptionId,
    prompt: string,
    name: string | undefined,
  ): Promise<string | undefined> {
    this.set({ loading: true, error: undefined });
    try {
      const response = await fetch('/api/core/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ subscription, prompt, name }),
      });
      if (!response.ok) {
        this.set({ loading: false, error: describe(response.status) });
        return undefined;
      }
      const body = (await response.json()) as { sessionId: string };
      this.set({ loading: false });
      return body.sessionId;
    } catch {
      this.set({ loading: false, error: 'Could not reach flightdeck-core.' });
      return undefined;
    }
  }

  /** One frame. Anything that does not parse is dropped rather than rendered (§11 rule 1). */
  private receive(name: StreamFrameName, data: string): void {
    const frame = parseStreamFrame(name, data);
    if (frame === undefined) return;
    switch (frame.name) {
      case 'snapshot':
        this.apply(frame.data);
        return;
      case 'session.upsert':
        this.set({ rows: upsert(this.state.rows, frame.data), coreUp: true, loading: false });
        return;
      case 'session.gone':
        this.set({ rows: without(this.state.rows, sessionKey(frame.data)) });
        return;
    }
  }

  private apply(snapshot: DeckSnapshot): void {
    this.set({
      rows: snapshot.rows,
      unreadable: snapshot.unreadable,
      coreUp: true,
      loading: false,
      error: undefined,
    });
  }

  /** Dropped, or refused — the page cannot tell those apart, and does not need to. */
  private reopenLater(): void {
    if (this.source === undefined) return;
    this.source.close();
    this.source = undefined;
    this.set({ coreUp: false, loading: false, error: 'flightdeck-core is not answering.' });
    this.cancelRetry = this.transport.wait(RECONNECT_MS, () => {
      this.cancelRetry = undefined;
      this.connect();
    });
  }

  private set(changes: Partial<DeckState>): void {
    this.state = { ...this.state, ...changes };
    for (const listener of this.subscribers) listener();
  }
}

/** Replaces the row if it is already known, appends it if not, and re-sorts either way. */
function upsert(rows: readonly SessionRow[], row: SessionRow): readonly SessionRow[] {
  return [...without(rows, sessionKey(row)), row].sort(byAttentionThenAge);
}

function without(rows: readonly SessionRow[], key: string): readonly SessionRow[] {
  return rows.filter((row) => sessionKey(row) !== key);
}

function describe(status: number): string {
  if (status === 503) return 'flightdeck-core is not running.';
  if (status === 401 || status === 403)
    return 'Core refused the request — restart it to reissue the token.';
  return `Core answered ${String(status)}.`;
}
