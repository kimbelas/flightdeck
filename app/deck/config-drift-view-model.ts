// What changed in this folder's configuration, in English — P3-T7, SPEC §5.1's first enhancement.
//
// Every decision about the WORDS is here rather than in the panel, which is the division
// CODING-STANDARDS §3 draws and which the rest of the deck already follows: the panel is markup.
//
// **The headline is an age, not a date.** `changed 3d ago` answers the question somebody actually
// has — is this news, or is it history — where `changed 18 September` makes them do arithmetic. The
// age is computed against a clock passed in rather than read here, so the same model under a test
// says the same thing at every hour of the day.
//
// **`+` and `−` rather than "added" and "removed".** A facet line is `hooks +1 · permissions +2 −1`
// and it has to fit beside the map's counts on a narrow column. The full names are behind the
// disclosure, where there is room for them.
import { agoLabel } from './ago.ts';
import type { ConfigChange, ConfigDrift } from '../../contracts/config-snapshot.ts';

/** One facet, ready to draw: what it is called and what arrived or left. */
export interface DriftLine {
  readonly facet: string;
  /** `hooks +1 −2`, for the closed summary. */
  readonly count: string;
  readonly added: readonly string[];
  readonly removed: readonly string[];
}

export class ConfigDriftViewModel {
  private readonly drift: ConfigDrift | undefined;
  private readonly now: number;

  /**
   * @param drift `undefined` for a folder whose configuration has never changed since it was
   * imported, which is the ordinary state of most of them and draws nothing at all.
   * @param now epoch ms, passed in for the reason every other age on this deck is.
   */
  constructor(drift: ConfigDrift | undefined, now: number) {
    this.drift = drift;
    this.now = now;
  }

  /** Whether there is anything to say. A folder that has never changed says nothing. */
  public get isKnown(): boolean {
    return this.drift !== undefined;
  }

  /** `changed 3d ago` — the chip that sits in the map's closed summary. */
  public get headline(): string {
    if (this.drift === undefined) return '';
    return `changed ${agoLabel(this.now - this.drift.at)} ago`;
  }

  /**
   * How long the configuration it replaced had stood — `after 2w`.
   *
   * It is the half that turns a change into a story: a hook edited twice in an hour and a hook
   * untouched since June are different things and the first number cannot tell them apart. Empty
   * when the previous snapshot has no instant, which a row written by an older build may not.
   */
  public get stood(): string {
    if (this.drift === undefined || this.drift.previousAt === 0) return '';
    return `after ${agoLabel(this.drift.at - this.drift.previousAt)}`;
  }

  /** One per facet that moved, in the order core reported them (`CONFIG_FACETS`). */
  public get lines(): readonly DriftLine[] {
    if (this.drift === undefined) return [];
    return this.drift.changes.map((change) => ({
      facet: change.facet,
      count: countOf(change),
      added: change.added,
      removed: change.removed,
    }));
  }
}

/** `+1`, `−2`, or both. Never neither: a change with nothing in it is dropped where it is parsed. */
function countOf(change: ConfigChange): string {
  const parts = [
    change.added.length === 0 ? '' : `+${String(change.added.length)}`,
    // U+2212 MINUS SIGN rather than a hyphen: it is the same width as the `+` beside it, which is
    // what stops a column of these looking ragged.
    change.removed.length === 0 ? '' : `−${String(change.removed.length)}`,
  ].filter((part) => part !== '');
  return `${change.facet} ${parts.join(' ')}`;
}
