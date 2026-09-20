// The deck's fourth fetch path, as a class of its own — P5a-T4.
//
// `WorkflowMapSlice`'s sibling, split for exactly the reason that one was: `DeckStore` owns the
// stream, the retry, the session detail, the two project reads and three lifecycle verbs, and it
// is at its 250-line limit. A fourth fetch path added as three more methods is the change that
// makes the file unreadable rather than merely long.
//
// **It is a slice, not a second store.** One `DeckState`, one set of subscribers; this is handed
// the API port and a way to publish, and holds nothing of its own.
//
// **The map's shape carries three states, not two.** A key ABSENT means nobody pressed the button,
// which is where every expanded row starts and where most of them stay. A key present holding
// `undefined` means a read is in flight. A key present holding a preview is an answer. The row
// draws a button, a spinner and a screen from those three, so a failed read has to REMOVE the key
// rather than leave it `undefined` — a permanent spinner is not an answer.
//
// **Nothing here is polled, ever.** One preview costs a 2.7 s spawn and 330 KB of terminal frame
// (RESEARCH.md F.2.5, which ends "never poll it"), so a read happens when somebody presses the
// button and at no other time. That is not a limitation to work around later; it is the
// measurement the feature was designed from.
import { CORE_PREVIEW_PATH } from '../../contracts/deck-routes.ts';
import { parseSessionPreview, type SessionPreview } from '../../contracts/session-preview.ts';
import { sessionRefQuery, type SessionRef } from '../../contracts/session-ref.ts';
import type { DeckApi } from './deck-api.ts';

/** Previews by `sessionKey` — the same key `details` uses, so a row reads both under one name. */
export type Previews = Readonly<Record<string, SessionPreview | undefined>>;

export class PreviewSlice {
  private readonly api: DeckApi;
  private readonly publish: (previews: Previews) => void;
  private held: Previews = {};

  /**
   * @param publish what to do with a new set of previews. A callback rather than the store, so
   * this is unit-testable against a function and knows nothing about `DeckState`.
   */
  constructor(api: DeckApi, publish: (previews: Previews) => void) {
    this.api = api;
    this.publish = publish;
  }

  /**
   * Reads one session's screen.
   *
   * **Re-asking is allowed**, unlike `DeckStore.expand`, and that is the whole refresh mechanism:
   * a preview is a photograph that goes stale the moment it arrives, so "is this still what it
   * looks like" is answered by pressing again. The guard is on a read being IN FLIGHT rather than
   * on one having been made, so a second press while the first is out does not spawn a second
   * `claude logs`.
   */
  public async read(ref: SessionRef): Promise<void> {
    const key = `${ref.subscription}:${ref.sessionId}`;
    if (key in this.held && this.held[key] === undefined) return;
    // Marked in flight BEFORE the await, so the row can draw its spinner immediately and the
    // guard above is true for the second press.
    this.set({ ...this.held, [key]: undefined });
    const reply = await this.api.get(`${CORE_PREVIEW_PATH}?${sessionRefQuery(ref)}`);
    const preview = reply?.status === 200 ? parseSessionPreview(reply.body) : undefined;
    // Dropped if it is not a preview or not THIS session's — the same rule the store's detail path
    // follows, and for the same reason: the id is the only field that says which row it belongs to
    // (CODING-STANDARDS §11 rule 1). A reply that could not be read forgets the key entirely, so
    // the button comes back instead of a spinner staying put.
    if (preview?.sessionId !== ref.sessionId) {
      this.forget(key);
      return;
    }
    this.set({ ...this.held, [key]: preview });
  }

  /**
   * Drops one row's preview, on collapse.
   *
   * The detail is dropped with it, and for a stronger version of the same reason: a screen from
   * four minutes ago that looks current is worse than a button.
   */
  public forget(key: string): void {
    if (!(key in this.held)) return;
    // Rebuilt without the key rather than `delete`d — absent and "in flight" are different states
    // here, so the key has to GO rather than become `undefined`.
    this.set(Object.fromEntries(Object.entries(this.held).filter(([name]) => name !== key)));
  }

  private set(previews: Previews): void {
    this.held = previews;
    this.publish(previews);
  }
}
