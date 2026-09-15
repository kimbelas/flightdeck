// The Ctrl+K palette's list, decided outside React — CODING-STANDARDS §3.
//
// **Every command in here does something today.** That is the one rule this file is written
// around. SPEC §5.4 lists six things the palette should eventually do — launch, switch project,
// jump to session, run Ask, change layout, connect — and three of them have no code behind them
// until P3 and P4. A palette that lists "Ask" and shrugs is worse than a palette that does not
// mention it: the first time it no-ops, the user stops trusting the other five entries too. So the
// list is built from what exists (deck-commands.ts) and it will grow when those tasks land.
//
// Filtering is every-term-must-appear rather than fuzzy. Fuzzy matching is the right answer for a
// thousand commands; for the twenty or so here it mostly means `ps` matching `Open a shell pane`
// through letters three words apart, which reads as a bug. Terms are matched against the label and
// the hint together, so `365 flightdeck` narrows to one row.
import { stepIndex } from '../../contracts/keymap.ts';

/** One entry. `run` is the command — the palette never inspects what it does. */
export interface DeckCommand {
  readonly id: string;
  readonly label: string;
  /** The greyed right-hand column: which subscription, which project, what state. */
  readonly hint: string;
  readonly run: () => void;
}

export class CommandPaletteViewModel {
  private readonly matched: readonly DeckCommand[];
  private readonly cursor: number;

  constructor(commands: readonly DeckCommand[], query: string, cursor: number) {
    this.matched = filtered(commands, query);
    this.cursor = cursor;
  }

  public get results(): readonly DeckCommand[] {
    return this.matched;
  }

  public get resultCount(): number {
    return this.matched.length;
  }

  /**
   * Which row is selected, clamped into the results that actually exist.
   *
   * Clamped rather than stored, because the results change under the cursor on every keystroke:
   * typing one more letter can take a list of nine down to two while the cursor sits on the sixth.
   * `-1` for an empty list is the one case that must not become `0` — `selected` would otherwise
   * hand back a command nobody can see.
   */
  public get selectedIndex(): number {
    if (this.matched.length === 0) return -1;
    return Math.min(Math.max(this.cursor, 0), this.matched.length - 1);
  }

  /** What `Enter` runs. `undefined` only when nothing matched. */
  public get selected(): DeckCommand | undefined {
    return this.matched[this.selectedIndex];
  }

  /** Where `↑`/`↓` land next, wrapping — the same step the session rows take (keymap.ts). */
  public stepped(delta: number): number {
    return stepIndex(this.selectedIndex, delta, this.matched.length);
  }
}

/** Case-insensitive, and every term has to land somewhere. An empty query matches everything. */
function filtered(commands: readonly DeckCommand[], query: string): readonly DeckCommand[] {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term !== '');
  if (terms.length === 0) return commands;
  return commands.filter((command) => {
    const haystack = `${command.label} ${command.hint}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}
