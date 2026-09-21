// What a group press says on the page — P6-T4, D17.
//
// Turning core's codes into English is a decision, and it lives here for the reason
// `PresetsViewModel` gives: core answers with a closed union precisely so that nothing it says was
// composed from what the request contained, and the wording belongs where the reader is. A leaf
// `.ts` rather than a function in the banner component, because a type declared in a `.tsx` is
// `any` to the unit project (G.49).
//
// **The three tones are three different things to do next**, which is the whole reason a press is
// not reported as a boolean. Everything started: nothing to do. Some of it did: go and look at
// which. None of it did, or it was refused: the press did not happen and pressing again is
// reasonable. A single "did it work" would collapse the middle case into one of the outer two, and
// the middle case is the one a real morning produces.
import {
  startedCount,
  type GroupLaunchReport,
  type GroupRefusal,
} from '../../contracts/preset-group.ts';

/** One line per refusal. Exhaustive over the union by construction — a `Record` of it. */
const REFUSALS: Readonly<Record<GroupRefusal, string>> = {
  unknown_group: 'No preset carries that group name any more.',
  too_many: 'That group holds more presets than one press is allowed to start at once.',
  busy: 'A group is already starting. Wait for it to finish before pressing another.',
};

export interface GroupBannerLine {
  readonly tone: 'good' | 'mixed' | 'bad';
  readonly text: string;
  /** The presets that did not start, by name. Empty unless the tone is `mixed`. */
  readonly failed: readonly string[];
}

/**
 * The banner for the last group press, or `undefined` when there has not been one.
 *
 * The refusal wins when both are present, which cannot happen through `GroupSlice` — it clears one
 * as it sets the other — and is the right way round if it ever did: a refusal is about the press
 * that just happened, and a report left over from an earlier one would be stale news shown as new.
 */
export function groupBannerLine(
  report: GroupLaunchReport | undefined,
  refusal: GroupRefusal | undefined,
): GroupBannerLine | undefined {
  if (refusal !== undefined) return { tone: 'bad', text: REFUSALS[refusal], failed: [] };
  if (report === undefined) return undefined;

  const started = startedCount(report);
  const total = report.outcomes.length;
  const failed = report.outcomes
    .filter((outcome) => outcome.sessionId === undefined)
    .map((outcome) => outcome.name);

  if (total === 0)
    return { tone: 'bad', text: `${report.group} has no presets in it.`, failed: [] };
  if (started === 0) {
    return { tone: 'bad', text: `Nothing started from ${report.group}.`, failed: [] };
  }
  if (started === total) {
    return { tone: 'good', text: `Started ${sessions(started)} from ${report.group}.`, failed: [] };
  }
  return {
    tone: 'mixed',
    text: `Started ${String(started)} of ${String(total)} from ${report.group}.`,
    failed,
  };
}

/** `3 sessions`, `1 session`. Spelled out because the number is what the press cost. */
function sessions(count: number): string {
  return `${String(count)} session${count === 1 ? '' : 's'}`;
}
