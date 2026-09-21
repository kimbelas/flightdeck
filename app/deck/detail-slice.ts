// An expanded row's detail — the deck's second fetch path, in a class of its own (P4-T2).
//
// `PreviewSlice` is this one's twin and was split out first, which left the odd arrangement of a
// preview living in a slice and the detail it sits under living in the store. The fifth and sixth
// fetch paths put `deck-store.ts` back over its line limit, so the twin caught up.
//
// **A REQUEST, deliberately, where the rows are a stream.** The rows are the picture of the
// machine and belong on the stream; a detail is one session that one person just clicked, and
// broadcasting every expansion's worth of model text to every open deck would be pushing SEC-UI-2
// material nobody asked for.
//
// **Re-asked on every expand, never cached past a collapse.** `state.json` and `timeline.jsonl`
// move while the row is open, and a detail from four minutes ago that looks current is worse than
// a spinner.
import { CORE_SESSION_PATH } from '../../contracts/deck-routes.ts';
import { parseSessionDetail, type SessionDetail } from '../../contracts/session-detail.ts';
import { sessionRefQuery, type SessionRef } from '../../contracts/session-ref.ts';
import type { DeckApi } from './deck-api.ts';

/** Details by `sessionKey`. A key present with `undefined` means "asked, still waiting". */
export type SessionDetails = Readonly<Record<string, SessionDetail | undefined>>;

export class DetailSlice {
  private readonly api: DeckApi;
  private readonly publish: (details: SessionDetails) => void;
  private held: SessionDetails = {};

  /**
   * @param publish what to do with a new map. A callback rather than the store itself, so this can
   * be unit-tested against a function and knows nothing about `DeckState`.
   */
  constructor(api: DeckApi, publish: (details: SessionDetails) => void) {
    this.api = api;
    this.publish = publish;
  }

  /** Fetches one session's detail, unless this row has already asked. */
  public async read(ref: SessionRef): Promise<void> {
    const key = `${ref.subscription}:${ref.sessionId}`;
    // Marked as asked BEFORE the await, so a second click while the first is in flight does not
    // start a second request and the row can draw its spinner immediately.
    if (key in this.held) return;
    this.set(key, undefined);
    const reply = await this.api.get(`${CORE_SESSION_PATH}?${sessionRefQuery(ref)}`);
    // The row stays expanded with nothing in it rather than snapping shut under the pointer: a
    // detail that could not be read is a thing to say, and `SessionDetailView` says it.
    if (reply?.status !== 200) return;
    const detail = parseSessionDetail(reply.body);
    // A body that is not a detail is dropped exactly as an unparseable frame is (§11 rule 1) —
    // and it must not be rendered against this row, because the one field that is required is the
    // session id that says which row it belongs to.
    if (detail?.sessionId !== ref.sessionId) return;
    this.set(key, detail);
  }

  /** Drops one on collapse, so re-expanding is a fresh read. */
  public forget(key: string): void {
    if (!(key in this.held)) return;
    // Rebuilt without the key rather than `delete`d: absent and "asked, waiting" are different
    // states here — the spinner is drawn from the second — so the key has to GO, not become
    // `undefined`, and a filtered rebuild says that without a dynamic delete.
    this.held = Object.fromEntries(Object.entries(this.held).filter(([id]) => id !== key));
    this.publish(this.held);
  }

  private set(key: string, detail: SessionDetail | undefined): void {
    this.held = { ...this.held, [key]: detail };
    this.publish(this.held);
  }
}
