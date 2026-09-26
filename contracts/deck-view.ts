// Which of the deck's views is on screen — P10-T1, the State board (DECISIONS.md D63).
//
// In `contracts/` beside `pane-layout.ts` for its reason: the deck and the tests are two TypeScript
// projects and this is the folder both compile, so the vocabulary can be asserted on without a DOM.
//
// **A view is a class on the deck, never a different tree.** The Board docks the open panes under
// the state columns and the Panes view gives them the screen, and both are the SAME `section.panes`
// at the same place in the tree (`deck-body.tsx`): moving the panes into another container would
// remount every card, and a remount closes its socket (`pane-grid.tsx`).

/** Board: state columns with the panes docked. Panes: the grid with its layout chooser. */
export type DeckViewMode = 'board' | 'panes' | 'table';

/** In the order the switch offers them. */
export const DECK_VIEWS: readonly DeckViewMode[] = ['board', 'panes', 'table'];

/**
 * The views that are built. Table is on the switch as a placeholder and cannot be chosen: a view
 * that drew nothing would be a button that looks broken.
 */
export const BUILT_VIEWS: readonly DeckViewMode[] = ['board', 'panes'];

/** What the deck opens on when nothing has been chosen — the view the owner picked (D63). */
export const DEFAULT_VIEW: DeckViewMode = 'board';

/** What the switch prints. */
export const VIEW_LABELS: Readonly<Record<DeckViewMode, string>> = {
  board: 'Board',
  panes: 'Panes',
  table: 'Table',
};

/** Whether a value read back out of storage is a view this build can draw. */
export function isBuiltView(value: unknown): value is DeckViewMode {
  return BUILT_VIEWS.some((view) => view === value);
}
