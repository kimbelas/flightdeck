// The cost panel's fetch path — P7-T3.
//
// `InstallSlice`'s shape: exposed on the store rather than re-wrapped, because the store adds
// nothing on the way past. **It is read when the panel opens and when somebody presses refresh,
// never on a timer.** Core has done the reading already (`SpendLedger`), so an open costs two
// queries over a few hundred rows — cheap enough not to need a button, and still nothing the
// deck should spend while nobody is looking at the panel.
//
// **A failed read keeps the last summary on screen** and says it failed, for the reason
// `DeckStore.fail` keeps the rows: the numbers from a minute ago are still the best anyone has.
import { CORE_SPEND_PATH } from '../../contracts/deck-routes.ts';
import { parseSpendSummary, type SpendSummary } from '../../contracts/spend-summary.ts';
import type { DeckApi } from './deck-api.ts';

/** The one field of `DeckState` this slice owns. */
export interface SpendHeld {
  /** The last summary core gave, or `undefined` before the panel was first opened. */
  readonly summary: SpendSummary | undefined;
  /** A read is in flight. */
  readonly reading: boolean;
  /** The last read reached nobody, or came back as something that is not a summary. */
  readonly failed: boolean;
}

export const NO_SPEND_HELD: SpendHeld = { summary: undefined, reading: false, failed: false };

export class SpendSlice {
  private readonly api: DeckApi;
  private readonly publish: (changes: { readonly spend: SpendHeld }) => void;
  private held: SpendHeld = NO_SPEND_HELD;

  constructor(api: DeckApi, publish: (changes: { readonly spend: SpendHeld }) => void) {
    this.api = api;
    this.publish = publish;
  }

  /** Reads the summary. A second call while one is in flight does nothing. */
  public async load(): Promise<void> {
    if (this.held.reading) return;
    this.set({ ...this.held, reading: true });
    const reply = await this.api.get(CORE_SPEND_PATH);
    const summary = reply?.status === 200 ? parseSpendSummary(reply.body) : undefined;
    if (summary === undefined) {
      this.set({ ...this.held, reading: false, failed: true });
      return;
    }
    this.set({ summary, reading: false, failed: false });
  }

  private set(spend: SpendHeld): void {
    this.held = spend;
    this.publish({ spend });
  }
}
