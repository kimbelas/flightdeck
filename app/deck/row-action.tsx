// A row's one lifecycle verb — the pane, or the reason there is none and the button that might
// change it. Its own file since P6-T8 added the take-over; the board's modal draws it too.
import type { JSX } from 'react';
import { RowTakeover } from './row-takeover.tsx';
import type { SessionRowViewModel } from './session-row-view-model.ts';

interface RowActionProps {
  readonly row: SessionRowViewModel;
  readonly onOpen: () => void;
  readonly onResume: () => void;
  readonly onAdopt: () => void;
  readonly onTakeOver: () => void;
  readonly onStop: () => void;
}

/**
 * What this row lets you do, which is at most one thing — P4-T2a, P6-T7.
 *
 * A live background session offers a pane; a stopped one offers `resume`; an ENDED interactive one
 * offers `adopt`; a live interactive one offers neither and says why, permanently (SPEC §5.2). The
 * sentence stays under the button rather than being replaced by it: it is the explanation P2 put
 * there on purpose, and it is what makes the button make sense — "Not running. Resume it to
 * attach." and "That terminal has closed." are each half of their own control.
 */
export function RowAction(props: RowActionProps): JSX.Element {
  const { row, onOpen, onStop } = props;
  if (!row.canOpenPane) return <RowBlocked {...props} />;
  return (
    <div className="row-actions">
      <button type="button" onClick={onOpen}>
        open pane
      </button>
      {/* No confirmation, deliberately: stopping keeps the session and its transcript, and
          resume wakes it again under its own id. `rm` is the verb that deletes and is not
          here — it needs a confirm of its own (RESEARCH.md F.2.8). */}
      {row.canStop && (
        <button type="button" className="ghost" onClick={onStop}>
          stop
        </button>
      )}
    </div>
  );
}

/**
 * A row no pane can open on: the reason, and the one button that might change that.
 *
 * At most one button, and `canResume` and `canAdopt` cannot both be true — they are complements
 * across `kind` (`SessionRowViewModel`). A live interactive session has neither and keeps only the
 * sentence, which is SPEC §5.2's permanent constraint rather than a gap.
 */
function RowBlocked({
  row,
  onResume,
  onAdopt,
  onTakeOver,
}: Omit<RowActionProps, 'onOpen' | 'onStop'>): JSX.Element {
  return (
    <div className="row-blocked-line">
      <p className="row-blocked">{row.blockedReason}</p>
      {row.canResume && (
        <button type="button" className="ghost" onClick={onResume}>
          resume
        </button>
      )}
      {/* P6-T7, SPEC §4.3's migration path. The title carries what the label cannot: an adopted
          session is renamed after its own short id, because `-n` would keep the name and `-n`
          starts a copy (G.55). */}
      {row.canAdopt && (
        <button
          type="button"
          className="ghost"
          data-row-adopt
          title={row.adoptHint}
          onClick={onAdopt}
        >
          adopt
        </button>
      )}
      {/* P6-T8, D64. The live interactive row's way into a pane: core closes the terminal, then
          adopts. It arms first, because the window it closes is somebody's (`RowTakeover`). */}
      <RowTakeover row={row} onTakeOver={onTakeOver} />
    </div>
  );
}
