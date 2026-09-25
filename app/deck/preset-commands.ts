// The palette's single presets and its ticket entry — P9-T4.
//
// A file of its own rather than two more functions in `deck-commands.ts`, which they would have
// pushed over `max-lines`. What each entry sends is decided in `preset-targets.ts`, a leaf a unit
// test can import; this turns a target into a `DeckCommand` and is the part that touches the page.
//
// **One entry depends on what is typed, and this is where the query arrives.** Every other entry
// is a fixed list the palette filters. `Plan <id> in <project>` names the id, so it is built per
// keystroke: `useDeckKeys` hands its query to `deckCommands`, which asks `planCommands` for it. The
// palette's view model stays a filter over whatever it is given, and the entry still has to pass
// that filter like any other — its label carries the id, so the query that made it matches it.
import type { PresetLaunch } from '../../contracts/launch-preset.ts';
import type { DeckCommand } from './command-palette-view-model.ts';
import { openPreset } from './deck-keyboard.ts';
import type { PresetTarget } from './preset-targets.ts';

/** What the preset entries need from the deck: the targets, the query's, and the one verb. */
export interface PresetCommandTargets {
  readonly presetTargets: readonly PresetTarget[];
  /** `ticketTarget` over the deck's current state, or `undefined` for a query that is not one. */
  readonly planTarget: (query: string) => PresetTarget | undefined;
  /** `DeckActions.onLaunch` — the presets panel's start, so the two cannot drift. */
  readonly onLaunch: (request: PresetLaunch) => void;
}

/** `Launch <project> · <preset>`, in the order `presetTargets` decided. */
export function presetCommands(targets: PresetCommandTargets): readonly DeckCommand[] {
  return targets.presetTargets.map((target) => commandOf(target, targets));
}

/** `Plan <id> in <project>` for a ticket-shaped query in a current project, else nothing. */
export function planCommands(targets: PresetCommandTargets, query: string): readonly DeckCommand[] {
  const target = targets.planTarget(query);
  return target === undefined ? [] : [commandOf(target, targets)];
}

function commandOf(target: PresetTarget, targets: PresetCommandTargets): DeckCommand {
  const { launch } = target;
  return {
    id: target.key,
    label: target.label,
    hint: target.hint,
    run: () => {
      if (launch === undefined) openPreset(target.chip, target.box);
      else targets.onLaunch(launch);
    },
  };
}
