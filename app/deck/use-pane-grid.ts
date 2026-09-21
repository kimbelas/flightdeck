// Which panes are on screen, how they are cut up, and which one the keyboard is pointing at —
// P5a-T5.
//
// Out of `deck-view.tsx` because that file has a 250-line limit and this is the piece of it with a
// story of its own: three pieces of state that only make sense together, and the one thing on the
// deck that outlives a reload.
//
// **The layout is remembered PER PROJECT since P3-T6**, which is what SPEC §5.3 asked for and what
// P5a-T5 deferred until there was a project to key it by. The key is `layoutKeyFor`'s, so the
// unkeyed `flightdeck.pane-layout` P5a-T5 wrote is still the one "All projects" reads — nothing
// had to migrate, because the old value became the answer to the state the deck starts in.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  defaultLayout,
  isPaneLayout,
  MAX_PANES,
  movePane,
  type PaneLayout,
} from '../../contracts/pane-layout.ts';
import { parsePtyTarget, sameTarget, type PtyTarget } from '../../contracts/pty-protocol.ts';
import type { SessionRow } from '../../contracts/session-row.ts';
import type { OpenPane } from './deck-view.tsx';
import { layoutKeyFor } from './use-current-project.ts';

/** And where the open panes do — P5a-T5b, the last clause of the P5a gate. */
const PANES_KEY = 'flightdeck.open-panes';

export interface PaneGridState {
  readonly panes: readonly OpenPane[];
  readonly layout: PaneLayout;
  /** The pane `[` and `]` move, and the one focus mode enlarges. `undefined` before any is used. */
  readonly focusedKey: string | undefined;
  readonly openPane: (pane: OpenPane) => void;
  readonly closePane: (key: string) => void;
  readonly setLayout: (layout: PaneLayout) => void;
  readonly setFocused: (key: string) => void;
  /**
   * Renames one pane — P5a-T6. Blank restores whatever it was opened with.
   *
   * It rides the same `localStorage` entry the open panes already survive a reload in, so a name
   * costs nothing to keep and nothing to migrate. It is the PANE's label and never the session's:
   * Claude Code has no rename verb (`pane-head.tsx`), so there is nothing to send anywhere.
   */
  readonly renamePane: (key: string, title: string) => void;
  readonly movePaneBy: (delta: number) => void;
}

/**
 * Which panes are on screen, how they are cut up, and which one the keyboard is pointing at.
 *
 * Opening the same one twice is a no-op, not a second PTY. The cap is a layout decision only —
 * attach exclusivity is core's (SEC-WS-3) and must never be something the browser believes it is
 * enforcing.
 *
 * @param project the current project's key, or `undefined` for all projects — P3-T6. The layout is
 * stored under it, so switching project brings that project's grid back and changing the layout
 * while one is current does not move the other's.
 */
export function usePaneGrid(
  rows: readonly SessionRow[],
  coreUp: boolean,
  project: string | undefined,
): PaneGridState {
  const [panes, setPanes] = useState<readonly OpenPane[]>([]);
  const [chosen, setChosen] = useState<PaneLayout | undefined>(undefined);
  const [focusedKey, setFocusedKey] = useState<string | undefined>(undefined);

  // Re-read whenever the project changes, not only on mount: switching project is switching which
  // stored layout is in force, and a project whose layout was never chosen falls back to the count
  // exactly as a fresh deck does. `localStorage` also does not exist while Next is rendering this
  // on the server, which is why this is an effect at all rather than a `useState` initialiser.
  useEffect(() => {
    setChosen(readLayout(project));
  }, [project]);

  useRememberedPanes({ panes, rows, coreUp, setPanes });

  const { openPane, closePane } = useOpenAndClose(setPanes, setFocusedKey);

  const setLayout = useChosenLayout(setChosen, project);

  const renamePane = useRenamedPane(setPanes);

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
    renamePane,
    movePaneBy,
  };
}

/**
 * Opening a pane and closing one, which are one pair because they both move the focus.
 *
 * Opening the same one twice is a no-op rather than a second PTY. Closing does NOT re-point the
 * focus at a neighbour: the next pane somebody touches says which one it is, and guessing would
 * enlarge a pane nobody asked for the moment focus mode is on.
 */
function useOpenAndClose(
  setPanes: (update: (current: readonly OpenPane[]) => readonly OpenPane[]) => void,
  setFocused: (update: string | ((current: string | undefined) => string | undefined)) => void,
): { readonly openPane: (pane: OpenPane) => void; readonly closePane: (key: string) => void } {
  const openPane = useCallback(
    (pane: OpenPane) => {
      setPanes((current) => {
        if (current.some((open) => open.key === pane.key)) return current;
        return [...current, pane].slice(-MAX_PANES);
      });
      setFocused(pane.key);
    },
    [setPanes, setFocused],
  );

  const closePane = useCallback(
    (key: string) => {
      setPanes((current) => current.filter((pane) => pane.key !== key));
      setFocused((current) => (current === key ? undefined : current));
    },
    [setPanes, setFocused],
  );

  return { openPane, closePane };
}

/**
 * Renaming one pane — P5a-T6.
 *
 * A blank name restores the one it was opened with rather than leaving a card with no label: the
 * title is what `1`-`9` and the smoke both name a pane by. The new title rides the same
 * `localStorage` entry the open panes already survive a reload in, so it costs nothing to keep.
 */
function useRenamedPane(
  setPanes: (update: (current: readonly OpenPane[]) => readonly OpenPane[]) => void,
): (key: string, title: string) => void {
  return useCallback(
    (key: string, title: string) => {
      setPanes((current) =>
        current.map((pane) => (pane.key === key ? { ...pane, title: title || pane.title } : pane)),
      );
    },
    [setPanes],
  );
}

/** Choosing a layout is choosing it for next time too, so the two always happen together. */
function useChosenLayout(
  setChosen: (layout: PaneLayout) => void,
  project: string | undefined,
): (layout: PaneLayout) => void {
  return useCallback(
    (layout: PaneLayout) => {
      setChosen(layout);
      writeLayout(layout, project);
    },
    [setChosen, project],
  );
}

/**
 * Puts the last grid back, and writes the current one down — P5a-T5b.
 *
 * SPEC §5.3's gate ends "reopening the deck re-attaches", and until this it did not: a reload lost
 * the whole grid and every pane had to be found and clicked again.
 *
 * **Reading and writing are one hook because the ORDER between them is the whole bug.** They were
 * two, and the write fired first on mount with the empty initial list — so the stored grid was
 * overwritten with `[]` before the read ever looked at it, and nothing ever came back. Caught by
 * the smoke rather than by review. Three effects now, in the order they must run:
 *
 *   1. read storage into a ref, on mount, before anything can write over it;
 *   2. apply it once core has said which sessions still exist;
 *   3. write, and only after 2 has happened.
 *
 * **Step 2 waits for `coreUp` rather than restoring on mount**, and that is the other half of the
 * design. A pane is a live attach, so putting one back for a session that has since ended would
 * open a card that can only say `closed` — a grid of dead panes to clear before working. Once core
 * has answered, `rows` says which sessions are still attachable and only those come back. A shell
 * carries no identity and always does.
 *
 * `restored` is a ref rather than state because it must happen once, whatever follows: a session
 * ending later must not retroactively close the pane watching it. That is `evicted`'s job
 * (P5a-T6a), not this one's.
 */
interface RememberedPanes {
  readonly panes: readonly OpenPane[];
  readonly rows: readonly SessionRow[];
  readonly coreUp: boolean;
  readonly setPanes: (panes: readonly OpenPane[]) => void;
}

function useRememberedPanes({ panes, rows, coreUp, setPanes }: RememberedPanes): void {
  const saved = useRef<readonly OpenPane[] | undefined>(undefined);
  const restored = useRef(false);

  useEffect(() => {
    saved.current = readPanes();
  }, []);

  useEffect(() => {
    if (restored.current || !coreUp) return;
    restored.current = true;
    const stored = saved.current ?? [];
    if (stored.length > 0) setPanes(stored.filter((pane) => stillOpenable(pane.target, rows)));
  }, [rows, coreUp, setPanes]);

  useEffect(() => {
    // Never write over what has not been read yet — see the header.
    if (!restored.current) return;
    try {
      // Only what IDENTIFIES a pane. Nothing about its state: whether it was live, what it had
      // painted, which one was focused. Those are facts about a socket that no longer exists, and
      // restoring them would mean a pane that claims to be live before it has connected.
      window.localStorage.setItem(PANES_KEY, JSON.stringify(panes));
    } catch {
      // A grid that cannot be remembered is still a grid that works for this session.
    }
  }, [panes]);
}

/** Whether a stored pane still has something to attach to. */
function stillOpenable(target: PtyTarget, rows: readonly SessionRow[]): boolean {
  if (target.kind === 'shell') return true;
  return rows.some((row) => {
    const rowTarget: PtyTarget = {
      kind: 'session',
      sessionId: row.sessionId,
      subscription: row.subscription,
    };
    return row.attachable && sameTarget(rowTarget, target);
  });
}

/**
 * The stored panes, or none — and every one of them re-parsed rather than trusted.
 *
 * `parsePtyTarget` is reached through the query string it already understands, so a stored target
 * is admitted by exactly the rule the WebSocket upgrade uses (SEC-WS-2). That matters more here
 * than anywhere else on the deck: this is the one input that survives a reload, so a hand-edited
 * `localStorage` entry is the only way a page can hand itself a target it was never given. It
 * cannot widen what a pane may attach to — core screens the ticket and the upgrade again — but a
 * parser here is what stops a malformed entry becoming a card that renders nothing.
 */
function readPanes(): readonly OpenPane[] {
  try {
    const raw = window.localStorage.getItem(PANES_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) => {
      const pane = asOpenPane(entry);
      return pane === undefined ? [] : [pane];
    });
  } catch {
    return [];
  }
}

function asOpenPane(value: unknown): OpenPane | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const fields: Readonly<Record<string, unknown>> = Object.fromEntries(Object.entries(value));
  const key = fields['key'];
  const title = fields['title'];
  const target = asTarget(fields['target']);
  if (typeof key !== 'string' || key === '') return undefined;
  if (typeof title !== 'string' || target === undefined) return undefined;
  return { key, title, target };
}

/** Through the upgrade URL's own parser, so a stored target is read by the rule the socket uses. */
function asTarget(value: unknown): PtyTarget | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const fields: Readonly<Record<string, unknown>> = Object.fromEntries(Object.entries(value));
  if (fields['kind'] === 'shell') return parsePtyTarget('?shell=1');
  const sessionId = fields['sessionId'];
  const subscription = fields['subscription'];
  if (typeof sessionId !== 'string' || typeof subscription !== 'string') return undefined;
  return parsePtyTarget(
    `?session=${encodeURIComponent(sessionId)}&subscription=${encodeURIComponent(subscription)}`,
  );
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
function readLayout(project: string | undefined): PaneLayout | undefined {
  try {
    const raw = window.localStorage.getItem(layoutKeyFor(project));
    if (raw === null) return undefined;
    const parsed: unknown = JSON.parse(raw);
    return isPaneLayout(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function writeLayout(layout: PaneLayout, project: string | undefined): void {
  try {
    window.localStorage.setItem(layoutKeyFor(project), JSON.stringify(layout));
  } catch {
    // A layout that cannot be remembered is still a layout that works for this session.
  }
}
