// Which view the deck is on, and whether the rail is folded away — P10-T1.
//
// Facts about this browser, so they live in `localStorage` beside the layout and the current
// project rather than in core or in `DeckState` (`use-current-project.ts` gives the reason: two
// windows on two views is a reasonable thing to want). Read after mount, never during render, so
// the first client render matches the server's.
import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_VIEW, isBuiltView, type DeckViewMode } from '../../contracts/deck-view.ts';

const VIEW_KEY = 'flightdeck.deck-view';
const RAIL_KEY = 'flightdeck.rail-folded';

export interface DeckView {
  readonly view: DeckViewMode;
  readonly setView: (view: DeckViewMode) => void;
  /** Whether the rail's panels are folded away, leaving the strip that unfolds them. */
  readonly railFolded: boolean;
  readonly setRailFolded: (folded: boolean) => void;
}

export function useDeckView(): DeckView {
  const [view, setViewState] = useState<DeckViewMode>(DEFAULT_VIEW);
  const [railFolded, setFoldedState] = useState(false);

  useEffect(() => {
    const stored = read(VIEW_KEY);
    if (isBuiltView(stored)) setViewState(stored);
    setFoldedState(read(RAIL_KEY) === 'true');
  }, []);

  // Anything but a built view is refused here rather than at the switch, so the palette and the
  // switch cannot disagree about what Table does: nothing, until it exists.
  const setView = useCallback((next: DeckViewMode) => {
    if (!isBuiltView(next)) return;
    setViewState(next);
    write(VIEW_KEY, next);
  }, []);

  const setRailFolded = useCallback((folded: boolean) => {
    setFoldedState(folded);
    write(RAIL_KEY, String(folded));
  }, []);

  return { view, setView, railFolded, setRailFolded };
}

// Storage can be missing or throw — a private window, blocked site data. Either way the deck draws
// its defaults, which is the same deck a first visit gets.
function read(key: string): string | undefined {
  try {
    return window.localStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Not remembered, and nothing else is lost: the view on screen is still the one chosen.
  }
}
