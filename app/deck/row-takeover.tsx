'use client';

// Moving a live interactive session into Flightdeck, from its row — P6-T8, D63.
//
// **Its own file for `row-handoff.tsx`'s reason**: `session-row-card.tsx` is at its line limit, and
// this control has a state of its own where every other button on that line is one press.
//
// **It arms, like `RowDelete`, and for a sharper reason than a form would give.** What it does is
// close the Claude session in somebody's open terminal window. The conversation is not lost — it
// continues here under its own id — but the window it was typed into does not come back, and a
// press on the wrong row would take a terminal from under whoever is using it. So the first press
// shows the sentence that says so, and the second press is a button that names the session.
//
// **Busy is disabled, not absent.** Unlike the pane button SPEC §5.2 removes, this constraint is
// temporary: the session can be moved the moment its turn finishes. A button that is there and
// says why it is waiting is the right shape for "not yet", and its title says what to wait for.
// Armed state lives here rather than in the store for `RowDelete`'s reason.
import { useState, type JSX } from 'react';
import type { SessionRowViewModel } from './session-row-view-model.ts';

interface RowTakeoverProps {
  readonly row: SessionRowViewModel;
  readonly onTakeOver: () => void;
}

export function RowTakeover({ row, onTakeOver }: RowTakeoverProps): JSX.Element | undefined {
  const [armed, setArmed] = useState(false);
  if (!row.canTakeOver) return undefined;
  if (!armed) {
    return (
      <button
        type="button"
        className="ghost"
        data-row-takeover
        disabled={!row.takeOverReady}
        title={row.takeOverHint}
        onClick={() => {
          setArmed(true);
        }}
      >
        move here…
      </button>
    );
  }
  return (
    <RowTakeoverArmed
      row={row}
      onTakeOver={onTakeOver}
      onCancel={() => {
        setArmed(false);
      }}
    />
  );
}

interface RowTakeoverArmedProps extends RowTakeoverProps {
  readonly onCancel: () => void;
}

/** The second act: what closes, and a button that names the session — `RowDeleteArmed`'s shape. */
function RowTakeoverArmed({ row, onTakeOver, onCancel }: RowTakeoverArmedProps): JSX.Element {
  return (
    <div className="row-takeover is-armed" role="group" aria-label={`move ${row.title} here`}>
      <p className="row-takeover-warning">{row.takeOverWarning}</p>
      <button
        type="button"
        className="warn"
        data-row-takeover-confirm
        // A turn that started while this was armed disables it again rather than disarming it:
        // the sentence stays on screen, and the button comes back when the turn is over.
        disabled={!row.takeOverReady}
        onClick={() => {
          onCancel();
          onTakeOver();
        }}
      >
        {`close its terminal and move ${row.title}`}
      </button>
      <button type="button" className="ghost" onClick={onCancel}>
        cancel
      </button>
    </div>
  );
}
