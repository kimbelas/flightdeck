// Pressing a preset group — P6-T4, D17.
//
// **The one button in the deck that spends real money on a single press.** N background sessions,
// N first prompts, N first turns of the 5-hour window. So this slice does two things beyond the
// POST, and both are about that:
//
// **It refuses to send a second press while one is out.** Core refuses too (`GroupLauncher`), and
// core's is the guard that actually counts, because it is the one a second TAB cannot get past.
// This one exists so that a double-click never becomes a request at all: the second press is
// dropped here rather than travelling to core and coming back as an error that would make the deck
// look broken for doing the right thing.
//
// **It keeps the last report, not just an error.** A group press has no single outcome: three
// started and one did not is the normal shape of a bad morning, and "which one" is the only useful
// thing to say. A boolean would throw that away.
//
// **It is a slice, not a second store.** One `DeckState`, one set of subscribers; it is handed the
// API port and a way to publish, and holds nothing of its own.
import { CORE_GROUP_LAUNCH_PATH } from '../../contracts/deck-routes.ts';
import {
  parseGroupLaunchReport,
  type GroupLaunchReport,
  type GroupRefusal,
} from '../../contracts/preset-group.ts';
import type { DeckApi } from './deck-api.ts';

/** The two fields of `DeckState` this slice touches. */
export interface GroupHeld {
  /** The last press's report, or `undefined` before the first one. */
  readonly groupReport: GroupLaunchReport | undefined;
  /** Why the last press was refused outright, as core's code. `undefined` once one is accepted. */
  readonly groupRefusal: GroupRefusal | undefined;
}

/** The refusals this build knows. Unknown codes are dropped rather than shown raw (§11 rule 1). */
const REFUSALS: readonly GroupRefusal[] = ['unknown_group', 'too_many', 'busy'];

export class GroupSlice {
  private readonly api: DeckApi;
  private readonly publish: (changes: Partial<GroupHeld>) => void;
  private pressing = false;

  constructor(api: DeckApi, publish: (changes: Partial<GroupHeld>) => void) {
    this.api = api;
    this.publish = publish;
  }

  /**
   * Presses one group.
   *
   * @returns whether core accepted the press — NOT whether every session started. A report with
   * three failures is an accepted press, and the difference is the whole reason `groupReport` is
   * kept beside `groupRefusal` rather than folded into one error string.
   */
  public async launch(group: string): Promise<boolean> {
    if (this.pressing) return false;
    this.pressing = true;
    this.publish({ groupRefusal: undefined });
    try {
      const reply = await this.api.post(CORE_GROUP_LAUNCH_PATH, { group });
      const report = reply?.status === 200 ? parseGroupLaunchReport(reply.body) : undefined;
      if (report !== undefined) {
        this.publish({ groupReport: report, groupRefusal: undefined });
        return true;
      }
      this.publish({ groupRefusal: refusalOf(reply?.body) });
      return false;
    } finally {
      this.pressing = false;
    }
  }

  /** Clears the last press, so the panel can be dismissed. */
  public clear(): void {
    this.publish({ groupReport: undefined, groupRefusal: undefined });
  }
}

/**
 * Core's code out of an error body, or `busy` as the honest fallback.
 *
 * `busy` rather than a generic failure, because it is the refusal a person can act on by waiting —
 * and because an unreachable core, which is the case that produces no body at all, is the one
 * where "it is already doing something" is the safest thing to have believed: it stops a second
 * press from spending quota core may already have spent.
 */
function refusalOf(body: unknown): GroupRefusal {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return 'busy';
  const fields: Readonly<Record<string, unknown>> = Object.fromEntries(Object.entries(body));
  return REFUSALS.find((known) => known === fields['error']) ?? 'busy';
}
