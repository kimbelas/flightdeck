// The view vocabulary — P10-T1.
import { describe, expect, it } from 'vitest';
import {
  BUILT_VIEWS,
  DECK_VIEWS,
  DEFAULT_VIEW,
  isBuiltView,
  VIEW_LABELS,
} from '../../contracts/deck-view.ts';

describe('the deck views', () => {
  it('offers Board, Panes and Table, in that order', () => {
    expect(DECK_VIEWS.map((view) => VIEW_LABELS[view])).toEqual(['Board', 'Panes', 'Table']);
  });

  it('opens on the board', () => {
    expect(DEFAULT_VIEW).toBe('board');
    expect(BUILT_VIEWS).toContain(DEFAULT_VIEW);
  });

  it('accepts the built views back out of storage', () => {
    expect(isBuiltView('board')).toBe(true);
    expect(isBuiltView('panes')).toBe(true);
  });

  it('refuses the placeholder, and anything it does not know', () => {
    expect(isBuiltView('table')).toBe(false);
    expect(isBuiltView('Board')).toBe(false);
    expect(isBuiltView(undefined)).toBe(false);
    expect(isBuiltView(2)).toBe(false);
  });
});
