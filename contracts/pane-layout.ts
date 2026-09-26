// How many panes are on screen and where — SPEC §5.3's first bullet, as a value (P5a-T5).
//
// In `contracts/` beside `keymap.ts` and for the same reason: the deck and the tests are two
// TypeScript projects and this is the only folder both compile, so a layout can be asserted on
// without a DOM. Nothing here reads a browser; `pane-grid.tsx` turns what this returns into a class
// and `globals.css` turns that class into a grid.
//
// **A layout is chosen, not derived.** Until this task the grid read `panes-${count}`, so opening a
// third pane silently re-cut the screen and there was nothing to pick — which is what
// `deck-commands.ts` meant by "there is nothing to choose until there is a chooser". The count now
// only decides the DEFAULT, and only until somebody chooses.

/** The five grids SPEC names, plus focus mode — one large pane and a strip of the rest. */
export type PaneLayout = 1 | 2 | 4 | 6 | 9 | 'focus';

/** In the order they are offered. The grids ascend, and focus mode sits at the end as the odd one. */
export const PANE_LAYOUTS: readonly PaneLayout[] = [1, 2, 4, 6, 9, 'focus'];

/**
 * The most panes the deck will hold open at once.
 *
 * Nine, because that is the largest layout and SPEC §5.3's gate is nine sessions in one window. It
 * is a LAYOUT bound and never an exclusivity one: which pane may attach to which session is core's
 * (SEC-WS-3, PaneRegistry), and a cap the browser believed it was enforcing would be a control in
 * the wrong process.
 */
export const MAX_PANES = 9;

/** Which grid a layout draws. `focus` is not a grid, so it has a class of its own. */
export function layoutClass(layout: PaneLayout): string {
  return `panes-${String(layout)}`;
}

/**
 * How many panes a layout was cut for.
 *
 * Focus mode has no fixed capacity — it shows one pane large and every other as a thumbnail — so it
 * answers the maximum. Nothing truncates on this number: a layout narrower than the panes open
 * scrolls, because changing the shape of the screen must never detach a session.
 */
export function layoutCapacity(layout: PaneLayout): number {
  return layout === 'focus' ? MAX_PANES : layout;
}

/** Columns and rows a grid layout is cut into — what one screen of it holds. */
const GRID_SHAPES: Readonly<Record<Exclude<PaneLayout, 'focus'>, readonly [number, number]>> = {
  1: [1, 1],
  2: [2, 1],
  4: [2, 2],
  6: [3, 2],
  9: [3, 3],
};

/**
 * How many rows share the screen's height — the number the stylesheet divides it by.
 *
 * `grid-auto-rows: 1fr` alone was wrong in both directions, measured with nine panes open: 1-up
 * gave each of them a ninth of the screen, so every card was 87px around a 240px terminal and they
 * painted over each other. A layout is a promise about ONE screen — 1-up is one pane that fills
 * it, and the rest scroll — so a row is the screen divided by the layout's rows. With fewer panes
 * than that the rows that exist share it instead, so a 9-up holding four still fills the screen.
 * Focus mode is not a grid and answers `undefined`: its stage and strip size themselves.
 */
export function layoutRows(layout: PaneLayout, count: number): number | undefined {
  if (layout === 'focus') return undefined;
  const [columns, rows] = GRID_SHAPES[layout];
  return Math.max(1, Math.min(rows, Math.ceil(count / columns)));
}

/**
 * The layout to draw when nobody has chosen one — the smallest grid the open panes fit in.
 *
 * This is the old derived behaviour kept as a default rather than deleted, so a deck nobody has
 * touched still opens two panes side by side. The moment a layout is chosen it wins, including
 * when it is smaller than the pane count; a choice that quietly un-chose itself on the next pane
 * would be worse than no chooser.
 */
export function defaultLayout(count: number): PaneLayout {
  for (const layout of PANE_LAYOUTS) {
    if (layout !== 'focus' && layout >= count) return layout;
  }
  return MAX_PANES;
}

/** Whether a value read back out of storage is still a layout this build knows about. */
export function isPaneLayout(value: unknown): value is PaneLayout {
  return PANE_LAYOUTS.some((layout) => layout === value);
}

/**
 * Moves the pane named `key` `delta` places along, and answers the new order.
 *
 * Clamped rather than wrapped. Wrapping would make one keystroke at the end of the row jump the
 * pane you are watching to the other side of the screen, which is a different thing from "move it
 * along" — and `1`–`9` count from the left, so a wrap silently renumbers every pane.
 *
 * The array is returned unchanged (by identity) when nothing moved, so a re-render is not provoked
 * by a key that did nothing.
 */
export function movePane<T>(panes: readonly T[], key: T, delta: number): readonly T[] {
  const from = panes.indexOf(key);
  if (from === -1) return panes;
  const to = Math.min(Math.max(from + delta, 0), panes.length - 1);
  if (to === from) return panes;

  const next = [...panes];
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return panes;
  next.splice(to, 0, moved);
  return next;
}
