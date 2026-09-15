// The Ctrl+K palette's list — P2-T5, app/deck/command-palette-view-model.ts.
//
// The case worth the file is the cursor surviving a narrowing list: the results change under it on
// every keystroke, and a cursor that keeps its number while the list shrinks is how `Enter` runs a
// command the user cannot see.
import { describe, expect, it, vi } from 'vitest';
import {
  CommandPaletteViewModel,
  type DeckCommand,
} from '../../app/deck/command-palette-view-model.ts';

function command(id: string, label: string, hint = ''): DeckCommand {
  return { id, label, hint, run: vi.fn() };
}

const COMMANDS: readonly DeckCommand[] = [
  command('launch', 'Start a background session', 'launch'),
  command('shell', 'Open a shell pane', 'pane'),
  command('jump:a', 'Jump to flightdeck-core', '365 · flightdeck · working'),
  command('jump:b', 'Jump to invoice-import', 'isg · billing · blocked'),
];

function palette(query: string, cursor = 0): CommandPaletteViewModel {
  return new CommandPaletteViewModel(COMMANDS, query, cursor);
}

describe('CommandPaletteViewModel', () => {
  it('shows everything for an empty query, first result selected', () => {
    const view = palette('');
    expect(view.resultCount).toBe(4);
    expect(view.selectedIndex).toBe(0);
    expect(view.selected?.id).toBe('launch');
  });

  it('matches on the label and on the hint, case-insensitively', () => {
    expect(palette('SHELL').results.map((entry) => entry.id)).toEqual(['shell']);
    expect(palette('billing').results.map((entry) => entry.id)).toEqual(['jump:b']);
  });

  it('requires every term, so a second word narrows rather than widens', () => {
    expect(palette('jump').resultCount).toBe(2);
    expect(palette('jump 365').results.map((entry) => entry.id)).toEqual(['jump:a']);
    expect(palette('jump nothing').resultCount).toBe(0);
  });

  it('clamps a cursor that is past the end of a narrowed list', () => {
    // Cursor on the fourth result, then a query that leaves one. Without the clamp `selected` is
    // undefined and Enter does nothing; with it, Enter runs the one visible row.
    const view = new CommandPaletteViewModel(COMMANDS, 'shell', 3);
    expect(view.selectedIndex).toBe(0);
    expect(view.selected?.id).toBe('shell');
  });

  it('selects nothing when nothing matches, rather than the row that would have been first', () => {
    const view = palette('no such thing');
    expect(view.selectedIndex).toBe(-1);
    expect(view.selected).toBeUndefined();
  });

  it('steps through the results and wraps at both ends', () => {
    expect(palette('', 0).stepped(1)).toBe(1);
    expect(palette('', 3).stepped(1)).toBe(0);
    expect(palette('', 0).stepped(-1)).toBe(3);
  });

  it('steps to -1 in an empty list, so Enter has nothing to run', () => {
    expect(palette('no such thing').stepped(1)).toBe(-1);
  });
});
