// The deck's client state — CODING-STANDARDS §3 ("React is not exempt from OOP").
//
// A store class with immutable snapshots, bridged to React by `useSyncExternalStore`. Components
// render what this exposes and call its methods; none of the logic below belongs in a component.
//
// **It polls, and that is D30's cost made visible.** P1-T9's SSE stream and P1-T4's reconciler are
// not built, so there is nothing to subscribe to: the deck asks, or it does not know. That is the
// difference between live terminals and a live deck, and `refresh()` being a button the user can
// see is more honest than a spinner pretending otherwise.
import type { DeckSnapshot, SessionRow } from '../../contracts/session-row.ts';
import type { SubscriptionId } from '../../contracts/session.ts';

export interface DeckState {
  readonly rows: readonly SessionRow[];
  readonly unreadable: readonly SubscriptionId[];
  readonly coreUp: boolean;
  readonly loading: boolean;
  readonly error: string | undefined;
}

const EMPTY: DeckState = {
  rows: [],
  unreadable: [],
  coreUp: false,
  loading: false,
  error: undefined,
};

export class DeckStore {
  private state: DeckState = EMPTY;
  private readonly subscribers = new Set<() => void>();

  public subscribe = (listener: () => void): (() => void) => {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  };

  /** A stable reference per state, which is what `useSyncExternalStore` requires. */
  public snapshot = (): DeckState => this.state;

  /**
   * Re-reads both subscriptions through the same-origin rewrite.
   *
   * The token never appears here: `/api/core/*` is proxied server-side and `proxy.ts` attaches the
   * bearer on the way (SEC-HTTP-5). Only the PTY socket needs a token in the page (D31).
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
      this.set({
        rows: snapshot.rows,
        unreadable: snapshot.unreadable,
        coreUp: true,
        loading: false,
        error: undefined,
      });
    } catch {
      this.set({ loading: false, coreUp: false, error: 'Could not reach flightdeck-core.' });
    }
  }

  /**
   * Starts a background session, then refreshes.
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
      await this.refresh();
      return body.sessionId;
    } catch {
      this.set({ loading: false, error: 'Could not reach flightdeck-core.' });
      return undefined;
    }
  }

  private set(changes: Partial<DeckState>): void {
    this.state = { ...this.state, ...changes };
    for (const listener of this.subscribers) listener();
  }
}

function describe(status: number): string {
  if (status === 503) return 'flightdeck-core is not running.';
  if (status === 401 || status === 403)
    return 'Core refused the request — restart it to reissue the token.';
  return `Core answered ${String(status)}.`;
}
