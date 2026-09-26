'use client';

// The pane area — the chooser, the grid, and the two states that are not a terminal (P5a-T5).
//
// The empty state carries the sentence that explains the whole deck: only background sessions can
// be attached. Putting it here rather than in a tooltip is deliberate — it is the first thing
// someone wonders when every row refuses a pane.
//
// **Every card is a direct child of one container, in array order, in every layout.** That is the
// load-bearing rule in this file and it is not a style: React keeps a component mounted only while
// it stays in the same position in the tree, so moving a card into a "stage" wrapper for focus mode
// would unmount it — and unmounting a pane disposes its terminal and closes its socket, which for
// an attached session means killing a PTY because somebody clicked a layout button. So focus mode
// is grid placement, not a different tree, and the only thing a layout changes is a class name.
import type { HTMLAttributes, JSX } from 'react';
import {
  layoutClass,
  layoutRows,
  PANE_LAYOUTS,
  type PaneLayout,
} from '../../contracts/pane-layout.ts';
import type { OpenPane } from './open-pane.ts';
import type { PaneControls } from './pane-head.tsx';
import { PaneView } from './pane-view.tsx';
import { droppedRowKey, isRowDrag } from './row-drag.ts';
import type { SessionRowViewModel } from './session-row-view-model.ts';

interface PaneGridProps {
  readonly panes: readonly OpenPane[];
  /**
   * Every session, so a pane can find the row it is attached to — P5a-T6.
   *
   * A pane's `key` IS its row's `key`, which is what makes this a lookup rather than a second
   * source of truth: `canStop` and the `SessionRef` come off the row the session list is drawing,
   * so the pane's buttons and the row's buttons cannot come to different conclusions about the
   * same session. A pane with no row — a shell, or a session that has since ended — gets no
   * session verbs, which is the honest answer rather than a button that would 400.
   */
  readonly rows: readonly SessionRowViewModel[];
  readonly layout: PaneLayout;
  readonly focusedKey: string | undefined;
  readonly onLayout: (layout: PaneLayout) => void;
  readonly onFocused: (key: string) => void;
  readonly onRename: (key: string, title: string) => void;
  readonly onStop: (row: SessionRowViewModel) => void;
  /** Hands the session to Windows Terminal and closes this pane — P6-T2. */
  readonly onPopOut: (row: SessionRowViewModel) => void;
  /**
   * Which sessions core is silent about, as `sessionKey` strings — P6-T3.
   *
   * The set rather than a per-pane boolean, because it is core's answer and one read fills every
   * pane: a mute set in another tab, or yesterday, draws the right switch here without asking.
   */
  readonly muted: readonly string[];
  readonly onMute: (row: SessionRowViewModel, muted: boolean) => void;
  readonly onRespawn: (row: SessionRowViewModel) => void;
  readonly onClose: (key: string) => void;
  /** Docked under the State board rather than given the screen — P10-T1. */
  readonly dock: boolean;
  /** What a session card dropped here does: the card's own `open pane` (P10-T1). */
  readonly onOpenPane: (row: SessionRowViewModel) => void;
}

export function PaneGrid(props: PaneGridProps): JSX.Element {
  const { panes, layout, dock } = props;
  const drop = dropTarget(props);
  return (
    <div className={`pane-area${dock ? ' is-dock' : ''}`} {...drop}>
      {dock ? (
        <DockBar count={panes.length} />
      ) : (
        <PaneBar layout={layout} count={panes.length} onLayout={props.onLayout} />
      )}
      <section
        className={dock ? 'panes is-dock' : `panes ${layoutClass(layout)}`}
        data-pane-layout={String(layout)}
        data-pane-dock={dock || undefined}
        // A data attribute and not an inline style: the policy has no `'unsafe-inline'` for
        // styles, and the server-rendered `style=""` would be refused on first paint (SEC-UI-1).
        // The dock is one row whatever the layout says, so it carries no row count.
        data-pane-rows={dock ? undefined : rowsAttribute(layout, panes.length)}
        aria-label="terminal panes"
      >
        <PaneCards {...props} />
        {panes.length === 0 && <EmptyPanes />}
      </section>
    </div>
  );
}

/**
 * The cards, each a direct child of `section.panes` — the rule at the top of this file.
 *
 * No grid-wide credential check: each pane mints its own ticket and reports its own refusal, so
 * core being down shows on the pane that asked rather than on all of them (DECISIONS.md D32).
 * The dock draws no thumbnails: focus mode is a way of cutting the whole screen, and the dock is a
 * strip under the board whatever the chooser was last set to.
 */
function PaneCards(props: PaneGridProps): JSX.Element {
  const { panes, layout, focusedKey, onFocused, onClose, dock } = props;
  const byKey = new Map(props.rows.map((row) => [row.key, row]));
  const stage = stageKey(panes, focusedKey);
  return (
    <>
      {panes.map((pane, index) => (
        <PaneView
          key={pane.key}
          index={index}
          target={pane.target}
          title={pane.title}
          focused={pane.key === focusedKey}
          thumbnail={!dock && layout === 'focus' && pane.key !== stage}
          controls={paneControls(byKey.get(pane.key), props)}
          onFocused={() => {
            onFocused(pane.key);
          }}
          onRename={(title) => {
            props.onRename(pane.key, title);
          }}
          onClose={() => {
            onClose(pane.key);
          }}
        />
      ))}
    </>
  );
}

/**
 * A session card dropped on the panes opens its pane — P10-T1.
 *
 * Through `onOpenPane` with the row the deck is drawing, which is what the card's own button calls,
 * and only for a row that can open one: the card is draggable only then, and this checks again
 * rather than trusting where a drag came from. Anything else dropped here is left alone.
 */
function dropTarget(
  props: PaneGridProps,
): Pick<HTMLAttributes<HTMLDivElement>, 'onDragOver' | 'onDrop'> {
  return {
    onDragOver: (event) => {
      if (!isRowDrag(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'link';
    },
    onDrop: (event) => {
      const key = droppedRowKey(event);
      const row = props.rows.find((each) => each.key === key);
      if (!row?.canOpenPane) return;
      event.preventDefault();
      props.onOpenPane(row);
    },
  };
}

/**
 * Which pane focus mode puts on the stage: the focused one, or the first while none is.
 *
 * The same rule as the stylesheet's `:has` fallback, and it has to be — the CSS decides where the
 * card goes and this decides what it shows, so a disagreement would draw a thumbnail on the stage.
 */
function stageKey(panes: readonly OpenPane[], focusedKey: string | undefined): string | undefined {
  if (panes.some((pane) => pane.key === focusedKey)) return focusedKey;
  return panes[0]?.key;
}

/** `layoutRows` as the stylesheet reads it; absent in focus mode, which is not a grid. */
function rowsAttribute(layout: PaneLayout, count: number): string | undefined {
  const rows = layoutRows(layout, count);
  return rows === undefined ? undefined : String(rows);
}

/**
 * What this pane's session can be asked to do, or `undefined` when there is no session.
 *
 * The two flags are the ROW's, not this file's: `canStop` is a running background session and
 * `canRespawn` is any background one, because `respawn` by name works on a session that has
 * finished while `--all` skips it (RESEARCH.md F.10.4). Deciding either here would be a second
 * opinion about a session the list beside it is already describing.
 */
function paneControls(
  row: SessionRowViewModel | undefined,
  props: PaneGridProps,
): PaneControls | undefined {
  if (row === undefined) return undefined;
  return {
    canStop: row.canStop,
    canRespawn: row.canRespawn,
    onStop: () => {
      props.onStop(row);
    },
    onPopOut: () => {
      props.onPopOut(row);
    },
    muted: props.muted.includes(row.key),
    onMute: (muted: boolean) => {
      props.onMute(row, muted);
    },
    onRespawn: () => {
      props.onRespawn(row);
    },
  };
}

/** The sentence that explains the whole deck, where somebody first wonders about it. */
function EmptyPanes(): JSX.Element {
  return (
    <p className="muted pad">
      No panes open. Only background sessions can be attached — an interactive session is already
      bound to the terminal you started it in.
    </p>
  );
}

/**
 * The dock's head: what it is, how many are in it, and that a card can be dragged in.
 *
 * No chooser: the dock is one row, and the layout it would choose is the Panes view's.
 */
function DockBar({ count }: { readonly count: number }): JSX.Element {
  return (
    <div className="pane-bar dock-bar">
      <span className="dock-title">Docked panes</span>
      <span className="muted" data-dock-count>
        {count === 0 ? 'none open' : `${String(count)} open`}
      </span>
      <span className="pane-bar-count muted">Drag a card here to attach</span>
    </div>
  );
}

interface PaneBarProps {
  readonly layout: PaneLayout;
  readonly count: number;
  readonly onLayout: (layout: PaneLayout) => void;
}

/**
 * The chooser `deck-commands.ts` said did not exist yet.
 *
 * It is always shown, including with nothing open, because it is also where the layout is READ
 * from — a deck that reopens 6-up should say 6-up before anything is in it. The count beside it is
 * the honest half of the cap: nine is a layout bound, and a tenth pane pushes the oldest out.
 */
function PaneBar({ layout, count, onLayout }: PaneBarProps): JSX.Element {
  return (
    <div className="pane-bar">
      <span className="pane-bar-label">layout</span>
      {PANE_LAYOUTS.map((option) => (
        <button
          key={String(option)}
          type="button"
          className={option === layout ? 'ghost is-on' : 'ghost'}
          aria-pressed={option === layout}
          data-pane-layout-option={String(option)}
          onClick={() => {
            onLayout(option);
          }}
        >
          {String(option)}
        </button>
      ))}
      <span className="pane-bar-count muted">
        {count === 0 ? 'no panes' : `${String(count)} open`}
      </span>
    </div>
  );
}
