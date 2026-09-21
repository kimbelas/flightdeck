// The deck's sixth fetch path — P3-T5, SPEC §5.1(b).
//
// `PreviewSlice`'s shape, for `PreviewSlice`'s reason, down to the three states: a key ABSENT means
// nobody pressed the button, a key present holding `undefined` means a read is in flight, and a key
// present holding a reading is an answer. A failed read REMOVES the key rather than leaving it
// `undefined`, because a permanent spinner is not an answer.
//
// **It is the most expensive read on the deck and it is never polled.** Measured on this
// repository's own folder: 68 transcripts, 90 MB, 976 ms — and on the owner's biggest project,
// live against the real core, 85 transcripts and 423 MB in 9 933 ms. That is four times the 2.7 s
// `claude logs` spawn `PreviewSlice` was built around (F.2.5, "never poll it"), so the rule is
// the same rule and then some: a read happens when somebody presses the button and at no other
// time.
//
// Re-asking IS allowed, exactly as a preview's is: this is a reading of what has happened, and
// "has anything happened since" is answered by pressing again. Core holds it for five minutes on a
// signature of the two transcript directories, so a second press usually costs 2 ms.
import { CORE_PROJECT_OBSERVED_PATH } from '../../contracts/deck-routes.ts';
import {
  parseObservedBehaviour,
  type ObservedBehaviour,
} from '../../contracts/observed-behaviour.ts';
import { projectKey } from '../../contracts/project.ts';
import type { DeckApi } from './deck-api.ts';

/** Readings by `projectKey` — the key the panel already files a status and a map under. */
export type Observations = Readonly<Record<string, ObservedBehaviour | undefined>>;

export class ObservedSlice {
  private readonly api: DeckApi;
  private readonly publish: (observed: Observations) => void;
  private held: Observations = {};

  constructor(api: DeckApi, publish: (observed: Observations) => void) {
    this.api = api;
    this.publish = publish;
  }

  /**
   * Reads one folder's transcripts.
   *
   * The guard is on a read being IN FLIGHT rather than on one having been made, so a second press
   * while the first is out does not start a second 90 MB walk.
   */
  public async read(path: string): Promise<void> {
    const key = projectKey(path);
    if (key in this.held && this.held[key] === undefined) return;
    // Marked in flight BEFORE the await, so the row draws its spinner immediately and the guard
    // above is true for the second press.
    this.set({ ...this.held, [key]: undefined });

    const reply = await this.api.get(
      `${CORE_PROJECT_OBSERVED_PATH}?path=${encodeURIComponent(path)}`,
    );
    const reading = reply?.status === 200 ? parseObservedBehaviour(reply.body) : undefined;
    // Dropped if it is not a reading or not THIS folder's — the rule every fetch path here
    // follows (CODING-STANDARDS §11 rule 1). The key goes entirely, so the button comes back.
    if (reading === undefined || projectKey(reading.path) !== key) {
      this.forget(key);
      return;
    }
    this.set({ ...this.held, [key]: reading });
  }

  /** Drops one folder's reading — on withdrawal, so a forgotten project leaves nothing behind. */
  public forget(key: string): void {
    if (!(key in this.held)) return;
    this.set(Object.fromEntries(Object.entries(this.held).filter(([name]) => name !== key)));
  }

  private set(observed: Observations): void {
    this.held = observed;
    this.publish(observed);
  }
}
