// Which panes are on screen, how they are cut up, and which one the keyboard is pointing at —
// P5a-T5.
//
// Out of `deck-view.tsx` because that file has a 250-line limit and this is the piece of it with a
// story of its own: three pieces of state that only make sense together, and the one thing on the
// deck that outlives a reload.
//
// **The layout is remembered per BROWSER, not per project.** SPEC §5.3 asks for per project, and
// this deck has no current project to key it by — importing one is P3-T1 and switching to one is
// P3-T6, which is also where the palette's "switch project" is waiting. A key invented here would
// be a key P3-T6 had to migrate off, so the adjective is deferred with the view that gives it a
// meaning and the choice survives a reload in the meantime.
import { useCallback, useEffect, useState } from 'react';
import {
  defaultLayout,
  isPaneLayout,
  MAX_PANES,
  movePane,
  type PaneLayout,
} from '../../contracts/pane-layout.ts';
import type { OpenPane } from './deck-view.tsx';

/** Where the chosen layout survives a reload. */
const LAYOUT_KEY = 'flightdeck.pane-layout';

export interface PaneGridState {
  readonly panes: readonly OpenPane[];
  readonly layout: PaneLayout;
  /** The pane `[` and `]` move, and the one focus mode enlarges. `undefined` before any is used. */
  readonly focusedKey: string | undefined;
  readonly openPane: (pane: OpenPane) => void;
  readonly closePane: (key: string) => void;
  readonly setLayout: (layout: PaneLayout) => void;
  readonly setFocused: (key: string) => void;
  readonly movePaneBy: (delta: number) => void;
}

/**
 * Which panes are on screen, how they are cut up, and which one the keyboard is pointing at.
 *
 * Opening the same one twice is a no-op, not a second PTY. The cap is a layout decision only —
 * attach exclusivity is core's (SEC-WS-3) and must never be something the browser believes it is
 * enforcing.
 *
 * The layout is remembered per BROWSER, not per project (P5a-T5). SPEC §5.3 asks for per project
 * and this deck has no current project to key it by until P3-T6 builds the by-project view; a key
 * invented here would be one P3-T6 had to migrate off.
 */
export function usePaneGrid(): PaneGridState {
  const [panes, setPanes] = useState<readonly OpenPane[]>([]);
  const [chosen, setChosen] = useState<PaneLayout | undefined>(undefined);
  const [focusedKey, setFocusedKey] = useState<string | undefined>(undefined);

  // Read once, after mount rather than during render: `localStorage` does not exist while Next is
  // rendering this on the server, and reading it in a `useState` initialiser would make the first
  // client render disagree with the server's and throw a hydration error.
  useEffect(() => {
    const stored = readLayout();
    if (stored !== undefined) setChosen(stored);
  }, []);

  const openPane = useCallback((pane: OpenPane) => {
    setPanes((current) => {
      if (current.some((open) => open.key === pane.key)) return current;
      return [...current, pane].slice(-MAX_PANES);
    });
    setFocusedKey(pane.key);
  }, []);

  const closePane = useCallback((key: string) => {
    setPanes((current) => current.filter((pane) => pane.key !== key));
    // Not re-pointed at a neighbour: the next pane somebody touches says which one it is, and
    // guessing would enlarge a pane nobody asked for the moment focus mode is on.
    setFocusedKey((current) => (current === key ? undefined : current));
  }, []);

  const setLayout = useCallback((layout: PaneLayout) => {
    setChosen(layout);
    writeLayout(layout);
  }, []);

  const movePaneBy = useCallback(
    (delta: number) => {
      setPanes((current) => reorder(current, focusedKey, delta));
    },
    [focusedKey],
  );

  return {
    panes,
    // The count decides only until somebody chooses; after that the choice stands even when it is
    // smaller than the panes open, and the extra panes scroll (contracts/pane-layout.ts).
    layout: chosen ?? defaultLayout(panes.length),
    focusedKey,
    openPane,
    closePane,
    setLayout,
    setFocused: setFocusedKey,
    movePaneBy,
  };
}

/**
 * The panes with `key` moved `delta` places, or the same array when nothing moved.
 *
 * Identity is load-bearing: `movePane` preserves it, and returning the same array from a state
 * updater is what stops an end-of-row keystroke re-rendering every pane to put them all back where
 * they already were.
 */
function reorder(
  panes: readonly OpenPane[],
  key: string | undefined,
  delta: number,
): readonly OpenPane[] {
  if (key === undefined) return panes;
  const keys = panes.map((pane) => pane.key);
  const moved = movePane(keys, key, delta);
  if (moved === keys) return panes;
  const byKey = new Map(panes.map((pane) => [pane.key, pane]));
  return moved.flatMap((paneKey) => {
    const pane = byKey.get(paneKey);
    return pane === undefined ? [] : [pane];
  });
}

/**
 * The chosen layout, out of and into this browser.
 *
 * Wrapped in `try`/`catch` on both sides rather than only read defensively: `localStorage` throws
 * outright in a private window with site data blocked, and a deck that fails to open because it
 * could not remember a grid shape would be a worse bug than the one this fixes. An unreadable or
 * stale value is the same thing as no value — `isPaneLayout` is what makes a layout removed in a
 * later build fall back rather than render a class nothing styles.
 */
function readLayout(): PaneLayout | undefined {
  try {
    const raw = window.localStorage.getItem(LAYOUT_KEY);
    if (raw === null) return undefined;
    const parsed: unknown = JSON.parse(raw);
    return isPaneLayout(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function writeLayout(layout: PaneLayout): void {
  try {
    window.localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
  } catch {
    // A layout that cannot be remembered is still a layout that works for this session.
  }
}
