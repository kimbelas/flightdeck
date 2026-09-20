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
import type { JSX } from 'react';
import { layoutClass, PANE_LAYOUTS, type PaneLayout } from '../../contracts/pane-layout.ts';
import type { OpenPane } from './deck-view.tsx';
import { PaneView } from './pane-view.tsx';

interface PaneGridProps {
  readonly panes: readonly OpenPane[];
  readonly layout: PaneLayout;
  readonly focusedKey: string | undefined;
  readonly onLayout: (layout: PaneLayout) => void;
  readonly onFocused: (key: string) => void;
  readonly onClose: (key: string) => void;
}

export function PaneGrid({
  panes,
  layout,
  focusedKey,
  onLayout,
  onFocused,
  onClose,
}: PaneGridProps): JSX.Element {
  return (
    <div className="pane-area">
      <PaneBar layout={layout} count={panes.length} onLayout={onLayout} />
      <section
        className={`panes ${layoutClass(layout)}`}
        data-pane-layout={String(layout)}
        aria-label="terminal panes"
      >
        {/* No grid-wide credential check any more: each pane mints its own ticket and reports its
            own refusal, so core being down shows on the pane that asked rather than on all of them
            (DECISIONS.md D32). */}
        {panes.map((pane, index) => (
          <PaneView
            key={pane.key}
            index={index}
            target={pane.target}
            title={pane.title}
            focused={pane.key === focusedKey}
            onFocused={() => {
              onFocused(pane.key);
            }}
            onClose={() => {
              onClose(pane.key);
            }}
          />
        ))}
        {panes.length === 0 && <EmptyPanes />}
      </section>
    </div>
  );
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
