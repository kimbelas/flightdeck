// The preset groups the palette can press — P6-T4, D17.
//
// **A LEAF module, and both halves of that are load-bearing** (RESEARCH.md G.53).
//
// A `.ts` rather than a function in `deck-top.tsx`, because a type declared in a `.tsx` is `any`
// to the unit project — G.49, which is what moved `OpenPane` out of `deck-view.tsx` in P6-T1.
//
// And it imports NOTHING from `app/` — the target type is declared here rather than taken from
// `deck-commands.ts`, which `deck-commands.ts` then re-exports. That is not tidiness. A unit test
// importing an app module pulls that module's whole import graph into `tsconfig.json`'s program,
// which has no DOM lib; `deck-commands.ts` imports `deck-keyboard.ts`, so a single test of this
// function turned every `document` in that unrelated file into 48 `no-unsafe-*` errors. A leaf
// reaches only `contracts/`, which is in both projects on purpose.
import { MAX_GROUP_LAUNCH, presetGroups } from '../../contracts/preset-group.ts';
import type { LaunchPreset } from '../../contracts/launch-preset.ts';

/** One pressable group, reduced to what a palette entry needs — P6-T4. */
export interface GroupTarget {
  readonly key: string;
  readonly name: string;
  readonly presets: number;
  /** Whether it is over `MAX_GROUP_LAUNCH`. The entry says so rather than 400ing on the press. */
  readonly tooLarge: boolean;
}

/**
 * The preset groups as palette entries — P6-T4, D17.
 *
 * Derived from the presets the deck already holds rather than asked for: a group IS every preset
 * wearing its name (`presetGroups`), so there is nothing to fetch and nothing that can be stale
 * separately from the presets themselves.
 *
 * `tooLarge` is computed here rather than left to the press, so the palette can say what a press
 * would cost while somebody can still change their mind — core refuses it either way.
 */
export function groupTargets(presets: readonly LaunchPreset[]): readonly GroupTarget[] {
  return presetGroups(presets).map((group) => ({
    key: group.key,
    name: group.name,
    presets: group.presets.length,
    tooLarge: group.presets.length > MAX_GROUP_LAUNCH,
  }));
}
