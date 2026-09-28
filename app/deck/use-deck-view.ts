// Which view the deck is on, and whether the rail is folded away — P10-T1.
//
// Facts about this browser, so they live in `localStorage` beside the layout and the current
// project rather than in core or in `DeckState` (`use-current-project.ts` gives the reason: two
// windows on two views is a reasonable thing to want). Read after mount, never during render, so
// the first client render matches the server's.
import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_VIEW, isBuiltView, type DeckViewMode } from '../../contracts/deck-view.ts';

const VIEW_KEY = 'flightdeck.deck-view';
// P10-T2. A new key, because the meaning changed: on the board the rail is the Tools drawer and
// starts CLOSED, and a `false` stored under the old key would have opened it for everyone who had
// ever unfolded it. The Panes view does not fold at all — its session list is the view.
const RAIL_KEY = 'flightdeck.board-tools-hidden';

export interface DeckView {
  readonly view: DeckViewMode;
  readonly setView: (view: DeckViewMode) => void;
  /** Whether the board's Tools drawer (the rail) is closed. Closed until it is opened (P10-T2). */
  readonly railFolded: boolean;
  readonly setRailFolded: (folded: boolean) => void;
}

export function useDeckView(): DeckView {
  const [view, setViewState] = useState<DeckViewMode>(DEFAULT_VIEW);
  const [railFolded, setFoldedState] = useState(true);

  useEffect(() => {
    const stored = read(VIEW_KEY);
    if (isBuiltView(stored)) setViewState(stored);
    setFoldedState(read(RAIL_KEY) !== 'false');
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
