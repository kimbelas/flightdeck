// What the deck receives for one session. The wire shape between core and the browser.
//
// A DTO rather than the `Session` entity: the entity has behaviour and a state machine, and
// serialising it would leak both into the page and freeze them as a contract. This is data.
//
// **`attachable` is the product fact this whole file exists to carry.** `claude attach` takes
// background sessions only — SPEC §5.2, *"vitals but read-only — interactive sessions cannot be
// attached"* — so a deck that offers a pane on every row offers one that cannot open. The answer
// is computed once, here, rather than re-derived by each caller from `kind`.
import type { ActivityStatus, RunState, SessionKind, SubscriptionId } from './session.ts';

export interface SessionRow {
  readonly sessionId: string;
  readonly shortId: string;
  readonly subscription: SubscriptionId;
  readonly kind: SessionKind;
  readonly name: string | undefined;
  readonly cwd: string;
  readonly startedAt: number;
  readonly live: boolean;
  readonly runState: RunState | undefined;
  readonly status: ActivityStatus | undefined;
  /** Whether a pane can be opened on it, and if not, the reason the deck should show. */
  readonly attachable: boolean;
  readonly notAttachableBecause: string | undefined;
}

export interface DeckSnapshot {
  readonly rows: readonly SessionRow[];
  /** Subscriptions whose sweep failed. The deck shows these rather than pretending they are empty. */
  readonly unreadable: readonly SubscriptionId[];
  readonly takenAt: number;
}

/** The reason shown on every interactive row. Written once so the wording cannot drift. */
export const INTERACTIVE_NOT_ATTACHABLE =
  'Interactive session — already bound to its own terminal. Only background sessions can be attached.';

export const NOT_LIVE = 'Not running. Resume it to attach.';
