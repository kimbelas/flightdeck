'use client';

// One session row. Renders a view model and nothing else — CODING-STANDARDS §3.
//
// The `open pane` button is absent rather than disabled when a session cannot be attached, and the
// reason takes its place. A disabled button invites a second click and explains nothing; the
// constraint here is permanent (SPEC §5.2) and worth a sentence.
//
// **The row expands in place rather than opening a panel** (P2-T4). The detail is about this
// session and belongs against it: a side panel would cost the row's context and force a choice
// about what happens when a second row is expanded. Several can be open at once, and the store
// keys details per row for that reason.
import type { JSX } from 'react';
import { SessionDetailView } from './session-detail-view.tsx';
import type { SessionDetailViewModel } from './session-detail-view-model.ts';
import type { SessionRowViewModel } from './session-row-view-model.ts';

interface SessionRowCardProps {
  readonly row: SessionRowViewModel;
  readonly now: number;
  readonly expanded: boolean;
  /** `undefined` while the detail is in flight, which is what draws the row's spinner. */
  readonly detail: SessionDetailViewModel | undefined;
  readonly onToggle: () => void;
  readonly onOpen: () => void;
  readonly onResume: () => void;
}

export function SessionRowCard({
  row,
  now,
  expanded,
  detail,
  onToggle,
  onOpen,
  onResume,
}: SessionRowCardProps): JSX.Element {
  return (
    <article className={`row tone-${row.tone}${expanded ? ' row-open' : ''}`}>
      <div className="row-main">
        <RowToggle rowKey={row.key} title={row.title} expanded={expanded} onToggle={onToggle} />
        <span className="tag">{row.subscriptionLabel}</span>
        <span className="tag">{row.kindLabel}</span>
      </div>
      <div className="row-meta">
        <span>{row.project}</span>
        <span>{row.stateLabel}</span>
        <span>{row.startedAgo(now)}</span>
      </div>
      <RowAction row={row} onOpen={onOpen} onResume={onResume} />
      {expanded && <SessionDetailView detail={detail} now={now} />}
    </article>
  );
}

interface RowActionProps {
  readonly row: SessionRowViewModel;
  readonly onOpen: () => void;
  readonly onResume: () => void;
}

/**
 * What this row lets you do, which is at most one thing — P4-T2a.
 *
 * A live background session offers a pane; a stopped one offers `resume`; an interactive session
 * offers neither and says why, permanently (SPEC §5.2). The sentence stays under the resume
 * button rather than being replaced by it: it is the explanation P2 put there on purpose, and
 * "Not running. Resume it to attach." is what makes the button make sense.
 */
function RowAction({ row, onOpen, onResume }: RowActionProps): JSX.Element {
  if (row.canOpenPane) {
    return (
      <button type="button" onClick={onOpen}>
        open pane
      </button>
    );
  }
  return (
    <div className="row-blocked-line">
      <p className="row-blocked">{row.blockedReason}</p>
      {row.canResume && (
        <button type="button" className="ghost" onClick={onResume}>
          resume
        </button>
      )}
    </div>
  );
}

interface RowToggleProps {
  /** `data-deck-row`, which is how `j`/`k` and the palette's "jump to" find this button. */
  readonly rowKey: string;
  readonly title: string;
  readonly expanded: boolean;
  readonly onToggle: () => void;
}

/**
 * The title line, which IS the expand control rather than having one beside it.
 *
 * The row is dense, and a 4 mm chevron next to a 30 mm title is the wrong thing to have to aim at.
 * `aria-expanded` is on the button rather than the article because the button is what a screen
 * reader announces as the control.
 *
 * It is also where `j`/`k` put focus (P2-T5), which is why the keyboard needed no selection state
 * of its own: this was already a focusable control that does the row's one thing on Enter.
 */
function RowToggle({ rowKey, title, expanded, onToggle }: RowToggleProps): JSX.Element {
  return (
    <button
      type="button"
      className="row-toggle"
      data-deck-row={rowKey}
      aria-expanded={expanded}
      onClick={onToggle}
      title={expanded ? 'Collapse' : 'Show what this session is doing'}
    >
      <span aria-hidden="true">{expanded ? '▾' : '▸'}</span>
      <span className="row-title">{title}</span>
    </button>
  );
}
