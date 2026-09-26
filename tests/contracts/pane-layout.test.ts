// The layout vocabulary — P5a-T5.
import { describe, expect, it } from 'vitest';
import {
  defaultLayout,
  isPaneLayout,
  layoutCapacity,
  layoutClass,
  layoutRows,
  MAX_PANES,
  movePane,
  PANE_LAYOUTS,
  type PaneLayout,
} from '../../contracts/pane-layout.ts';

describe('the layouts on offer', () => {
  it('is SPEC §5.3s list, in order, and focus last', () => {
    expect(PANE_LAYOUTS).toEqual([1, 2, 4, 6, 9, 'focus']);
  });

  it('caps the deck at the largest grid', () => {
    expect(MAX_PANES).toBe(9);
  });

  it('gives every layout a class the stylesheet can match', () => {
    expect(PANE_LAYOUTS.map(layoutClass)).toEqual([
      'panes-1',
      'panes-2',
      'panes-4',
      'panes-6',
      'panes-9',
      'panes-focus',
    ]);
  });

  it('reports each grids capacity, and focus modes as the maximum', () => {
    expect(PANE_LAYOUTS.map(layoutCapacity)).toEqual([1, 2, 4, 6, 9, 9]);
  });
});

describe('how many rows share one screen', () => {
  const grids: readonly PaneLayout[] = [1, 2, 4, 6, 9];

  it('is the rows a full grid is cut into, whatever is open past that', () => {
    expect(grids.map((layout) => layoutRows(layout, 9))).toEqual([1, 1, 2, 2, 3]);
  });

  it('is only the rows that exist when fewer panes are open, so they fill the screen', () => {
    expect(layoutRows(9, 4)).toBe(2);
    expect(layoutRows(9, 3)).toBe(1);
    expect(layoutRows(6, 2)).toBe(1);
    expect(layoutRows(4, 3)).toBe(2);
  });

  it('is one row with nothing open, never zero', () => {
    for (const layout of grids) expect(layoutRows(layout, 0)).toBe(1);
  });

  it('has no answer for focus mode, which is not a grid', () => {
    expect(layoutRows('focus', 9)).toBeUndefined();
  });
});

describe('the layout nobody chose', () => {
  it('is the smallest grid the open panes fit in', () => {
    const chosen = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(defaultLayout);
    expect(chosen).toEqual([1, 1, 2, 4, 4, 6, 6, 9, 9, 9]);
  });

  it('never answers focus mode, which is only ever chosen on purpose', () => {
    for (let count = 0; count <= 12; count += 1) {
      expect(defaultLayout(count)).not.toBe('focus');
    }
  });

  it('stays at the largest grid past the cap rather than growing one', () => {
    expect(defaultLayout(20)).toBe(MAX_PANES);
  });
});

describe('reading a layout back out of storage', () => {
  it('accepts every layout it offers', () => {
    for (const layout of PANE_LAYOUTS) expect(isPaneLayout(layout)).toBe(true);
  });

  it('refuses a number that is not one of them, so a stale value falls back', () => {
    // `3` was never a layout and `"2"` is what a hand-edited localStorage entry looks like.
    expect(isPaneLayout(3)).toBe(false);
    expect(isPaneLayout('2')).toBe(false);
    expect(isPaneLayout(null)).toBe(false);
    expect(isPaneLayout(undefined)).toBe(false);
    expect(isPaneLayout({ layout: 4 })).toBe(false);
  });
});

describe('moving the focused pane along the row', () => {
  const panes: readonly string[] = ['a', 'b', 'c', 'd'];

  it('swaps it with its neighbour to the right', () => {
    expect(movePane(panes, 'b', 1)).toEqual(['a', 'c', 'b', 'd']);
  });

  it('swaps it with its neighbour to the left', () => {
    expect(movePane(panes, 'c', -1)).toEqual(['a', 'c', 'b', 'd']);
  });

  it('clamps at the ends rather than wrapping around the row', () => {
    // Wrapping would send the pane you are watching to the far side of the screen and renumber
    // every other one, which is a different thing from "move it along".
    expect(movePane(panes, 'a', -1)).toEqual(panes);
    expect(movePane(panes, 'd', 1)).toEqual(panes);
  });

  it('returns the same array when nothing moved, so no re-render is provoked', () => {
    expect(movePane(panes, 'a', -1)).toBe(panes);
    expect(movePane(panes, 'd', 1)).toBe(panes);
    expect(movePane(panes, 'nobody', 1)).toBe(panes);
  });

  it('carries a pane further than one place when asked', () => {
    expect(movePane(panes, 'a', 2)).toEqual(['b', 'c', 'a', 'd']);
  });

  it('clamps an overshoot to the end instead of dropping the pane', () => {
    expect(movePane(panes, 'a', 99)).toEqual(['b', 'c', 'd', 'a']);
    expect(movePane(panes, 'd', -99)).toEqual(['d', 'a', 'b', 'c']);
  });

  it('keeps every pane, whatever it is asked', () => {
    for (const delta of [-99, -2, -1, 0, 1, 2, 99]) {
      for (const key of panes) {
        expect([...movePane(panes, key, delta)].toSorted()).toEqual(['a', 'b', 'c', 'd']);
      }
    }
  });

  it('does nothing for a delta of zero', () => {
    expect(movePane(panes, 'b', 0)).toBe(panes);
  });
});

describe('the type guard and the list agree', () => {
  it('has a capacity and a class for every layout the guard admits', () => {
    const layouts: readonly PaneLayout[] = PANE_LAYOUTS;
    for (const layout of layouts) {
      expect(layoutCapacity(layout)).toBeGreaterThan(0);
      expect(layoutClass(layout)).toMatch(/^panes-/u);
    }
  });
});
